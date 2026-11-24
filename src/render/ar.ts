// AR: put the page on a real table. Android (Chrome) uses WebXR: the camera finds a surface, a tap places the page,
// and its 3D figures stand up from it. iPhone and iPad open a USDZ copy in Quick Look instead.
import * as THREE from 'three';
import type { Viewer } from './viewer';
import { toUSDZ } from './export3d';

export type ARKind = 'webxr' | 'quicklook' | null;

export async function arSupport(): Promise<ARKind> {
  try { if ((navigator as any).xr && await (navigator as any).xr.isSessionSupported('immersive-ar')) return 'webxr'; } catch { /* not available */ }
  const a = document.createElement('a');
  if (a.relList?.supports?.('ar')) return 'quicklook';
  return null;
}

/** iPhone / iPad: hand a USDZ model to AR Quick Look */
export async function quickLook(viewer: Viewer, name: string) {
  const data = await toUSDZ(viewer.content);
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'model/vnd.usdz+zip' }));
  const a = document.createElement('a'); a.rel = 'ar'; a.href = url; a.download = name.replace(/\.bd$/, '') + '.usdz';
  a.appendChild(document.createElement('img'));   // Quick Look needs the link to wrap an image
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const CSS = `
#arUI{position:fixed;inset:0;z-index:1000;pointer-events:none;font:15px Inter,system-ui,sans-serif;color:#fff}
#arUI .msg{position:absolute;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);background:rgba(0,0,0,.55);padding:10px 16px;border-radius:12px;text-align:center;max-width:86vw}
#arUI button{pointer-events:auto;position:absolute;top:calc(14px + env(safe-area-inset-top));right:14px;background:rgba(0,0,0,.6);color:#fff;border:1px solid rgba(255,255,255,.4);border-radius:10px;padding:8px 14px;font:inherit}
#arUI .sz{right:auto;left:14px}
`;

/** Android: a WebXR session that places the page on a real surface */
export async function startWebXR(viewer: Viewer, page: { w: number; h: number }): Promise<void> {
  const xr = (navigator as any).xr;
  const ui = document.createElement('div'); ui.id = 'arUI';
  ui.innerHTML = `<style>${CSS}</style><div class="msg">Move your phone slowly to find the table, then tap to put the page down.</div><button type="button" class="sz" data-a="size">Real size</button><button type="button" data-a="exit">Exit AR</button>`;
  document.body.appendChild(ui);
  const msg = ui.querySelector('.msg') as HTMLElement;
  let session: any;
  try { session = await xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'local-floor'], domOverlay: { root: ui } }); }
  catch (e) { ui.remove(); throw new Error("AR couldn't start on this device" + ((e as any)?.message ? ': ' + (e as any).message : '')); }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio); renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.55));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(-0.4, 1, 0.8); scene.add(sun);
  // the page lies flat: page x → right, page y → away from you, page z (toward the reader) → up
  const pivot = new THREE.Group(); pivot.visible = false; scene.add(pivot);
  const holder = new THREE.Group(); holder.rotation.x = -Math.PI / 2; pivot.add(holder);
  const content = viewer.content.clone(true); content.position.set(-page.w / 2, -page.h / 2, 0); holder.add(content);
  const big = 0.36 / Math.max(page.w, page.h);   // the long side 36 cm across
  let realSize = false;
  const applyScale = () => { holder.scale.setScalar(realSize ? 0.001 : Math.max(0.001, big)); (ui.querySelector('[data-a=size]') as HTMLElement).textContent = realSize ? 'Table size' : 'Real size'; };
  applyScale();
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.065, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewerSpace });
  session.addEventListener('select', () => {
    if (!reticle.visible) return;
    pivot.position.setFromMatrixPosition(reticle.matrix); pivot.visible = true;
    msg.textContent = 'Walk around it. Tap somewhere else to move it.';
  });
  ui.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('button')?.dataset.a;
    if (a === 'exit') session.end(); else if (a === 'size') { realSize = !realSize; applyScale(); }
  });
  // fat lines size themselves in screen pixels
  const lineMats: any[] = []; content.traverse((o: any) => { const m = o.material; if (m?.isLineMaterial) lineMats.push(m); });
  const v = new THREE.Vector2();
  renderer.setAnimationLoop((_t: number, frame: any) => {
    if (frame) {
      const ref = renderer.xr.getReferenceSpace();
      const hits = frame.getHitTestResults(hitSource);
      if (hits.length && ref) { const pose = hits[0].getPose(ref); reticle.visible = !!pose; if (pose) reticle.matrix.fromArray(pose.transform.matrix); }
      else reticle.visible = false;
    }
    renderer.getDrawingBufferSize(v); for (const m of lineMats) m.resolution.copy(v);
    renderer.render(scene, renderer.xr.getCamera());
  });
  await new Promise<void>(res => session.addEventListener('end', () => res(), { once: true }));
  renderer.setAnimationLoop(null);
  try { hitSource.cancel(); } catch { /* ignore */ }
  renderer.dispose(); ui.remove();
  viewer.resize();   // the shared line materials get the viewer's own size back
}
