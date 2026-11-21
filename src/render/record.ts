// Video and GIF recording of the 3D view. Frames are rendered one at a time at a fixed size, so the result
// is smooth and correctly timed however heavy the page is.
//   MP4 (H.264): WebCodecs VideoEncoder + mp4-muxer (Chrome, Edge, Safari 16.4+, Firefox 130+, the desktop app)
//   WebM:        fallback through MediaRecorder where WebCodecs/H.264 is unavailable
//   GIF:         gifenc, one shared palette
import type { Viewer } from './viewer';

export type RecFormat = 'mp4' | 'webm' | 'gif';
export interface RecordJob {
  width: number; height: number; fps: number; frames: number; format: RecFormat;
  /** put the scene into the state for frame i (time, camera) */
  setFrame(i: number): void;
  onProgress(fraction: number): void;
  cancelled(): boolean;
}
export interface RecordResult { data: Uint8Array; mime: string; ext: string }

export function supportedFormats(): RecFormat[] {
  const out: RecFormat[] = [];
  if (typeof (globalThis as any).VideoEncoder === 'function') out.push('mp4');
  if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('video/webm')) out.push('webm');
  out.push('gif');
  return out;
}

const tick = () => new Promise<void>(r => setTimeout(r, 0));

/** draws frame i of the job onto a 2D canvas (the WebGL canvas is copied right after rendering) */
function frameGrabber(viewer: Viewer, job: RecordJob) {
  const c = document.createElement('canvas'); c.width = job.width; c.height = job.height;
  const g = c.getContext('2d', { willReadFrequently: job.format === 'gif' })!;
  return {
    canvas: c, g,
    draw(i: number) {
      job.setFrame(i); viewer.render();
      g.drawImage(viewer.renderer.domElement, 0, 0, job.width, job.height);
    },
  };
}

export async function record(viewer: Viewer, job: RecordJob): Promise<RecordResult | null> {
  // H.264 needs even dimensions
  job.width -= job.width % 2; job.height -= job.height % 2;
  viewer.beginCapture(job.width, job.height);
  try {
    if (job.format === 'mp4') return await recordMP4(viewer, job);
    if (job.format === 'webm') return await recordWebM(viewer, job);
    return await recordGIF(viewer, job);
  } finally { viewer.endCapture(); }
}

async function recordMP4(viewer: Viewer, job: RecordJob): Promise<RecordResult | null> {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const VE = (globalThis as any).VideoEncoder, VF = (globalThis as any).VideoFrame;
  const base = { width: job.width, height: job.height, bitrate: Math.round(job.width * job.height * job.fps * 0.12), framerate: job.fps };
  // pick the simplest H.264 profile that supports this size
  let config: any = null;
  for (const codec of ['avc1.42001f', 'avc1.4d0028', 'avc1.640028', 'avc1.640033']) {
    const c = { ...base, codec };
    try { if ((await VE.isConfigSupported(c)).supported) { config = c; break; } } catch { /* try next */ }
  }
  if (!config) throw new Error('this browser cannot encode H.264 video — choose WebM or GIF');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: job.width, height: job.height }, fastStart: 'in-memory' });
  let failure: any = null;
  const enc = new VE({ output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta), error: (e: any) => { failure = e; } });
  enc.configure(config);
  const grab = frameGrabber(viewer, job); const us = 1e6 / job.fps;
  for (let i = 0; i < job.frames; i++) {
    if (job.cancelled() || failure) break;
    grab.draw(i);
    const frame = new VF(grab.canvas, { timestamp: Math.round(i * us), duration: Math.round(us) });
    enc.encode(frame, { keyFrame: i % (job.fps * 2) === 0 }); frame.close();
    while (enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 2));
    job.onProgress((i + 1) / job.frames); if (i % 3 === 0) await tick();
  }
  await enc.flush(); enc.close();
  if (failure) throw failure;
  if (job.cancelled()) return null;
  muxer.finalize();
  return { data: new Uint8Array(target.buffer), mime: 'video/mp4', ext: 'mp4' };
}

async function recordWebM(viewer: Viewer, job: RecordJob): Promise<RecordResult | null> {
  // MediaRecorder is real-time, so frames are paced at the target rate
  const grab = frameGrabber(viewer, job);
  const stream = (grab.canvas as any).captureStream(0) as MediaStream; const track: any = stream.getVideoTracks()[0];
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t))!;
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: Math.round(job.width * job.height * job.fps * 0.15) });
  const parts: Blob[] = []; rec.ondataavailable = e => e.data.size && parts.push(e.data);
  const done = new Promise<void>(r => (rec.onstop = () => r()));
  rec.start();
  const t0 = performance.now(), dt = 1000 / job.fps;
  for (let i = 0; i < job.frames && !job.cancelled(); i++) {
    grab.draw(i); track.requestFrame?.();
    job.onProgress((i + 1) / job.frames);
    const wait = t0 + (i + 1) * dt - performance.now(); await new Promise(r => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop(); await done; stream.getTracks().forEach(t => t.stop());
  if (job.cancelled()) return null;
  return { data: new Uint8Array(await new Blob(parts).arrayBuffer()), mime: 'video/webm', ext: 'webm' };
}

async function recordGIF(viewer: Viewer, job: RecordJob): Promise<RecordResult | null> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const grab = frameGrabber(viewer, job); const gif = GIFEncoder();
  const delay = Math.round(1000 / job.fps); let palette: number[][] | null = null;
  for (let i = 0; i < job.frames; i++) {
    if (job.cancelled()) return null;
    grab.draw(i);
    const rgba = grab.g.getImageData(0, 0, job.width, job.height).data;
    // one palette for the whole clip (from the first frame plus a mid-clip frame) avoids colour flicker
    if (!palette) {
      const mid = frameGrabber(viewer, job); mid.draw(Math.floor(job.frames / 2)); grab.draw(i);
      const a = mid.g.getImageData(0, 0, job.width, job.height).data; const both = new Uint8ClampedArray(rgba.length * 2); both.set(rgba); both.set(a, rgba.length);
      palette = quantize(both, 256);
    }
    gif.writeFrame(applyPalette(rgba, palette), job.width, job.height, { palette: i === 0 ? palette : undefined, delay, repeat: 0 });
    job.onProgress((i + 1) / job.frames); if (i % 2 === 0) await tick();
  }
  gif.finish();
  return { data: gif.bytes(), mime: 'image/gif', ext: 'gif' };
}
