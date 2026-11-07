import { BY_ID, CATALOG, type Category } from './catalog';

/** What the lens recorded with a photo. */
export interface ShotMeta {
  /** Epoch ms. */
  at: number;
  /** Time of day in the realm. */
  tod: string;
  /** Where it was taken (zone name). */
  where: string;
  /** Focus distance in metres. */
  dist: number;
  /** Equivalent focal length in mm. */
  mm: number;
  /** Subject (catalog id) or null for a free shot. */
  subject: string | null;
}

export interface Photo extends ShotMeta {
  key: string;
}

interface State {
  v: 1;
  seen: Record<string, number>;
  /** Catalog id -> photo key of the shot that collected it. */
  got: Record<string, string>;
  photos: Photo[];
}

const LS_KEY = 'touchgrass.journal.v1';
const DB_NAME = 'touchgrass';
const STORE = 'photos';
const MAX_FREE = 80;

/**
 * Persistent field journal: what you have discovered, what you have collected (with the photo
 * that collected it) and an album of free shots. The index lives in localStorage; photo blobs in
 * IndexedDB. Everything degrades gracefully: with no storage the journal lives for the session.
 */
export class Journal {
  private state: State = { v: 1, seen: {}, got: {}, photos: [] };
  private db: Promise<IDBDatabase | null>;
  /** Session cache of photos (also the fallback when IndexedDB is unavailable). */
  private readonly blobs = new Map<string, Blob>();
  private readonly urls = new Map<string, string>();
  onChange: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw) as State;
        if (s && s.v === 1) this.state = { v: 1, seen: s.seen ?? {}, got: s.got ?? {}, photos: s.photos ?? [] };
      }
    } catch {
      /* private mode or corrupted: start fresh */
    }
    this.db = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private save(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    } catch {
      /* quota or private mode */
    }
    this.onChange?.();
  }

  isSeen(id: string): boolean {
    return id in this.state.seen;
  }

  isCollected(id: string): boolean {
    return id in this.state.got;
  }

  seenAt(id: string): number | null {
    return this.state.seen[id] ?? null;
  }

  /** Mark as discovered. Returns true the first time. */
  discover(id: string): boolean {
    if (!BY_ID.has(id) || this.isSeen(id)) return false;
    this.state.seen[id] = Date.now();
    this.save();
    return true;
  }

  /** Store a photo; when it has a subject not yet collected, it collects it. Returns true if newly collected. */
  async addPhoto(blob: Blob, meta: ShotMeta, collects: boolean): Promise<{ photo: Photo; collected: boolean }> {
    const key = `p${meta.at.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const photo: Photo = { key, ...meta };
    this.blobs.set(key, blob);
    const db = await this.db;
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(blob, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }
    let collected = false;
    if (meta.subject && collects) {
      if (!this.isSeen(meta.subject)) this.state.seen[meta.subject] = meta.at;
      collected = !this.isCollected(meta.subject);
      this.state.got[meta.subject] = key;
    }
    this.state.photos.unshift(photo);
    this.trim();
    this.save();
    return { photo, collected };
  }

  /** Keep the album bounded: drop the oldest free shots that no journal entry uses. */
  private trim(): void {
    const used = new Set(Object.values(this.state.got));
    let free = this.state.photos.filter((p) => !used.has(p.key)).length;
    for (let i = this.state.photos.length - 1; i >= 0 && free > MAX_FREE; i--) {
      const p = this.state.photos[i];
      if (used.has(p.key)) continue;
      this.state.photos.splice(i, 1);
      free--;
      void this.deleteBlob(p.key);
    }
  }

  private async deleteBlob(key: string): Promise<void> {
    this.blobs.delete(key);
    const u = this.urls.get(key);
    if (u) URL.revokeObjectURL(u);
    this.urls.delete(key);
    const db = await this.db;
    if (!db) return;
    try {
      db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
    } catch {
      /* ignore */
    }
  }

  async deletePhoto(key: string): Promise<void> {
    const used = Object.entries(this.state.got).find(([, k]) => k === key);
    if (used) return; // the journal keeps the photo that collected an entry
    this.state.photos = this.state.photos.filter((p) => p.key !== key);
    await this.deleteBlob(key);
    this.save();
  }

  /** Make an album photo the journal picture of its subject. */
  setCover(id: string, key: string): void {
    if (!this.isCollected(id)) return;
    this.state.got[id] = key;
    this.save();
  }

  photo(key: string): Photo | undefined {
    return this.state.photos.find((p) => p.key === key);
  }

  photoFor(id: string): Photo | undefined {
    const k = this.state.got[id];
    return k ? this.photo(k) : undefined;
  }

  /** Photos of a subject, newest first. */
  photosOf(id: string): Photo[] {
    return this.state.photos.filter((p) => p.subject === id);
  }

  get photos(): readonly Photo[] {
    return this.state.photos;
  }

  /** An object URL for a stored photo (cached). */
  async url(key: string): Promise<string | null> {
    const cached = this.urls.get(key);
    if (cached) return cached;
    let blob = this.blobs.get(key) ?? null;
    if (!blob) {
      const db = await this.db;
      if (db) {
        blob = await new Promise<Blob | null>((resolve) => {
          try {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            req.onsuccess = () => resolve((req.result as Blob) ?? null);
            req.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        });
      }
    }
    if (!blob) return null;
    this.blobs.set(key, blob);
    const u = URL.createObjectURL(blob);
    this.urls.set(key, u);
    return u;
  }

  counts(cat?: Category): { seen: number; got: number; total: number } {
    const list = cat ? CATALOG.filter((e) => e.cat === cat) : CATALOG;
    return {
      seen: list.filter((e) => this.isSeen(e.id)).length,
      got: list.filter((e) => this.isCollected(e.id)).length,
      total: list.length,
    };
  }
}
