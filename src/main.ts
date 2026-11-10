import './styles.css';
import { Experience } from './core/Experience';
import { terrainHeight } from './world/common';
import { params } from './core/params';
import { bootTrailer } from './trailer';
import { Travel } from './ui/Travel';
import { Zones } from './ui/Zones';
import { BY_ID } from './discovery/catalog';
import { JournalUI } from './ui/JournalUI';
import { LensUI } from './ui/LensUI';
import { Notice } from './ui/Notice';
import { Adventure } from './game/Adventure';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function boot(): void {
  if (!hasWebGL2()) {
    $('#nogl').hidden = false;
    $('#landing').remove();
    return;
  }

  const canvas = $<HTMLCanvasElement>('#scene');
  const landing = $('#landing');
  const enterBtn = $<HTMLButtonElement>('#enter');
  const hud = $('#hud');
  const paused = $('#paused');
  const toastEl = $('#toast');
  const coarse = matchMedia('(pointer: coarse)').matches;

  const trailer = new URLSearchParams(location.search).has('trailer');
  if (trailer && !new URLSearchParams(location.search).has('q')) params.quality = 'high';
  const exp = new Experience(canvas);
  if (import.meta.env.DEV) Object.assign(window, { __exp: exp, __th: terrainHeight });
  if (trailer) {
    bootTrailer(exp);
    return;
  }

  // ---- where am I: zone banners and the compass ----
  const zones = new Zones(exp.realm);
  let zt = performance.now();
  const zoneLoop = (t: number) => {
    const dt = Math.min(0.2, (t - zt) / 1000);
    zt = t;
    const p = exp.controller.position;
    zones.update(dt, p.x, p.z, exp.controller.yaw, exp.started);
    lensUI.update(dt, exp.started && exp.macro && !journalUI.visible, exp.lens);
    requestAnimationFrame(zoneLoop);
  };
  requestAnimationFrame(zoneLoop);

  // ---- fast travel ----
  const travel = new Travel(exp);
  travel.onChange = () => syncHud();
  travel.onArrive = () => poke();
  // Hidden places join the list once found.
  travel.extra = () =>
    exp.realm.plan.secrets
      .filter((q) => q.id !== 'summit' && exp.journal.isSeen(q.id))
      .map((q) => {
        const e = BY_ID.get(q.id)!;
        const yaw = Math.atan2(-(q.x - q.approach.x), -(q.z - q.approach.z));
        return { id: `secret:${q.id}`, name: e.name, subtitle: 'Hidden place', x: q.approach.x, z: q.approach.z, yaw };
      });

  // ---- the lens, the journal, discoveries ----
  const journal = exp.journal;
  const lensUI = new LensUI(coarse);
  const notice = new Notice();
  const journalUI = new JournalUI(journal);
  journalUI.onChange = () => {
    if (journalUI.visible) btn('journal').classList.remove('new');
    syncHud();
  };
  notice.onOpen = () => journalUI.show();
  const markNew = () => btn('journal').classList.add('new');

  // ---- toast ----
  let toastTimer = 0;
  const toast = (text: string, ms = 2600) => {
    toastEl.textContent = text;
    toastEl.classList.add('on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), ms);
  };

  // ---- the game: quests, lights, mysteries, the map ----
  const adv = new Adventure(exp, zones, journalUI, (text, ms) => toast(text, ms), coarse);
  if (import.meta.env.DEV) Object.assign(window, { __adv: adv });
  adv.map.onChange = () => syncHud();
  adv.hud.onReaderClose = () => {
    if (!coarse && !journalUI.visible && !travel.visible && !adv.map.visible) exp.controller.requestLock();
    syncHud();
  };

  exp.discovery.onDiscover = (e) => {
    let note: string | undefined;
    if (e.when && !e.when.includes(params.atmosphere.time)) {
      note = e.id === 'moonpetal' ? 'Its petals are closed. Come back after sunset (T changes the time of day)' : `Only out at ${e.when.join(' or ').toLowerCase()}`;
    }
    notice.found(e, note);
    exp.sfx.chime(e.rarity);
    markNew();
    journalUI.refresh();
    adv.journalChanged(`found: ${e.name}`);
  };
  exp.discovery.onLock = () => exp.sfx.focusTick();
  exp.discovery.onAutoShot = () => shoot();

  // ---- photos ----
  let shooting = false;
  function shoot(): void {
    if (!exp.macro || shooting || !exp.started) return;
    shooting = true;
    const subject = exp.discovery.shotSubject;
    const lens = exp.lens;
    const meta = {
      at: Date.now(),
      tod: params.atmosphere.time,
      where: zones.currentName,
      dist: Number.isFinite(lens.dist) ? lens.dist : 0,
      mm: lens.mm,
      subject: subject?.id ?? null,
    };
    exp.sfx.shutter();
    exp.capture((src) => {
      // Crop the middle of the frame to 3:2 and keep a 1080 px print.
      const W = src.width;
      const H = src.height;
      let cw = W;
      let ch = Math.round(W / 1.5);
      if (ch > H) {
        ch = H;
        cw = Math.round(H * 1.5);
      }
      const out = document.createElement('canvas');
      out.width = 1080;
      out.height = 720;
      const ctx = out.getContext('2d');
      if (!ctx) {
        shooting = false;
        return;
      }
      ctx.drawImage(src, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, out.width, out.height);
      lensUI.flashShot();
      out.toBlob(
        (blob) => {
          shooting = false;
          if (!blob) return;
          void journal.addPhoto(blob, meta, true).then(async ({ photo, collected }) => {
            const e = subject;
            if (collected && e) {
              exp.rareFlora.markCollected(e.id);
              const url = (await journal.url(photo.key)) ?? '';
              const c = journal.counts();
              notice.got(e, url, `${c.got} of ${c.total} collected`);
              exp.sfx.collect();
            } else if (e) toast(`another photo of ${e.name.toLowerCase()} · in your album`, 2000);
            else toast('saved to your album · J to see it', 1800);
            markNew();
            journalUI.refresh();
            adv.journalChanged(collected && e ? `collected: ${e.name}` : 'a photo');
          });
        },
        'image/jpeg',
        0.9,
      );
    });
  }
  lensUI.onShutter = shoot;

  // ---- landing ----
  exp.onFirstFrame = () => {
    window.setTimeout(() => {
      enterBtn.disabled = false;
      enterBtn.querySelector('.enter-label')!.textContent = 'enter the field';
      enterBtn.focus({ preventScroll: true });
    }, 600);
  };

  enterBtn.addEventListener('click', () => {
    exp.enter();
    landing.classList.add('gone');
    document.body.classList.add('in-field');
    window.setTimeout(
      () => toast(coarse ? 'left thumb to walk · right thumb to look' : adv.game.has('waystone') ? 'welcome back · J for your quests · Tab for the map' : 'something is glowing nearby · follow the little light', 4200),
      1200,
    );
    poke();
  });

  // ---- HUD state ----
  const btn = (act: string) => hud.querySelector<HTMLButtonElement>(`[data-act="${act}"]`)!;
  const syncHud = () => {
    btn('breath').classList.toggle('on', exp.breath.active);
    btn('macro').classList.toggle('on', exp.macro);
    btn('settings').classList.toggle('on', exp.panel.visible);
    btn('journal').classList.toggle('on', journalUI.visible);
    btn('travel').classList.toggle('on', travel.visible);
    btn('map').classList.toggle('on', adv.map.visible);
    btn('fly').classList.toggle('on', exp.flying);
    btn('wander').classList.toggle('on', exp.controller.wanderActive || (exp.flying && exp.controller.flight.auto));
    btn('sound').classList.toggle('muted', params.audio.muted);
    btn('music').classList.toggle('on', params.audio.musicOn);
    updatePaused();
  };

  const updatePaused = () => {
    const show =
      exp.started && !coarse && !exp.controller.locked && !exp.controller.wanderActive && !exp.panel.visible && !travel.visible && !journalUI.visible && !adv.map.visible && !adv.hud.reading;
    paused.classList.toggle('on', show);
  };

  exp.onWanderChange = (on) => {
    if (exp.started && exp.flying) toast(on ? 'autopilot · a tour of the realm · move to take over' : 'you have the controls', 2600);
    else if (exp.started) toast(on ? 'wandering · move to take over' : 'you have the field again', 2400);
    if (on && document.pointerLockElement) document.exitPointerLock();
    syncHud();
  };

  exp.onFlightChange = (flying) => {
    if (flying) toast(coarse ? 'flying · push toward where you look · tap the wings to land' : 'flying · W toward your gaze · space up · C down · shift faster · G autopilot · V to land', 5200);
    else toast('feet on the ground', 2000);
    syncHud();
  };

  const actions: Record<string, () => void> = {
    fly: () => {
      const wasFlying = exp.flying;
      exp.toggleFlight();
      if (wasFlying) toast('coming down…', 1800);
    },
    time: () => toast(exp.cycleTime().toLowerCase()),
    macro: () => {
      exp.setMacro(!exp.macro);
      const found = exp.macroHasTarget ? 'a flower, up close' : 'the lens';
      toast(exp.macro ? (coarse ? `${found} · tap the shutter` : `${found} · click to shoot · scroll to zoom`) : 'wide again', 2200);
    },
    journal: () => {
      journalUI.toggle();
      if (journalUI.visible && travel.visible) travel.hide();
      if (journalUI.visible && adv.map.visible) adv.map.hide();
    },
    map: () => {
      if (journalUI.visible) journalUI.hide();
      if (travel.visible) travel.hide();
      adv.map.toggle();
    },
    breath: () => {
      exp.breath.toggle();
      toast(exp.breath.active ? 'follow the ring' : 'breathe however you like', 2000);
    },
    wander: () => exp.setWander(!exp.controller.wanderActive),
    music: () => {
      params.audio.musicOn = !params.audio.musicOn;
      exp.audio.setVolumes();
      exp.panel.refresh();
      toast(params.audio.musicOn ? 'music' : 'just the wind', 1600);
    },
    sound: () => {
      params.audio.muted = !params.audio.muted;
      exp.audio.setVolumes();
      toast(params.audio.muted ? 'silence' : 'sound on', 1400);
    },
    travel: () => {
      if (journalUI.visible) journalUI.hide();
      if (adv.map.visible) adv.map.hide();
      travel.toggle();
    },
    settings: () => {
      exp.panel.toggle();
      if (exp.panel.visible && document.pointerLockElement) document.exitPointerLock();
    },
    fullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    },
  };

  hud.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b) return;
    actions[b.dataset.act!]?.();
    syncHud();
    b.blur();
  });

  window.addEventListener('keydown', (e) => {
    if (exp.started && e.code === 'Tab') e.preventDefault();
    if (!exp.started || e.repeat) return;
    if ((e.target as HTMLElement)?.closest?.('input, textarea, .tp-dfwv')) return;
    if (e.code === 'Tab') {
      actions.map();
      syncHud();
      return;
    }
    if (adv.hud.reading && (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      adv.hud.closeReader();
      return;
    }
    if (e.code === 'KeyE' && !journalUI.visible && !travel.visible && !adv.map.visible) {
      adv.interact();
      return;
    }
    const map: Record<string, string> = {
      KeyT: 'time',
      KeyB: 'breath',
      KeyZ: 'macro',
      KeyG: 'wander',
      KeyM: 'sound',
      KeyN: 'music',
      KeyH: 'settings',
      KeyQ: 'travel',
      KeyV: 'fly',
      KeyF: 'fullscreen',
      KeyJ: 'journal',
    };
    // Shutter: space or enter while the lens is up (space lifts you in flight).
    if (exp.macro && !journalUI.visible && ((e.code === 'Space' && !exp.flying) || e.code === 'Enter')) {
      e.preventDefault();
      shoot();
      return;
    }
    const act = map[e.code];
    if (act) {
      actions[act]();
      syncHud();
    }
  });

  // ---- macro: hold right mouse, scroll to zoom ----
  let rmbMacro = false;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (exp.started && e.button === 0 && exp.macro && exp.controller.locked) {
      shoot();
      return;
    }
    if (!exp.started || e.button !== 2 || exp.macro) return;
    rmbMacro = true;
    exp.setMacro(true);
    syncHud();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button !== 2 || !rmbMacro) return;
    rmbMacro = false;
    exp.setMacro(false);
    syncHud();
  });
  window.addEventListener(
    'wheel',
    (e) => {
      if (!exp.started || !exp.macro) return;
      if ((e.target as HTMLElement)?.closest?.('.panel, .journal')) return;
      e.preventDefault();
      exp.zoomMacro(e.deltaY);
    },
    { passive: false },
  );

  // ---- pointer lock + idle chrome ----
  canvas.addEventListener('click', () => {
    if (!exp.started || coarse || travel.visible || journalUI.visible || adv.map.visible || adv.hud.reading) return;
    if (exp.panel.visible) {
      exp.panel.hide();
      syncHud();
    }
    if (!exp.controller.locked) exp.controller.requestLock();
  });
  document.addEventListener('pointerlockchange', () => {
    window.setTimeout(syncHud, 0);
    poke();
  });

  let idleTimer = 0;
  function poke(): void {
    document.body.classList.remove('idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      if (exp.started && !exp.panel.visible) document.body.classList.add('idle');
    }, exp.controller.locked ? 2200 : 4500);
  }
  document.addEventListener('mousemove', () => {
    if (!exp.controller.locked) poke();
  });
  document.addEventListener('touchstart', poke, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (['KeyH', 'Escape'].includes(e.code)) poke();
  });

  // Audio contexts get suspended in background tabs on some browsers.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && exp.started) exp.audio.start();
  });

  syncHud();
}

boot();
