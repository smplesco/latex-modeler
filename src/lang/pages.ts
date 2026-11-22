// Page formats: sizes, paper styles, and the stage a page is shown on.
// Shared by the language (page()), the 3D viewer, the SVG export and the start screen.

/** page sizes in mm (portrait) */
export const PAGES: Record<string, [number, number]> = { A3: [297, 420], A4: [210, 297], A5: [148, 210], A6: [105, 148], letter: [215.9, 279.4], legal: [215.9, 355.6], square: [200, 200], slide: [254, 142.9] };

export interface PageStyle {
  label: string; bg: string; ink: string; dark?: boolean;
  /** square grid every `grid` mm; every `major`-th line darker */
  grid?: number; major?: number; gridColor?: string; majorColor?: string;
  /** dot grid every `dots` mm */
  dots?: number;
  /** ruled lines every `lines` mm below a header band of `top` mm, with a margin rule at x = margin */
  lines?: number; top?: number; margin?: number; lineColor?: string; marginColor?: string;
}
export const PAGE_STYLES: Record<string, PageStyle> = {
  paper: { label: 'Plain', bg: '#ffffff', ink: '#111111' },
  grid: { label: 'Grid', bg: '#ffffff', ink: '#111111', grid: 5 },
  dots: { label: 'Dots', bg: '#ffffff', ink: '#111111', dots: 5 },
  lined: { label: 'Lined', bg: '#fdfdfa', ink: '#1a2030', lines: 8, top: 34, margin: 26, lineColor: '#c4d6ec', marginColor: '#eaa3a3' },
  graph: { label: 'Graph', bg: '#fbfdf9', ink: '#17251d', grid: 1, major: 10, gridColor: '#e2eee5', majorColor: '#a9cdb5' },
  cream: { label: 'Cream', bg: '#fbf7ec', ink: '#2a2620' },
  dark: { label: 'Dark', bg: '#1d2230', ink: '#e9edf5', dark: true },
  blueprint: { label: 'Blueprint', bg: '#13407a', ink: '#e8f1ff', grid: 5, major: 5, dark: true, gridColor: '#2d5d97', majorColor: '#4d7fbb' },
  chalk: { label: 'Chalkboard', bg: '#24382f', ink: '#f0efe4', dark: true },
};

/** where the page sits: the room around it in the 3D view (also used by exported HTML and videos) */
export interface Stage {
  label: string; about: string;
  /** background colour; omitted = the page's own colour (no visible sheet) */
  bg?: string;
  /** slab: paper with thickness and a shadow · flat: just the page area · none: no sheet at all */
  sheet: 'slab' | 'flat' | 'none';
  /** extra room around the page when fitting the view, in mm */
  pad: number; fit: number;
  surface?: 'wood'; frame?: boolean;
}
export const STAGES: Record<string, Stage> = {
  studio: { label: 'Studio', about: 'the page floats in a dark room', bg: '#202124', sheet: 'slab', pad: 0, fit: 1.08 },
  desk: { label: 'Desk', about: 'the page lies on a wooden desk', bg: '#2a2019', sheet: 'slab', pad: 0, fit: 1.08, surface: 'wood' },
  gallery: { label: 'Gallery', about: 'a bright room, good for screenshots', bg: '#e3e5e9', sheet: 'slab', pad: 0, fit: 1.08 },
  board: { label: 'Classroom', about: 'framed like a chalkboard on a classroom wall', bg: '#cfc8ba', sheet: 'slab', pad: 17, fit: 1.04, frame: true },
  present: { label: 'Present', about: 'fills the screen on black, for talks', bg: '#000000', sheet: 'flat', pad: 0, fit: 1.0 },
  float: { label: 'Floating', about: 'no sheet: figures float on the page colour', sheet: 'none', pad: 0, fit: 1.08 },
};

export const stageOf = (name: string | undefined) => STAGES[name || 'studio'] ?? STAGES.studio;

/** the printed rules of a paper style: line segments [x0, y0, x1, y1] (mm, y up) by colour, and dot positions */
export function pageRules(st: PageStyle, w: number, h: number): { lines: { color: string; width: number; seg: number[] }[]; dots: number[]; dotColor: string } {
  const out: { color: string; width: number; seg: number[] }[] = [];
  const group = (color: string, width: number) => { let g = out.find(o => o.color === color && o.width === width); if (!g) out.push(g = { color, width, seg: [] }); return g.seg; };
  if (st.grid) {
    const s = st.grid, maj = st.major || 0;
    const minor = st.gridColor || (st.dark ? '#3c6eaa' : '#cfe0f2'), major = st.majorColor || minor;
    for (let i = 1; i * s < w - 1e-6; i++) (maj && i % maj === 0 ? group(major, 0.16) : group(minor, 0.1)).push(i * s, 0, i * s, h);
    for (let j = 1; j * s < h - 1e-6; j++) (maj && j % maj === 0 ? group(major, 0.16) : group(minor, 0.1)).push(0, j * s, w, j * s);
  }
  if (st.lines) {
    const seg = group(st.lineColor || '#c4d6ec', 0.14);
    for (let y = h - (st.top ?? 20); y > 6; y -= st.lines) seg.push(0, y, w, y);
    if (st.margin) group(st.marginColor || '#eaa3a3', 0.2).push(st.margin, 0, st.margin, h);
  }
  const dots: number[] = [];
  if (st.dots) for (let x = st.dots; x < w; x += st.dots) for (let y = st.dots; y < h; y += st.dots) dots.push(x, y);
  return { lines: out, dots, dotColor: st.dark ? '#5b6a80' : '#b9c4d0' };
}
