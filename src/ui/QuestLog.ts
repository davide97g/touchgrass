import type { Game } from '../game/Game';
import { PAGES, RANKS, RELICS, SIGILS } from '../game/lore';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The quest log: the story first, then side quests, finished ones folded at the bottom. */
export function questsHtml(game: Game): string {
  const all = game.quests();
  const tracked = game.tracked;
  const rank = game.rank;
  const card = (q: (typeof all)[number]) => {
    if (q.locked) return `<div class="ql-card locked"><div class="ql-head"><span class="ql-kind">${q.kind === 'main' ? 'Story' : 'Quest'}</span><b>? ? ?</b></div><p class="ql-blurb">Not yet. Something else comes first.</p></div>`;
    const steps = q.steps
      .map((s) => `<li class="${s.done ? 'done' : ''}"><i>${s.done ? '✓' : '·'}</i><span>${esc(s.text)}${s.of !== undefined ? ` <em>${s.n}/${s.of}</em>` : ''}</span></li>`)
      .join('');
    return `<button type="button" class="ql-card ${q.kind} ${q.done ? 'done' : ''} ${q.id === tracked ? 'tracked' : ''}" data-track="${q.id}" ${q.done ? 'disabled' : ''}>
      <div class="ql-head"><span class="ql-kind">${q.kind === 'main' ? 'Story' : 'Quest'}</span><b>${esc(q.title)}</b><span class="ql-xp">${q.done ? 'done' : `${q.xp} xp`}</span></div>
      <p class="ql-blurb">${esc(q.blurb)}</p>
      <ul>${steps}</ul>
      ${q.id === tracked ? '<span class="ql-pin">tracking</span>' : ''}
    </button>`;
  };
  const open = all.filter((q) => !q.done);
  const done = all.filter((q) => q.done);
  const next = rank.next === null ? 'the highest rank' : `${rank.next - rank.xp} xp to ${RANKS[rank.level + 1].name}`;
  return `
    <div class="ql-rank"><span class="ql-lv"><b>${rank.level + 1}</b></span><div><b>${esc(rank.name)}</b><em>${rank.xp} xp · ${next} · ${game.completion()}% of the realm complete</em><div class="ql-bar"><i style="width:${(rank.frac * 100).toFixed(1)}%"></i></div></div></div>
    <div class="ql-grid">${open.map(card).join('')}</div>
    ${done.length ? `<h4 class="ql-sub">Finished</h4><div class="ql-grid">${done.map(card).join('')}</div>` : ''}
    <p class="ql-foot">Click a quest to track it: the compass and your companion light will lean toward it. ${Math.round(game.walked / 100) / 10} km walked · ${Math.round(game.flown / 100) / 10} km flown.</p>`;
}

/** Everything written down or carried: sigils, diary pages, relics. */
export function loreHtml(game: Game): string {
  const sig = SIGILS.map((s) =>
    game.hasSigil(s.id)
      ? `<div class="lr-card sig" style="--tint:${s.color}"><div class="lr-glyph">${s.glyph}</div><b>${esc(s.name)}</b><p>${esc(s.verse)}</p></div>`
      : `<div class="lr-card sig asleep"><div class="lr-glyph">${s.glyph}</div><b>Asleep</b><p>“${esc(s.riddle)}”</p></div>`,
  ).join('');
  const pages = PAGES.map((p, i) =>
    game.hasPage(i) ? `<div class="lr-card page"><b>${esc(p.title)}</b><p>${esc(p.text)}</p></div>` : `<div class="lr-card page missing"><b>${esc(p.title)}</b><p>A page still pinned to a post somewhere in the realm.</p></div>`,
  ).join('');
  const relics = RELICS.slice(0, Math.max(1, game.chestTotal))
    .map((r, i) => (game.hasChest(i) ? `<div class="lr-card relic"><b>${esc(r.name)}</b><p>${esc(r.text)}</p></div>` : `<div class="lr-card relic missing"><b>An unopened chest</b><p>Under a lantern, in some out-of-the-way corner.</p></div>`))
    .join('');
  const blade = game.has('blade') ? `<div class="lr-card relic"><b>The Dawnblade</b><p>It came out of the stone as if it had only been resting. Lights in the grass drift toward whoever carries it.</p></div>` : '';
  const wind = game.has('crown') ? `<div class="lr-card relic"><b>The Serpent’s Wind</b><p>Aurelion woke, and the air remembers you. You fly half again as fast.</p></div>` : '';
  return `
    <h4 class="ql-sub">The five sigils</h4><div class="lr-grid sigs">${sig}</div>
    <h4 class="ql-sub">The hermit’s diary</h4><div class="lr-grid">${pages}</div>
    <h4 class="ql-sub">Relics</h4><div class="lr-grid">${blade}${wind}${relics}</div>`;
}
