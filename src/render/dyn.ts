// View-dependent visibility for 3D frame parts (matplotlib-style): panes on the faces behind the figure,
// tick labels on the edges that face the reader. `toCam` points from the scene toward the camera.
export function dynVisible(dyn: any, toCam: number[]): boolean {
  const dot = (n: number[], v: number[]) => n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
  if (dyn.kind === 'face') return dot(dyn.n, toCam) < 1e-6;
  if (dyn.kind === 'edge') {
    // looking straight down this axis: its ticks would all stack on one point
    if (dyn.ax && Math.abs(dot(dyn.ax, toCam)) > 0.97) return false;
    // a tiny fixed bias picks exactly one edge when a face is seen edge-on (top / front / side views)
    const v = [toCam[0] + 0.0123, toCam[1] - 0.0217, toCam[2] + 0.0071];
    return dot(dyn.n1, v) > 0 && dot(dyn.n2, v) <= 0;
  }
  return true;
}
