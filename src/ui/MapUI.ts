import { sampleNoise } from '../core/noise';
import { BY_ID } from '../discovery/catalog';
import type { Game } from '../game/Game';
import { SIGILS } from '../game/lore';
import { mountainMask, smoothstep, terrainHeight } from '../world/common';
import { cellPools, FEATURE_CELL } from '../world/Features';
import { CASTLE, ISLANDS } from '../world/realm/Skyward';
import type { Realm } from '../world/realm/World';

/** The square of the world the map shows. */
export const MAP = { x0: -2330, z0: -1480, size: 3400 };
/** Fog-of-war grid over the same square. */
export const FOG_N = 74;

const BASE = 320;
const PX = 1100;

export interface MapMarks {
  player: { x: number; z: number; yaw: number };
  places: Map<string, { x: number; z: number }>;
  target: { x: number; z: number } | null;
  chests: number[];
  fog: Uint8Array;
}

/**
 * The map of the realm (Tab): an inked parchment drawn from the real terrain, woods, pools and
 * roads. It starts under cloud and clears where you have been; places appear as you find them.
 */
export class MapUI {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly info: HTMLElement;
  private base: HTMLCanvasElement | null = null;
  visible = false;
  onChange: ((open: boolean) => void) | null = null;
  marks: () => MapMarks = () => ({ player: { x: 0, z: 0, yaw: 0 }, places: new Map(), target: null, chests: [], fog: new Uint8Array(FOG_N * FOG_N) });

  constructor(private readonly realm: Realm, private readonly game: Game) {
    this.el = document.createElement('div');
    this.el.className = 'map';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Map of the realm');
    this.el.innerHTML = `
      <div class="mp-card">
        <header><span class="mp-title">Map of the Realm</span><span class="mp-info"></span><button type="button" class="mp-close">Tab · Esc</button></header>
        <canvas width="${PX}" height="${PX}"></canvas>
      </div>`;
    this.canvas = this.el.querySelector('canvas')!;
    this.info = this.el.querySelector('.mp-info')!;
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el || (e.target as HTMLElement).closest('.mp-close')) this.hide();
    });
    window.addEventListener('keydown', (e) => {
      if (this.visible && e.code === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });
  }

  show(): void {
    this.visible = true;
    this.draw();
    this.el.classList.add('on');
    if (document.pointerLockElement) document.exitPointerLock();
    this.onChange?.(true);
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('on');
    this.onChange?.(false);
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  /** The land itself: meadow, wood, rock and snow, shaded from the north-west. Drawn once. */
  private terrain(): HTMLCanvasElement {
    if (this.base) return this.base;
    const c = document.createElement('canvas');
    c.width = c.height = BASE;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(BASE, BASE);
    const step = MAP.size / BASE;
    const h = new Float32Array((BASE + 1) * (BASE + 1));
    for (let j = 0; j <= BASE; j++) for (let i = 0; i <= BASE; i++) h[j * (BASE + 1) + i] = terrainHeight(MAP.x0 + i * step, MAP.z0 + j * step);
    for (let j = 0; j < BASE; j++) {
      for (let i = 0; i < BASE; i++) {
        const x = MAP.x0 + (i + 0.5) * step;
        const z = MAP.z0 + (j + 0.5) * step;
        const hh = h[j * (BASE + 1) + i];
        const shade = Math.max(-1, Math.min(1, ((h[j * (BASE + 1) + i + 1] - hh) + (h[(j + 1) * (BASE + 1) + i] - hh)) / (step * 0.9)));
        const mm = mountainMask(x, z);
        const wood = smoothstep(0.56, 0.68, sampleNoise(x / 1500 + 0.17, z / 1500 + 0.53, 1)) * (1 - smoothstep(0.02, 0.2, mm));
        const grain = (sampleNoise(x / 90, z / 90, 0) - 0.5) * 14;
        let r = 214;
        let g = 205;
        let b = 160;
        // Woods: darker green, stippled.
        const stipple = wood > 0.35 && (i * 7 + j * 13) % 5 === 0 ? -26 : 0;
        r += (132 - r) * wood * 0.85 + stipple;
        g += (156 - g) * wood * 0.85 + stipple;
        b += (104 - b) * wood * 0.85 + stipple;
        // Rock, then snow.
        const rock = smoothstep(0.08, 0.45, mm);
        r += (176 - r) * rock;
        g += (160 - g) * rock;
        b += (134 - b) * rock;
        const snow = smoothstep(210, 330, hh) * rock;
        r += (244 - r) * snow;
        g += (241 - g) * snow;
        b += (232 - b) * snow;
        const k = 1 - shade * (0.2 + rock * 0.35);
        const o = (j * BASE + i) * 4;
        img.data[o] = Math.max(0, Math.min(255, (r + grain) * k));
        img.data[o + 1] = Math.max(0, Math.min(255, (g + grain) * k));
        img.data[o + 2] = Math.max(0, Math.min(255, (b + grain * 0.8) * k));
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.base = c;
    return c;
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d')!;
    const m = this.marks();
    const S = PX / MAP.size;
    const X = (x: number) => (x - MAP.x0) * S;
    const Z = (z: number) => (z - MAP.z0) * S;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.terrain(), 0, 0, PX, PX);
    const ink = '#3a2c1e';
    const serif = "'Cormorant Garamond', Georgia, serif";

    // Pools.
    ctx.fillStyle = '#7fb0c4';
    ctx.strokeStyle = 'rgba(58,44,30,0.55)';
    ctx.lineWidth = 0.8;
    const c0 = Math.floor(MAP.x0 / FEATURE_CELL);
    const c1 = Math.ceil((MAP.x0 + MAP.size) / FEATURE_CELL);
    const d0 = Math.floor(MAP.z0 / FEATURE_CELL);
    const d1 = Math.ceil((MAP.z0 + MAP.size) / FEATURE_CELL);
    for (let i = c0; i < c1; i++) {
      for (let j = d0; j < d1; j++) {
        for (const p of cellPools(i, j)) {
          ctx.beginPath();
          ctx.ellipse(X(p.x), Z(p.z), Math.max(1.6, p.r * S * 1.2), Math.max(1.4, p.r * S), 0.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Roads: inked, the named ones heavier.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const road of this.realm.roads) {
      if (road.pave > 0.5 && road.halfW < 2.5) continue;
      ctx.beginPath();
      road.pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Z(p.z)) : ctx.moveTo(X(p.x), Z(p.z))));
      ctx.strokeStyle = 'rgba(244,234,204,0.9)';
      ctx.lineWidth = road.name ? 4.4 : 3.2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(92,66,40,0.9)';
      ctx.lineWidth = road.name ? 1.8 : 1.1;
      ctx.setLineDash(road.name ? [] : [5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Floating islands: outlines with a shadow, since they are not on the ground.
    for (const isl of ISLANDS) {
      ctx.beginPath();
      ctx.ellipse(X(isl.x), Z(isl.z), isl.R * S, isl.R * S * 0.8, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fill();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = 'rgba(58,44,30,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Cloud over what has not been walked.
    const fog = document.createElement('canvas');
    fog.width = fog.height = FOG_N;
    const fctx = fog.getContext('2d')!;
    const fimg = fctx.createImageData(FOG_N, FOG_N);
    let seenCells = 0;
    for (let i = 0; i < FOG_N * FOG_N; i++) {
      const seen = m.fog[i] > 0;
      if (seen) seenCells++;
      fimg.data[i * 4] = 232;
      fimg.data[i * 4 + 1] = 224;
      fimg.data[i * 4 + 2] = 204;
      fimg.data[i * 4 + 3] = seen ? 0 : 176;
    }
    fctx.putImageData(fimg, 0, 0);
    ctx.save();
    ctx.filter = 'blur(9px)';
    ctx.drawImage(fog, -8, -8, PX + 16, PX + 16);
    ctx.restore();

    const label = (text: string, x: number, y: number, size: number, italic = false, color = ink) => {
      ctx.font = `${italic ? 'italic ' : ''}600 ${size}px ${serif}`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(240,232,206,0.92)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    const j = this.game.journal;

    // The great places: a drawn sign once found, a faint question mark before.
    for (const s of this.realm.sites) {
      const x = X(s.x);
      const y = Z(s.z);
      const found = j.isSeen(`site:${s.id}`);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(1.4, 1.4);
      ctx.strokeStyle = ink;
      ctx.fillStyle = found ? '#f4ead0' : 'rgba(244,234,208,0.5)';
      ctx.lineWidth = 1.6;
      if (!found) {
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        label('?', 0, 6, 17);
      } else if (s.kind === 'city') {
        ctx.beginPath();
        const cr = (s.r * S) / 1.4;
        ctx.arc(0, 0, cr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ctx.fillStyle = ink;
          ctx.fillRect(Math.cos(a) * cr - 2.5, Math.sin(a) * cr - 2.5, 5, 5);
        }
        ctx.fillStyle = '#9fd8e8';
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (s.kind === 'pillar') {
        ctx.beginPath();
        ctx.moveTo(-5, 8);
        ctx.lineTo(-3, -18);
        ctx.lineTo(3, -18);
        ctx.lineTo(5, 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#9fd8e8';
        ctx.beginPath();
        ctx.moveTo(0, -27);
        ctx.lineTo(3.5, -20);
        ctx.lineTo(-3.5, -20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (s.kind === 'crystals') {
        for (const [dx, hh] of [[-6, 9], [0, 15], [6, 10]]) {
          ctx.fillStyle = '#9fd8e8';
          ctx.beginPath();
          ctx.moveTo(dx - 3, 6);
          ctx.lineTo(dx, 6 - hh);
          ctx.lineTo(dx + 3, 6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else if (s.kind === 'ring') {
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2;
          ctx.fillStyle = ink;
          ctx.fillRect(Math.cos(a) * 8 - 1.3, Math.sin(a) * 8 - 2.2, 2.6, 4.4);
        }
      } else if (s.kind === 'grove') {
        for (const [dx, dy] of [[-6, 2], [5, 3], [0, -5]]) {
          ctx.fillStyle = '#f0b6c8';
          ctx.beginPath();
          ctx.arc(dx, dy, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      } else if (s.kind === 'ruins' || s.kind === 'pass') {
        ctx.beginPath();
        ctx.rect(-4, -12, 8, 18);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-4, -12);
        ctx.lineTo(-4, -15);
        ctx.lineTo(-1.5, -15);
        ctx.lineTo(-1.5, -12);
        ctx.moveTo(1.5, -12);
        ctx.lineTo(1.5, -15);
        ctx.lineTo(4, -15);
        ctx.lineTo(4, -12);
        ctx.stroke();
      } else {
        for (const dx of [-7, 2]) {
          ctx.fillStyle = '#f4ead0';
          ctx.beginPath();
          ctx.rect(dx, -2, 7, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#b8603a';
          ctx.beginPath();
          ctx.moveTo(dx - 1.5, -2);
          ctx.lineTo(dx + 3.5, -8);
          ctx.lineTo(dx + 8.5, -2);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
      if (found) label(s.name, x, y + (s.kind === 'city' ? s.r * S + 26 : 36), s.kind === 'city' ? 30 : 24);
    }

    // Hidden places and the great tree, once found.
    for (const q of this.realm.plan.secrets) {
      if (!j.isSeen(q.id)) continue;
      const x = X(q.x);
      const y = Z(q.z);
      ctx.fillStyle = '#c8402a';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.strokeRect(-3.5, -3.5, 7, 7);
      ctx.restore();
      label(BY_ID.get(q.id)?.name ?? '', x, y + 22, 20, true, '#7a2a1c');
    }
    if (j.isSeen('skyshrine')) {
      const isl = ISLANDS.find((i) => i.shrine);
      if (isl) label('The Sky Shrine', X(isl.x), Z(isl.z) + 6, 20, true, '#7a2a1c');
    }

    // Sigils woken, chests opened.
    for (const s of SIGILS) {
      const p = m.places.get(`sigil:${s.id}`);
      if (!p || !(this.game.hasSigil(s.id) || this.game.has(`rev:${s.id}`))) continue;
      const woke = this.game.hasSigil(s.id);
      ctx.beginPath();
      ctx.arc(X(p.x), Z(p.z) - 14, 9, 0, Math.PI * 2);
      ctx.fillStyle = woke ? s.color : 'rgba(244,234,208,0.8)';
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.font = '13px serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = ink;
      ctx.fillText(s.glyph, X(p.x), Z(p.z) - 9.5);
    }
    for (const i of m.chests) {
      const p = m.places.get(`chest:${i}`);
      if (!p) continue;
      ctx.fillStyle = '#c8a24a';
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.2;
      ctx.fillRect(X(p.x) - 5, Z(p.z) - 3.5, 10, 7);
      ctx.strokeRect(X(p.x) - 5, Z(p.z) - 3.5, 10, 7);
      ctx.beginPath();
      ctx.moveTo(X(p.x) - 5, Z(p.z) - 0.5);
      ctx.lineTo(X(p.x) + 5, Z(p.z) - 0.5);
      ctx.stroke();
    }

    // Where the quest points.
    if (m.target) {
      const x = Math.max(14, Math.min(PX - 14, X(m.target.x)));
      const y = Math.max(14, Math.min(PX - 14, Z(m.target.z)));
      ctx.strokeStyle = '#d8402a';
      ctx.lineWidth = 2.4;
      for (const rr of [9, 15]) {
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // The castle lies off the southern edge.
    const cx = Math.max(60, Math.min(PX - 60, X(CASTLE.x)));
    label('↓ The Floating Castle', cx, PX - 18, 24, true);

    // Compass rose.
    ctx.save();
    ctx.translate(PX - 70, 76);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -38);
      ctx.lineTo(5, 0);
      ctx.lineTo(-5, 0);
      ctx.closePath();
      k === 3 ? ctx.fill() : ctx.stroke();
    }
    ctx.restore();
    label('N', PX - 70, 30, 18);

    // You.
    {
      const x = Math.max(10, Math.min(PX - 10, X(m.player.x)));
      const y = Math.max(10, Math.min(PX - 10, Z(m.player.z)));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-m.player.yaw);
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(216,244,108,0.28)';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(8, 9);
      ctx.lineTo(0, 4);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fillStyle = '#d8402a';
      ctx.strokeStyle = '#fff8e0';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    const pct = Math.round((seenCells / (FOG_N * FOG_N)) * 100);
    this.info.textContent = `${pct}% charted · ${this.game.completion()}% of the realm complete`;
  }
}
