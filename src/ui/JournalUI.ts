import { CATALOG, BY_ID, CATEGORY_LABEL, type Category, type Entry } from '../discovery/catalog';
import type { Journal, Photo } from '../discovery/Journal';

type Tab = Category | 'album' | 'quests' | 'lore';

/** The game's own pages (quest log, lore), rendered elsewhere. */
export interface JournalExtra {
  quests(): string;
  lore(): string;
  questCount(): string;
  loreCount(): string;
  track(id: string): void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const ICON: Record<Category, string> = {
  flora: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="2.2"/><path d="M12 6.8c0-2.6 3.4-2.6 3.4 0M14.2 9c2.6 0 2.6 3.4 0 3.4M12 11.2c0 2.6-3.4 2.6-3.4 0M9.8 9c-2.6 0-2.6-3.4 0-3.4M12 11.5V21M12 17c-2-2.4-4.4-2.4-5.5-1.6M12 15.5c1.6-2 3.6-2.2 4.6-1.4"/></svg>',
  fauna: '<svg viewBox="0 0 24 24"><path d="M5 13c0-3 3-5 7-5s7 2 7 5-3 6-7 6-7-3-7-6z"/><path d="M7 9 5.5 4.5 9 7.5M17 9l1.5-4.5L15 7.5"/><circle cx="9.5" cy="12.5" r=".6"/><circle cx="14.5" cy="12.5" r=".6"/><path d="M11 15.5h2l-1 1z"/></svg>',
  place: '<svg viewBox="0 0 24 24"><path d="M3 20h18M5 20V10l3-3 3 3v10M13 20v-7l3-3 3 3v7M8 7V4"/></svg>',
};

function when(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function metaLine(p: Photo): string {
  const dist = p.dist > 0 ? (p.dist < 10 ? `${p.dist.toFixed(2)} m` : `${Math.round(p.dist)} m`) : '';
  return [p.tod, p.where, `${Math.round(p.mm)} mm`, dist, when(p.at)].filter(Boolean).join(' · ');
}

/**
 * The field journal: every flower, creature and place, with the photo that collected it.
 * Unknown entries show the rumour that leads to them; known but unphotographed ones say how
 * to collect them. An album keeps every photo you took.
 */
export class JournalUI {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly count: HTMLElement;
  private readonly viewer: HTMLElement;
  tab: Tab = 'flora';
  visible = false;
  onChange: ((open: boolean) => void) | null = null;
  extra: JournalExtra | null = null;

  constructor(private readonly journal: Journal) {
    this.el = document.createElement('div');
    this.el.className = 'journal';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Field journal');
    this.el.innerHTML = `
      <div class="jr-book">
        <header class="jr-head">
          <div class="jr-title"><span class="jr-kicker">Field Journal</span><span class="jr-count"></span></div>
          <nav class="jr-tabs" role="tablist"></nav>
          <button type="button" class="jr-close" aria-label="Close">J · Esc</button>
        </header>
        <div class="jr-body"></div>
      </div>
      <div class="jr-viewer" hidden></div>`;
    this.body = this.el.querySelector('.jr-body')!;
    this.tabs = this.el.querySelector('.jr-tabs')!;
    this.count = this.el.querySelector('.jr-count')!;
    this.viewer = this.el.querySelector('.jr-viewer')!;
    document.body.appendChild(this.el);

    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>('[data-tab]');
      if (tab) {
        this.tab = tab.dataset.tab as Tab;
        this.render();
        return;
      }
      if (t.closest('.jr-close')) {
        this.hide();
        return;
      }
      const tr = t.closest<HTMLElement>('[data-track]');
      if (tr && this.extra) {
        this.extra.track(tr.dataset.track!);
        this.render();
        return;
      }
      const card = t.closest<HTMLElement>('[data-entry]');
      if (card) {
        void this.openEntry(card.dataset.entry!);
        return;
      }
      const ph = t.closest<HTMLElement>('[data-photo]');
      if (ph && !t.closest('.jr-viewer')) {
        void this.openPhoto(ph.dataset.photo!);
        return;
      }
      if (t === this.el) this.hide();
    });
    this.viewer.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]');
      if (act) {
        e.stopPropagation();
        void this.act(act.dataset.act!, act.dataset.key!, act.dataset.id);
        return;
      }
      const thumb = t.closest<HTMLElement>('[data-photo]');
      if (thumb) {
        void this.openPhoto(thumb.dataset.photo!);
        return;
      }
      if (t === this.viewer || t.closest('.jv-back')) this.closeViewer();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'Escape') {
        e.preventDefault();
        if (!this.viewer.hidden) this.closeViewer();
        else this.hide();
      }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        const order: Tab[] = this.extra ? ['quests', 'flora', 'fauna', 'place', 'lore', 'album'] : ['flora', 'fauna', 'place', 'album'];
        const i = order.indexOf(this.tab);
        this.tab = order[(i + (e.code === 'ArrowRight' ? 1 : order.length - 1)) % order.length];
        this.closeViewer();
        this.render();
      }
    });
  }

  show(tab?: Tab): void {
    if (tab) this.tab = tab;
    this.visible = true;
    this.render();
    this.el.classList.add('on');
    if (document.pointerLockElement) document.exitPointerLock();
    this.onChange?.(true);
  }

  hide(): void {
    this.visible = false;
    this.closeViewer();
    this.el.classList.remove('on');
    this.onChange?.(false);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  refresh(): void {
    if (this.visible && this.viewer.hidden) this.render();
  }

  private render(): void {
    const j = this.journal;
    const all = j.counts();
    this.count.textContent = `${all.got} of ${all.total} collected · ${all.seen} found`;
    const tabs: [Tab, string][] = [
      ...(this.extra ? ([['quests', 'Quests']] as [Tab, string][]) : []),
      ['flora', CATEGORY_LABEL.flora.many],
      ['fauna', CATEGORY_LABEL.fauna.many],
      ['place', CATEGORY_LABEL.place.many],
      ...(this.extra ? ([['lore', 'Lore']] as [Tab, string][]) : []),
      ['album', 'Album'],
    ];
    this.tabs.innerHTML = tabs
      .map(([t, label]) => {
        const c = t === 'album' ? `${j.photos.length}` : t === 'quests' ? this.extra?.questCount() ?? '' : t === 'lore' ? this.extra?.loreCount() ?? '' : (() => {
          const k = j.counts(t);
          return `${k.got}/${k.total}`;
        })();
        return `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === this.tab}" class="${t === this.tab ? 'on' : ''}">${label}<em>${c}</em></button>`;
      })
      .join('');

    if (this.tab === 'quests' || this.tab === 'lore') {
      this.body.innerHTML = this.tab === 'quests' ? this.extra?.quests() ?? '' : this.extra?.lore() ?? '';
      return;
    }
    if (this.tab === 'album') {
      const photos = j.photos;
      this.body.innerHTML = photos.length
        ? `<div class="jr-album">${photos.map((p) => `<button type="button" class="jr-shot" data-photo="${p.key}"><img data-key="${p.key}" alt="" /><span>${esc(p.subject ? BY_ID.get(p.subject)?.name ?? '' : p.where)}</span></button>`).join('')}</div>`
        : `<p class="jr-empty">No photos yet. Raise the lens with Z (or hold the right mouse button) and click to take one.</p>`;
      this.loadImages();
      return;
    }
    const list = CATALOG.filter((e) => e.cat === this.tab);
    this.body.innerHTML = `<div class="jr-grid">${list.map((e) => this.card(e)).join('')}</div>`;
    this.loadImages();
  }

  private card(e: Entry): string {
    const j = this.journal;
    const got = j.isCollected(e.id);
    const seen = j.isSeen(e.id);
    const photo = j.photoFor(e.id);
    const rar = `<i class="jr-rar r-${e.rarity}">${e.rarity}</i>`;
    if (got && photo) {
      return `<button type="button" class="jr-card got" data-entry="${e.id}">
        <div class="jr-pic"><img data-key="${photo.key}" alt="" /></div>
        <div class="jr-txt"><b>${esc(e.name)}</b><em>${esc(e.latin)}</em>${rar}</div>
      </button>`;
    }
    if (seen) {
      const how = e.cat === 'place' ? 'Found · photograph it to keep it' : 'Found · frame it in the macro lens to collect it';
      return `<button type="button" class="jr-card seen" data-entry="${e.id}">
        <div class="jr-pic blank">${ICON[e.cat]}</div>
        <div class="jr-txt"><b>${esc(e.name)}</b><em>${esc(how)}</em>${rar}</div>
      </button>`;
    }
    return `<div class="jr-card unknown">
        <div class="jr-pic blank q">?</div>
        <div class="jr-txt"><b>Unknown ${esc(CATEGORY_LABEL[e.cat].one)}</b><em>“${esc(e.hint)}”</em></div>
      </div>`;
  }

  private loadImages(root: HTMLElement = this.el): void {
    root.querySelectorAll<HTMLImageElement>('img[data-key]').forEach((img) => {
      void this.journal.url(img.dataset.key!).then((u) => {
        if (u) img.src = u;
        else img.closest('.jr-pic, .jr-shot')?.classList.add('missing');
      });
    });
  }

  private async openEntry(id: string): Promise<void> {
    const e = BY_ID.get(id);
    if (!e) return;
    const j = this.journal;
    const photo = j.photoFor(id);
    const others = j.photosOf(id);
    const timeNote = e.when ? `<p class="jv-when">Seen at: ${e.when.join(', ').toLowerCase()}</p>` : '';
    this.viewer.innerHTML = `
      <div class="jv-card">
        <button type="button" class="jv-back" aria-label="Back">←</button>
        ${photo ? `<div class="jv-photo"><img data-key="${photo.key}" alt="${esc(e.name)}" /></div>` : `<div class="jv-photo blank">${ICON[e.cat]}</div>`}
        <div class="jv-info">
          <div class="jv-kicker">${esc(CATEGORY_LABEL[e.cat].one)} · <i class="jr-rar r-${e.rarity}">${e.rarity}</i></div>
          <h3>${esc(e.name)}</h3>
          <p class="jv-latin">${esc(e.latin)}</p>
          <p class="jv-blurb">${esc(e.blurb)}</p>
          ${timeNote}
          ${photo ? `<p class="jv-meta">${esc(metaLine(photo))}</p>` : `<p class="jv-meta">${e.cat === 'place' ? 'Not yet photographed. Raise the lens (Z) and frame it.' : 'Not yet collected. Raise the macro lens (Z), centre it in the reticle at a good distance and hold still until it is in focus.'}</p>`}
          ${photo ? `<div class="jv-actions"><button type="button" data-act="save" data-key="${photo.key}" data-id="${e.id}">Save photo</button></div>` : ''}
          ${others.length > 1 ? `<div class="jv-strip">${others.map((p) => `<button type="button" class="${p.key === photo?.key ? 'on' : ''}" data-act="cover" data-key="${p.key}" data-id="${e.id}" title="Use as journal photo"><img data-key="${p.key}" alt="" /></button>`).join('')}</div>` : ''}
        </div>
      </div>`;
    this.viewer.hidden = false;
    this.loadImages(this.viewer);
  }

  private async openPhoto(key: string): Promise<void> {
    const p = this.journal.photo(key);
    if (!p) return;
    const e = p.subject ? BY_ID.get(p.subject) : undefined;
    const isCover = e && this.journal.photoFor(e.id)?.key === key;
    this.viewer.innerHTML = `
      <div class="jv-card wide">
        <button type="button" class="jv-back" aria-label="Back">←</button>
        <div class="jv-photo"><img data-key="${key}" alt="" /></div>
        <div class="jv-info">
          <div class="jv-kicker">${e ? esc(CATEGORY_LABEL[e.cat].one) : 'photo'}</div>
          <h3>${esc(e ? e.name : p.where)}</h3>
          <p class="jv-meta">${esc(metaLine(p))}</p>
          <div class="jv-actions">
            <button type="button" data-act="save" data-key="${key}" data-id="${e?.id ?? ''}">Save photo</button>
            ${isCover ? '' : `<button type="button" data-act="delete" data-key="${key}">Delete</button>`}
          </div>
        </div>
      </div>`;
    this.viewer.hidden = false;
    this.loadImages(this.viewer);
  }

  private closeViewer(): void {
    this.viewer.hidden = true;
    this.viewer.innerHTML = '';
  }

  private async act(act: string, key: string, id?: string): Promise<void> {
    if (act === 'save') {
      const u = await this.journal.url(key);
      if (!u) return;
      const p = this.journal.photo(key);
      const name = (id ? BY_ID.get(id)?.name : p?.where) ?? 'photo';
      const a = document.createElement('a');
      a.href = u;
      a.download = `touchgrass-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date(p?.at ?? Date.now()).toISOString().slice(0, 10)}.jpg`;
      a.click();
    } else if (act === 'delete') {
      await this.journal.deletePhoto(key);
      this.closeViewer();
      this.render();
    } else if (act === 'cover' && id) {
      this.journal.setCover(id, key);
      await this.openEntry(id);
    }
  }
}
