// 3D model export: GLB (glTF binary) of what the viewer shows, and STL of surfaces thickened into printable shells.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const isLine2 = (o: any) => o.isLine2 || o.isLineSegments2 || o.geometry?.isLineSegmentsGeometry;

/** a plain three.js copy of the visible scene that glTF can describe (fat lines become simple line segments) */
/** opts.unrotate: a 3×3 matrix (rows) that turns the drawing back so the figure's own z axis points up */
function exportable(root: THREE.Object3D, opts: { skipTextured?: boolean; unrotate?: number[][] } = {}): THREE.Group {
  const out = new THREE.Group(); out.name = 'LaTeX Modeler';
  root.updateMatrixWorld(true);
  const visible = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
  root.traverse((o: any) => {
    if (!visible(o) || o === root) return;
    if (isLine2(o)) {
      const g = o.geometry; const s = g.attributes.instanceStart, e = g.attributes.instanceEnd; if (!s || !e) return;
      const pos = new Float32Array(s.count * 6); const v = new THREE.Vector3();
      for (let i = 0; i < s.count; i++) {
        v.fromBufferAttribute(s, i).applyMatrix4(o.matrixWorld); pos.set([v.x, v.y, v.z], i * 6);
        v.fromBufferAttribute(e, i).applyMatrix4(o.matrixWorld); pos.set([v.x, v.y, v.z], i * 6 + 3);
      }
      const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = o.material;
      out.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: m.color?.clone() ?? 0x333333, transparent: m.opacity < 1, opacity: m.opacity ?? 1 })));
      return;
    }
    if (o.isMesh || o.isLineSegments || o.isLine || o.isPoints) {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (opts.skipTextured && m?.map) return;
      const g = (o.geometry as THREE.BufferGeometry).clone(); g.applyMatrix4(o.matrixWorld);
      let mat: THREE.Material;
      if (o.isMesh) mat = new THREE.MeshStandardMaterial({ color: m?.color?.clone() ?? 0xffffff, vertexColors: !!m?.vertexColors, side: THREE.DoubleSide, transparent: (m?.opacity ?? 1) < 1, opacity: m?.opacity ?? 1, roughness: 0.75, metalness: 0, map: m?.map ?? null });
      else if (o.isPoints) mat = new THREE.PointsMaterial({ color: m?.color?.clone() ?? 0x333333, size: m?.size ?? 1 });
      else mat = new THREE.LineBasicMaterial({ color: m?.color?.clone() ?? 0x333333 });
      const c = o.isMesh ? new THREE.Mesh(g, mat) : o.isPoints ? new THREE.Points(g, mat) : o.isLineSegments ? new THREE.LineSegments(g, mat) : new THREE.Line(g, mat);
      c.name = o.name || ''; out.add(c);
    }
  });
  // glTF is y-up, metres; pages are z-toward-reader, millimetres
  const wrap = new THREE.Group(); wrap.add(out); wrap.name = 'LaTeX Modeler';
  if (opts.unrotate) { const box = new THREE.Box3().setFromObject(out), c = box.getCenter(new THREE.Vector3()); out.position.sub(c); out.applyMatrix4(mat4(opts.unrotate)); }
  wrap.rotation.x = -Math.PI / 2; wrap.scale.setScalar(0.001);
  return wrap;
}

const mat4 = (m: number[][]) => new THREE.Matrix4().set(m[0][0], m[0][1], m[0][2], 0, m[1][0], m[1][1], m[1][2], 0, m[2][0], m[2][1], m[2][2], 0, 0, 0, 0, 1);
export async function toGLB(root: THREE.Object3D, opts: { skipTextured?: boolean; unrotate?: number[][] } = {}): Promise<Uint8Array> {
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const scene = new THREE.Scene(); scene.add(exportable(root, opts));
  const res = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
  return new Uint8Array(res as ArrayBuffer);
}

/** binary STL of every surface mesh in `meshes`, each thickened into a closed shell `thick` mm thick */
export function toSTL(meshes: THREE.Mesh[], thick = 1.2, unrotate?: number[][]): { data: Uint8Array; triangles: number; size: number[] } {
  const tris: number[] = [];   // 9 numbers per triangle
  const P = (i: number, arr: Float32Array | number[]) => [arr[3 * i], arr[3 * i + 1], arr[3 * i + 2]];
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    let g = new THREE.BufferGeometry(); g.setAttribute('position', (mesh.geometry as THREE.BufferGeometry).getAttribute('position').clone());
    if (mesh.geometry.index) g.setIndex(mesh.geometry.index.clone());
    g.applyMatrix4(mesh.matrixWorld); if (unrotate) g.applyMatrix4(mat4(unrotate));
    g = mergeVertices(g, 1e-4); g.computeVertexNormals();
    const pos = g.getAttribute('position').array as Float32Array, nor = g.getAttribute('normal').array as Float32Array;
    const idx = g.index ? Array.from(g.index.array) : Array.from({ length: pos.length / 3 }, (_, i) => i);
    const n = pos.length / 3, h = thick / 2;
    const up: number[] = [], dn: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = P(i, pos), q = P(i, nor); const ok = q.every(isFinite) && Math.hypot(...q) > 0.5;
      for (let k = 0; k < 3; k++) { up.push(p[k] + (ok ? q[k] * h : 0)); dn.push(p[k] - (ok ? q[k] * h : 0)); }
    }
    const edges = new Map<string, [number, number, number]>();   // undirected edge → [a, b, uses]
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      if (a === b || b === c || a === c) continue;
      { // zero-area slivers (where a parametric surface folds onto itself) would make non-manifold edges
        const A = P(a, pos), B = P(b, pos), Cc = P(c, pos); const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [Cc[0] - A[0], Cc[1] - A[1], Cc[2] - A[2]];
        if (Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) < 1e-9) continue;
      }
      tris.push(...P(a, up), ...P(b, up), ...P(c, up));          // top
      tris.push(...P(a, dn), ...P(c, dn), ...P(b, dn));          // bottom (reversed)
      for (const [u, v] of [[a, b], [b, c], [c, a]]) { const k = u < v ? `${u},${v}` : `${v},${u}`; const e = edges.get(k); if (e) e[2]++; else edges.set(k, [u, v, 1]); }
    }
    // walls along the open boundary close the shell
    for (const [a, b, uses] of edges.values()) {
      if (uses !== 1) continue;
      tris.push(...P(a, up), ...P(a, dn), ...P(b, up));
      tris.push(...P(b, up), ...P(a, dn), ...P(b, dn));
    }
  }
  const count = tris.length / 9;
  const buf = new ArrayBuffer(84 + count * 50); const dv = new DataView(buf);
  const head = 'LaTeX Modeler STL export (millimetres)'; for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < count; t++) {
    const p = tris.slice(t * 9, t * 9 + 9);
    const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [nx, ny, nz, ...p]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], tris[i + k]); hi[k] = Math.max(hi[k], tris[i + k]); }
  return { data: new Uint8Array(buf), triangles: count, size: hi.map((h, k) => h - lo[k]) };
}
