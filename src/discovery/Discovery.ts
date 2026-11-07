import { MathUtils, type PerspectiveCamera, Vector3 } from 'three';
import type { TimeName } from '../core/params';
import { U } from '../core/uniforms';
import { terrainHeight } from '../world/common';
import type { Subject } from '../world/life/RareFlora';
import { CASTLE } from '../world/realm/Skyward';
import type { Realm } from '../world/realm/World';
import { BY_ID, type Entry } from './catalog';
import type { Journal } from './Journal';

export type LensStatus = 'idle' | 'far' | 'near' | 'small' | 'asleep' | 'hidden' | 'shaky' | 'focus' | 'locked';

export interface LensState {
  subject: Entry | null;
  known: boolean;
  collected: boolean;
  /** Metres from the lens to the subject (NaN with no subject). */
  dist: number;
  /** Equivalent focal length. */
  mm: number;
  status: LensStatus;
  /** Focus settling 0..1. */
  progress: number;
  /** Subject on screen: centre in 0..1 (y down) and radius as a fraction of the screen height. */
  sx: number;
  sy: number;
  sr: number;
  /** Reticle radius as a fraction of the screen height. */
  reticle: number;
}

/** Height of the landmark to frame above each kind of site's ground level. */
const SITE_H: Record<string, [number, number]> = {
  city: [16, 50],
  village: [6, 25],
  ruins: [6, 18],
  crystals: [9, 30],
  pass: [12, 8],
  grove: [4, 10],
  pillar: [140, 40],
  ring: [3, 14],
  meadow: [2, 10],
};

const RETICLE = 0.085; // radius, fraction of screen height
const FOCUS_TIME = 0.85;

/**
 * Finding and collecting. Every frame it gathers the subjects around the camera (rare flowers,
 * animals, places), names the ones you come near for the first time, and, while the lens is up,
 * judges whatever sits in the reticle: is it centred, at a good distance, big enough in the
 * frame, held still while the focus settles? When all of that holds, the shot is taken.
 */
export class Discovery {
  readonly state: LensState = { subject: null, known: false, collected: false, dist: NaN, mm: 50, status: 'idle', progress: 0, sx: 0.5, sy: 0.5, sr: 0, reticle: RETICLE };
  private readonly subjects: Subject[] = [];
  private readonly places: Subject[] = [];
  private readonly fwd = new Vector3();
  private readonly prevFwd = new Vector3(0, 0, -1);
  private readonly v = new Vector3();
  private readonly p = new Vector3();
  private turn = 0;
  private currentId: string | null = null;
  private lockedFor: string | null = null;
  private cooldown = 0;
  private scanT = 0;
  private blockedT = 0;
  /** Where the framed subject is (for the grass to part toward it), or null. */
  focusPoint: { x: number; y: number; z: number } | null = null;

  onDiscover: ((e: Entry) => void) | null = null;
  /** The focus has settled on something not yet in the journal: take the picture. */
  onAutoShot: (() => void) | null = null;
  onLock: (() => void) | null = null;

  constructor(
    private readonly realm: Realm,
    private readonly journal: Journal,
    private readonly sources: ((out: Subject[]) => void)[],
    private readonly shrine: () => Vector3 | null,
  ) {
    for (const s of realm.sites) {
      const [h, r] = SITE_H[s.kind] ?? [4, 10];
      this.places.push({ id: `site:${s.id}`, x: s.x, y: s.level + h, z: s.z, r });
    }
    for (const q of realm.plan.secrets) this.places.push({ id: q.id, x: q.x, y: terrainHeight(q.x, q.z) + q.h, z: q.z, r: q.r });
    this.places.push({ id: 'castle', x: CASTLE.x, y: (CASTLE.bottom + CASTLE.top) / 2, z: CASTLE.z, r: 260 });
  }

  /** Place subjects need final ground heights (call once the world is built). */
  settle(): void {
    for (const p of this.places) {
      const q = this.realm.plan.secrets.find((s) => s.id === p.id);
      if (q) p.y = terrainHeight(q.x, q.z) + q.h;
    }
    const tree = U.uTree.value;
    const crown = U.uTreeCanopy.value;
    if (tree.w > 0) this.places.push({ id: 'tree', x: crown.x, y: crown.y, z: crown.z, r: Math.max(6, crown.w * 0.8) });
    const sh = this.shrine();
    if (sh) this.places.push({ id: 'skyshrine', x: sh.x, y: sh.y, z: sh.z, r: 3 });
  }

  private active(e: Entry, tod: TimeName): boolean {
    return !e.when || e.when.includes(tod);
  }

  /** The subject in the reticle right now, if the shot would count. */
  get shotSubject(): Entry | null {
    const s = this.state;
    return s.subject && (s.status === 'focus' || s.status === 'locked' || s.status === 'shaky') ? s.subject : null;
  }

  update(dt: number, cam: PerspectiveCamera, lens: boolean, tod: TimeName, centerDepth = NaN): LensState {
    const subs = this.subjects;
    subs.length = 0;
    for (const src of this.sources) src(subs);
    for (const p of this.places) subs.push(p);

    cam.getWorldDirection(this.fwd);
    const cp = cam.position;
    // How fast the view is turning (rad/s), smoothed.
    const ang = this.fwd.angleTo(this.prevFwd);
    this.prevFwd.copy(this.fwd);
    this.turn += (ang / Math.max(dt, 1e-3) - this.turn) * Math.min(1, dt * 8);

    // ---- discovery by coming near (a few times a second is plenty) ----
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.2;
      for (const s of subs) {
        if (this.journal.isSeen(s.id)) continue;
        const e = BY_ID.get(s.id);
        if (!e) continue;
        const d = e.id === 'castle' ? Math.hypot(s.x - cp.x, s.z - cp.z) : this.v.set(s.x - cp.x, s.y - cp.y, s.z - cp.z).length();
        if (d > e.discover) continue;
        if (e.cat !== 'place') {
          if (!this.active(e, tod) && e.cat === 'fauna') continue;
          const look = this.v.set(s.x - cp.x, s.y - cp.y, s.z - cp.z).normalize().dot(this.fwd);
          if (look < 0.55 && d > e.discover * 0.35) continue;
        }
        if (this.journal.discover(e.id)) this.onDiscover?.(e);
      }
    }

    // ---- the lens ----
    const st = this.state;
    const vh = MathUtils.degToRad(cam.fov) / 2;
    st.mm = 12 / Math.tan(vh);
    st.reticle = RETICLE;
    this.focusPoint = null;
    if (!lens) {
      st.subject = null;
      st.status = 'idle';
      st.progress = 0;
      this.currentId = null;
      return st;
    }
    this.cooldown -= dt;
    const retAng = RETICLE * 2 * vh;
    let best: Subject | null = null;
    let bestScore = Infinity;
    let bestD = 0;
    let bestAng = 0;
    let bestAngR = 0;
    for (const s of subs) {
      const e = BY_ID.get(s.id);
      if (!e) continue;
      this.v.set(s.x - cp.x, s.y - cp.y, s.z - cp.z);
      const d = this.v.length();
      if (d < 0.05 || d > e.far * 1.8) continue;
      const a = Math.acos(MathUtils.clamp(this.v.dot(this.fwd) / d, -1, 1));
      const aR = Math.atan(s.r / d);
      if (a > retAng + aR * 0.7) continue;
      // Nearest the centre wins; small things right on the crosshair beat big things around it.
      const score = a / (retAng + aR) + (e.cat === 'place' ? 0.35 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = s;
        bestD = d;
        bestAng = a;
        bestAngR = aR;
      }
    }
    void bestAng;

    if (!best) {
      st.subject = null;
      st.status = 'idle';
      st.progress = Math.max(0, st.progress - dt * 3);
      st.dist = NaN;
      this.currentId = null;
      return st;
    }
    const e = BY_ID.get(best.id)!;
    this.focusPoint = e.cat === 'place' ? null : { x: best.x, y: best.y, z: best.z };
    if (this.currentId !== best.id) st.progress = 0;
    this.currentId = best.id;
    // Seen through the lens counts as a discovery too (a kite far overhead, a deer across the valley).
    if (!this.journal.isSeen(e.id) && this.journal.discover(e.id)) this.onDiscover?.(e);
    st.subject = e;
    st.known = this.journal.isSeen(e.id);
    st.collected = this.journal.isCollected(e.id);
    st.dist = bestD;
    const fill = bestAngR / vh;
    this.p.set(best.x, best.y, best.z).project(cam);
    st.sx = this.p.x * 0.5 + 0.5;
    st.sy = 0.5 - this.p.y * 0.5;
    st.sr = Math.min(0.5, fill * 0.5);

    let status: LensStatus;
    if (!this.active(e, tod)) status = 'asleep';
    else if (bestD < e.near) status = 'near';
    else if (bestD > e.far) status = 'far';
    else if (fill < e.fill) status = 'small';
    // Something in front of it (grass, a wall, a branch): the depth at the centre is nearer than the subject.
    else if (Number.isFinite(centerDepth) && e.cat !== 'place' && centerDepth < bestD - Math.max(0.3, best.r * 1.3)) {
      this.blockedT += dt;
      status = this.blockedT > 0.25 ? 'hidden' : 'shaky';
    }
    else if (this.turn > 0.5) status = 'shaky';
    else status = 'focus';
    if (status !== 'hidden' && status !== 'shaky') this.blockedT = 0;

    const prev = st.status;
    if (status === 'focus') {
      st.progress = Math.min(1, st.progress + dt / FOCUS_TIME);
      if (st.progress >= 1) status = 'locked';
    } else if (status === 'shaky') {
      st.progress = Math.max(0, st.progress - dt * 1.5);
    } else {
      st.progress = Math.max(0, st.progress - dt * 3);
    }
    st.status = status;
    if (status === 'locked' && prev !== 'locked') {
      this.onLock?.();
      if (!st.collected && this.cooldown <= 0 && this.lockedFor !== best.id) {
        this.lockedFor = best.id;
        this.cooldown = 2;
        this.onAutoShot?.();
      }
    }
    if (status !== 'locked' && status !== 'focus') this.lockedFor = null;
    return st;
  }
}
