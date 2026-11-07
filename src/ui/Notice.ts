import { CATEGORY_LABEL, type Entry } from '../discovery/catalog';

interface Item {
  kind: 'found' | 'got';
  entry: Entry;
  img?: string;
  line?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Discovery and collection banners: "You found a new rare flower: Edelweiss", and the
 * photo card that slides in when something is added to the journal. Queued, one at a time.
 */
export class Notice {
  private readonly el: HTMLElement;
  private readonly queue: Item[] = [];
  private busy = false;
  onOpen: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'notice';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.el);
    this.el.addEventListener('click', () => this.onOpen?.());
  }

  found(entry: Entry, note?: string): void {
    this.push({ kind: 'found', entry, line: note });
  }

  got(entry: Entry, img: string, line: string): void {
    // A collection supersedes a pending discovery banner of the same thing.
    const i = this.queue.findIndex((q) => q.entry.id === entry.id && q.kind === 'found');
    if (i >= 0) this.queue.splice(i, 1);
    this.push({ kind: 'got', entry, img, line });
  }

  private push(it: Item): void {
    this.queue.push(it);
    if (!this.busy) this.next();
  }

  private next(): void {
    const it = this.queue.shift();
    if (!it) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const e = it.entry;
    const label = CATEGORY_LABEL[e.cat];
    const rare = e.rarity === 'legendary' ? 'legendary' : e.rarity === 'rare' ? 'rare' : '';
    if (it.kind === 'found') {
      const how = e.cat === 'place' ? 'Photograph it with the lens (Z) to keep it in your journal' : 'Frame it in the macro lens (Z) and hold it in focus to collect it';
      this.el.innerHTML = `
        <div class="nt-card nt-found ${rare}">
          <div class="nt-kicker">${esc(label.found)}${rare ? ` · <b>${rare}</b>` : ''}</div>
          <div class="nt-name">${esc(e.name)}</div>
          <div class="nt-latin">${esc(e.latin)}</div>
          <div class="nt-how">${esc(it.line ?? how)}</div>
        </div>`;
    } else {
      this.el.innerHTML = `
        <div class="nt-card nt-got ${rare}">
          <img class="nt-photo" src="${it.img}" alt="" />
          <div class="nt-body">
            <div class="nt-kicker">Added to your journal</div>
            <div class="nt-name">${esc(e.name)}</div>
            <div class="nt-how">${esc(it.line ?? '')} · J to open</div>
          </div>
        </div>`;
    }
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    const ms = it.kind === 'got' ? 5200 : 5600;
    window.setTimeout(() => {
      this.el.classList.remove('on');
      window.setTimeout(() => this.next(), 650);
    }, ms);
  }
}
