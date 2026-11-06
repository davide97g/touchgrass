import type { Experience } from '../core/Experience';
import { Director } from './Director';

/**
 * Trailer mode (`?trailer`): the camera is handed to the Director, the UI goes away,
 * and a click rolls the film. Extras:
 *   `&record`          capture canvas + mix to a video file, downloaded at the end
 *   `&size=1920x1080`  fixed render size (good for recording)
 *   `&t=80`            start from a given second (for checking a scene)
 */
export function bootTrailer(exp: Experience): void {
  const q = new URLSearchParams(location.search);
  const record = q.has('record');
  const startAt = Math.max(0, Number(q.get('t') ?? 0) || 0);
  const size = /^(\d{3,4})x(\d{3,4})$/.exec(q.get('size') ?? '');
  if (size) {
    exp.fixedSize = { w: Number(size[1]), h: Number(size[2]) };
    window.dispatchEvent(new Event('resize'));
  }

  document.body.classList.add('trailer');
  document.querySelector('#landing')?.remove();

  const ui = document.createElement('div');
  ui.className = 'trailer-ui';
  ui.innerHTML = `
    <p class="trailer-kicker">touch grass</p>
    <button type="button" class="trailer-play" disabled>preparing the field…</button>
    <p class="trailer-hint">${record ? 'recording: keep this tab in front until the end' : 'headphones on · space to pause · F fullscreen'}</p>`;
  document.body.appendChild(ui);
  const play = ui.querySelector<HTMLButtonElement>('.trailer-play')!;

  let director: Director | null = null;
  exp.onFirstFrame = () => {
    // Let the grass, flowers and feature map settle before scouting locations.
    window.setTimeout(() => {
      director = new Director(exp);
      exp.director = director;
      director.hold = q.has('hold');
      if (import.meta.env.DEV) (window as unknown as { __dir: Director }).__dir = director;
      play.disabled = false;
      play.textContent = '▶  play trailer';
      play.focus({ preventScroll: true });
      director.onEnd = () => {
        recorder?.stop();
        document.body.classList.remove('rolling');
        ui.classList.remove('gone');
        play.textContent = '↻  play again';
        play.onclick = () => location.reload();
      };
    }, 400);
  };

  let recorder: MediaRecorder | null = null;
  play.addEventListener('click', () => {
    if (!director || director.time > 0) return;
    exp.audio.start();
    if (record) recorder = startRecording(exp);
    else if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => {});
    director.start(startAt);
    ui.classList.add('gone');
    document.body.classList.add('rolling');
  });

  window.addEventListener('keydown', (e) => {
    const ctx = exp.audio.ctx;
    if (e.code === 'Space' && ctx && director && director.time > 0) {
      e.preventDefault();
      if (ctx.state === 'running') void ctx.suspend();
      else void ctx.resume();
    }
    if (e.code === 'KeyF') {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  });
}

function startRecording(exp: Experience): MediaRecorder | null {
  const canvas = exp.renderer.domElement;
  const video = canvas.captureStream(60);
  const audio = exp.audio.captureStream();
  const stream = new MediaStream([...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
  const types = [
    'video/mp4;codecs=avc1.640028,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) return null;
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 32_000_000, audioBitsPerSecond: 256_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `touchgrass-trailer.${mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  rec.start(1000);
  return rec;
}
