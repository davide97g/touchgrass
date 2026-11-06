import { Pane } from 'tweakpane';
import { GRASS_TYPES, params, type GrassTypeName, type QualityName, type TimeName } from '../core/params';
import { TIME_PRESETS } from '../world/TimeOfDay';

export interface PanelHooks {
  grassType(name: GrassTypeName): void;
  grassChanged(): void;
  densityChanged(): void;
  windChanged(): void;
  timeChanged(name: TimeName): void;
  atmosphereChanged(): void;
  flowersChanged(): void;
  audioChanged(): void;
  qualityChanged(q: QualityName): void;
  fovChanged(): void;
}

const opts = <T extends string>(names: readonly T[]) =>
  Object.fromEntries(names.map((n) => [n, n])) as Record<string, T>;

export class Panel {
  readonly pane: Pane;
  readonly el: HTMLDivElement;
  private readonly stats = { blades: '', fps: '' };

  constructor(hooks: PanelHooks) {
    this.el = document.createElement('div');
    this.el.className = 'panel';
    document.body.appendChild(this.el);
    this.pane = new Pane({ container: this.el, title: 'the field' });

    const grass = this.pane.addFolder({ title: 'grass' });
    grass
      .addBinding(params.grass, 'type', { label: 'type', options: opts(Object.keys(GRASS_TYPES) as GrassTypeName[]) })
      .on('change', (e) => {
        hooks.grassType(e.value);
        this.pane.refresh();
      });
    grass.addBinding(params.grass, 'height', { min: 0.15, max: 2, step: 0.01 }).on('change', () => hooks.grassChanged());
    grass.addBinding(params.grass, 'heightVar', { label: 'variation', min: 0, max: 0.8, step: 0.01 }).on('change', () => hooks.grassChanged());
    grass.addBinding(params.grass, 'width', { min: 0.02, max: 0.12, step: 0.001 }).on('change', () => hooks.grassChanged());
    grass.addBinding(params.grass, 'stiffness', { min: 0.4, max: 2.5, step: 0.01 }).on('change', () => hooks.grassChanged());
    grass.addBinding(params.grass, 'density', { min: 0.3, max: 1.6, step: 0.05 }).on('change', (e) => {
      if (e.last) hooks.densityChanged();
    });
    grass.addBinding(params.grass, 'base', { label: 'root' }).on('change', () => hooks.grassChanged());
    grass.addBinding(params.grass, 'mid').on('change', () => hooks.grassChanged());
    grass.addBinding(params.grass, 'tip').on('change', () => hooks.grassChanged());

    const wind = this.pane.addFolder({ title: 'wind' });
    wind.addBinding(params.wind, 'strength', { min: 0, max: 2, step: 0.01 }).on('change', () => hooks.windChanged());
    wind.addBinding(params.wind, 'direction', { min: 0, max: 360, step: 1 }).on('change', () => hooks.windChanged());
    wind.addBinding(params.wind, 'gust', { label: 'gusts', min: 0, max: 1.5, step: 0.01 }).on('change', () => hooks.windChanged());
    wind.addBinding(params.wind, 'gustSpeed', { label: 'gust speed', min: 0.5, max: 14, step: 0.1 }).on('change', () => hooks.windChanged());

    const sky = this.pane.addFolder({ title: 'sky' });
    sky
      .addBinding(params.atmosphere, 'time', { label: 'time', options: opts(Object.keys(TIME_PRESETS) as TimeName[]) })
      .on('change', (e) => hooks.timeChanged(e.value));
    sky.addBinding(params.atmosphere, 'clouds', { label: 'cloud cover', min: 0, max: 1, step: 0.01 }).on('change', () => hooks.atmosphereChanged());
    sky.addBinding(params.atmosphere, 'towering', { label: 'towering', min: 0, max: 1, step: 0.01 });
    sky.addBinding(params.atmosphere, 'cloudSpeed', { label: 'cloud speed', min: 0, max: 12, step: 0.1 });
    sky.addBinding(params.atmosphere, 'evolution', { label: 'evolution', min: 0, max: 4, step: 0.05 });
    sky.addBinding(params.atmosphere, 'alto', { label: 'mid clouds', min: 0, max: 1, step: 0.01 });
    sky.addBinding(params.atmosphere, 'cirrus', { label: 'high clouds', min: 0, max: 1, step: 0.01 });
    sky.addBinding(params.atmosphere, 'cloudStyle', { label: 'anime ↔ real', min: 0, max: 1, step: 0.01 });
    sky.addBinding(params.atmosphere, 'cloudShadows', { label: 'shadows', min: 0, max: 1, step: 0.01 }).on('change', () => hooks.atmosphereChanged());
    sky.addBinding(params.atmosphere, 'fog', { label: 'haze', min: 0.2, max: 3, step: 0.01 }).on('change', () => hooks.atmosphereChanged());
    sky.addBinding(params, 'particles', { label: 'pollen / fireflies' }).on('change', () => hooks.flowersChanged());
    sky.addBinding(params, 'birds', { label: 'bird flocks' });

    const flowers = this.pane.addFolder({ title: 'flowers', expanded: false });
    flowers.addBinding(params.flowers, 'enabled', { label: 'show' }).on('change', () => hooks.flowersChanged());
    flowers.addBinding(params.flowers, 'density', { min: 0, max: 1, step: 0.01 }).on('change', () => hooks.flowersChanged());

    const move = this.pane.addFolder({ title: 'walking', expanded: false });
    move.addBinding(params.move, 'speed', { label: 'pace', min: 0.5, max: 4, step: 0.05 });
    move.addBinding(params.move, 'headBob', { label: 'head bob' });
    move.addBinding(params.move, 'sensitivity', { label: 'look', min: 0.2, max: 3, step: 0.05 });
    move.addBinding(params.move, 'fov', { min: 45, max: 100, step: 1 }).on('change', () => hooks.fovChanged());

    const audio = this.pane.addFolder({ title: 'sound', expanded: false });
    audio.addBinding(params.audio, 'musicOn', { label: 'music' }).on('change', () => hooks.audioChanged());
    for (const k of ['master', 'music', 'wind', 'grass', 'nature', 'pad'] as const) {
      audio.addBinding(params.audio, k, { min: 0, max: 1, step: 0.01, label: k === 'pad' ? 'breath pad' : k === 'music' ? 'music level' : k })
        .on('change', () => hooks.audioChanged());
    }

    const look = this.pane.addFolder({ title: 'quality', expanded: false });
    look
      .addBinding(params, 'quality', { label: 'detail', options: opts(['auto', 'low', 'medium', 'high'] as QualityName[]) })
      .on('change', (e) => hooks.qualityChanged(e.value));
    look.addBinding(params.post, 'bloom', { min: 0, max: 1.5, step: 0.01 });
    look.addBinding(params.post, 'vignette', { min: 0, max: 1, step: 0.01 });
    look.addBinding(this.stats, 'blades', { readonly: true });
    look.addBinding(this.stats, 'fps', { readonly: true, interval: 500 });

    this.hide();
  }

  setStats(blades: number, fps: number, tier: string): void {
    this.stats.blades = `${(blades / 1000).toFixed(0)}k · ${tier}`;
    this.stats.fps = fps.toFixed(0);
  }

  refresh(): void {
    this.pane.refresh();
  }

  get visible(): boolean {
    return this.el.classList.contains('on');
  }

  toggle(on = !this.visible): void {
    if (on) this.show();
    else this.hide();
  }

  show(): void {
    this.el.classList.add('on');
  }

  hide(): void {
    this.el.classList.remove('on');
  }
}
