import type { QuestView, Rank } from '../game/Game';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

interface Fanfare {
  kicker: string;
  title: string;
  sub: string;
  tone: 'rank' | 'quest' | 'legend';
}

/**
 * The game's chrome: the quest tracker with rank and experience, the "E" prompt, fanfares for
 * ranks and finished quests, a feed of what was just earned, the reading card for stones, pages
 * and relics, and the wind trial's clock.
 */
export class GameHUD {
  private readonly tracker: HTMLElement;
  private readonly promptEl: HTMLElement;
  private readonly fan: HTMLElement;
  private readonly feedEl: HTMLElement;
  private readonly reader: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly heartsEl: HTMLElement;
  private readonly queue: Fanfare[] = [];
  private busy = false;
  private lastTracker = '';
  private lastPrompt = '';
  reading = false;
  onReaderClose: (() => void) | null = null;
  onTrackerClick: (() => void) | null = null;

  constructor(private readonly coarse: boolean) {
    const mk = (cls: string, role?: string) => {
      const el = document.createElement('div');
      el.className = cls;
      if (role) el.setAttribute('role', role);
      document.body.appendChild(el);
      return el;
    };
    this.tracker = mk('gh-tracker');
    this.promptEl = mk('gh-prompt', 'status');
    this.fan = mk('gh-fanfare', 'status');
    this.feedEl = mk('gh-feed');
    this.reader = mk('gh-reader', 'dialog');
    this.timerEl = mk('gh-timer');
    this.heartsEl = mk('gh-hearts');
    this.tracker.addEventListener('click', () => this.onTrackerClick?.());
    this.promptEl.addEventListener('click', () => this.onPromptTap?.());
    this.reader.addEventListener('click', (e) => {
      if (e.target === this.reader || (e.target as HTMLElement).closest('.gr-close')) this.closeReader();
    });
  }

  /** Touch screens tap the prompt instead of pressing E. */
  onPromptTap: (() => void) | null = null;

  show(on: boolean): void {
    this.tracker.classList.toggle('on', on);
  }

  setTracker(rank: Rank, quest: QuestView | null, wisps: number, wispTotal: number, dist: string | null, pct: number): void {
    const step = quest?.steps.find((s) => !s.done);
    const prog = step && step.of !== undefined ? ` <em>${step.n}/${step.of}</em>` : '';
    const doneSteps = quest ? quest.steps.filter((s) => s.done).length : 0;
    const multi = quest && quest.steps.length > 1 && quest.id !== 'm2' ? '' : quest && quest.id === 'm2' ? ` <em>${doneSteps}/${quest.steps.length}</em>` : '';
    const html = `
      <div class="gt-rank"><span class="gt-lv"><b>${rank.level + 1}</b></span><span class="gt-name">${esc(rank.name)}</span><span class="gt-xp">${rank.xp} xp</span><span class="gt-wisps" title="Lights gathered">✦ ${wisps}<i>/${wispTotal}</i></span><span class="gt-pct" title="Realm completed">${pct}%</span></div>
      <div class="gt-bar"><i style="width:${(rank.frac * 100).toFixed(1)}%"></i></div>
      ${
        quest
          ? `<div class="gt-quest ${quest.kind}"><span class="gt-kind">${quest.kind === 'main' ? 'Story' : 'Quest'}</span><b>${esc(quest.title)}</b>${multi}</div>
             <div class="gt-step">${step ? esc(step.text) : ''}${prog}${dist ? `<span class="gt-dist">${dist}</span>` : ''}</div>`
          : `<div class="gt-quest"><b>The realm is yours</b></div><div class="gt-step">Every quest is done. Wander.</div>`
      }`;
    if (html === this.lastTracker) return;
    this.lastTracker = html;
    this.tracker.innerHTML = html;
  }

  prompt(text: string | null): void {
    const t = text ?? '';
    if (t === this.lastPrompt) return;
    this.lastPrompt = t;
    if (t) this.promptEl.innerHTML = `${this.coarse ? '' : '<kbd>E</kbd>'}<span>${esc(t)}</span>`;
    this.promptEl.classList.toggle('on', !!t);
  }

  fanfare(kicker: string, title: string, sub: string, tone: Fanfare['tone'] = 'quest'): void {
    this.queue.push({ kicker, title, sub, tone });
    if (!this.busy) this.next();
  }

  private next(): void {
    const f = this.queue.shift();
    if (!f) {
      this.busy = false;
      return;
    }
    this.busy = true;
    this.fan.innerHTML = `<div class="gf-card ${f.tone}"><div class="gf-rays"></div><div class="gf-kicker">${esc(f.kicker)}</div><div class="gf-line"></div><div class="gf-title">${esc(f.title)}</div><div class="gf-sub">${esc(f.sub)}</div></div>`;
    this.fan.classList.remove('on');
    void this.fan.offsetWidth;
    this.fan.classList.add('on');
    window.setTimeout(() => {
      this.fan.classList.remove('on');
      window.setTimeout(() => this.next(), 700);
    }, 4600);
  }

  feed(text: string): void {
    const el = document.createElement('div');
    el.className = 'gfd';
    el.textContent = text;
    this.feedEl.appendChild(el);
    while (this.feedEl.children.length > 5) this.feedEl.firstElementChild!.remove();
    window.setTimeout(() => el.classList.add('out'), 3200);
    window.setTimeout(() => el.remove(), 4200);
  }

  /** Open the reading card: a stone's inscription, a diary page, a relic. */
  read(kicker: string, title: string, paragraphs: string[], footer = '', glyph = '', color = ''): void {
    this.reading = true;
    this.reader.innerHTML = `
      <div class="gr-card" ${color ? `style="--tint:${color}"` : ''}>
        ${glyph ? `<div class="gr-glyph">${esc(glyph)}</div>` : ''}
        <div class="gr-kicker">${esc(kicker)}</div>
        <h3>${esc(title)}</h3>
        <div class="gr-text">${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
        ${footer ? `<div class="gr-foot">${esc(footer)}</div>` : ''}
        <button type="button" class="gr-close">${this.coarse ? 'close' : 'E · Esc to close'}</button>
      </div>`;
    this.reader.classList.add('on');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  closeReader(): void {
    if (!this.reading) return;
    this.reading = false;
    this.reader.classList.remove('on');
    this.onReaderClose?.();
  }

  timer(text: string | null): void {
    this.timerEl.textContent = text ?? '';
    this.timerEl.classList.toggle('on', !!text);
  }

  /** A few hearts float up when an animal lets itself be stroked. */
  hearts(): void {
    for (let i = 0; i < 6; i++) {
      const h = document.createElement('i');
      h.textContent = '♥';
      h.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
      h.style.setProperty('--d', `${i * 0.09}s`);
      h.style.fontSize = `${16 + Math.random() * 16}px`;
      this.heartsEl.appendChild(h);
      window.setTimeout(() => h.remove(), 2200);
    }
  }
}
