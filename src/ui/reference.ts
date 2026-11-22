// Reference panel content.
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const REF: [string, [string, string][]][] = [
  ['Auto-model (top of the viewer)', [
    ['type LaTeX → Enter', 'LaTeX Modeler classifies the equation and writes an editable page for it'],
    ['y = f(x), f(x) = …', 'graph with roots, extrema, derivative and a sliding tangent'],
    ['z = f(x, y)', 'shaded surface, floor contours, critical points, gradient'],
    ['F(x, y) = G(x, y)', 'implicit curve (conics are named); several equations → system with solutions'],
    ['F(x, y, z) = 0', 'implicit surface (quadrics are named)'],
    ['r = f(\\theta) · r = f(\\theta, \\phi)', 'polar curve · spherical surface'],
    ['\\mathbf{r}(t) = (…) · x = …, y = …', 'parametric curve with moving point and velocity'],
    ['\\mathbf{r}(u, v) = (…)', 'parametric surface with surface area'],
    ['\\mathbf{F}(x, y) = (P, Q)', 'vector field: streamlines, arrows, div and curl'],
    ["y' = f(x, y) · \\frac{dy}{dx} = …", 'slope field, RK4 solutions, equilibria'],
    ['\\begin{pmatrix}…\\end{pmatrix}', 'matrix as a linear map, eigenvectors, morph animation'],
    ['x^2 + y^2 \\le 4', 'shaded region with area'],
    ['x \\in [a, b] · a \\le t \\le b', 'add a domain after a comma to set the range'],
  ]],
  ['Document', [['page(size, style, {stage})', 'A3 A4 A5 A6 letter legal square slide, "A4 landscape" or (w, h) mm · paper grid dots lined graph cream dark blueprint chalk'], ['{stage: …}', 'studio (default) · desk · gallery · board (classroom) · present · float — the room the page sits in; also the Page ▾ menu'], ['duration(sec)', 'timeline length; t runs 0 → sec'], ['view(yaw, pitch, zoom)', 'scripted camera, used while Camera is on'], ['set({color, width, size})', 'defaults for later marks']]],
  ['Marks (mm, origin bottom-left, z toward the reader)', [['tex(s, p, {size, color, anchor, face, rot, maxw})', 'LaTeX; anchor c n s e w ne nw se sw base; face "page" | "viewer"; maxw shrinks to fit'], ['text(s, p, opts)', 'plain text'], ['line(p1, p2, …, {color, width, dash, closed})', 'polyline; also accepts a list'], ['arrow(a, b, {color, width, head, both})', ''], ['poly(pts, {fill, opacity, stroke})', 'filled polygon in any plane'], ['rect · circle · arc · dot', ''], ['curve(f, a, b, {n})', 'f(s) → point'], ['surface(f, (u0,u1), (v0,v1), {n, fill, wire})', 'raw parametric mesh in page space']]],
  ['Plot frames', [['F = frame2d(origin, (w, h), (x0, x1), (y0, y1), opts)', 'axes, ticks, grid · {equal, polar, piTicks, xlabel, ylabel, box, grid}'], ['B = frame3d(center, size, xr, yr, zr, opts)', 'textbook 3D box · {equal, zscale, yaw, tilt, labels, style: "box" | "axes", piX}'], ['F.map(p)', 'data point → page point (lifted with its figure)'], ['F.x0 … F.z1, F.floor', 'ranges and the floor height of a 3D frame']]],
  ['Plots', [['fplot(F, f, opts)', 'y = f(x), clipped, breaks at poles'], ['pplot(F, g, (t0, t1), opts)', 'parametric curve, 2D or 3D frame'], ['cplot(F, G, {level})', 'implicit curve G(x, y) = level'], ['region(F, cond, {fill, opacity})', 'shade where cond(x, y) is true'], ['quiver(F, v, {n, colormap})', 'vector field, 2D or 3D'], ['streamlines(F, v, {n})', '2D flow lines'], ['slopefield(F, f) · solcurve(F, f, (x0, y0))', 'ODE dy/dx = f(x, y)'], ['splot(B, f, {n, wire, floor, colormap})', 'surface z = f(x, y) with floor contours'], ['psurf(B, g, ur, vr, {colorBy})', 'parametric surface'], ['isoplot(B, G, {level, n, fill, opacity})', 'implicit surface G(x, y, z) = level']]],
  ['3D placement', [['axo(yaw, tilt) · iso()', 'rotation for a z-up model'], ['onpage(R, origin, scale)', 'returns pr(p): model point → page point'], ['rotx rotz roty · mat(r1, r2[, r3]) · ident() · det · transpose', 'matrices; M * v, lerp(M1, M2, s)']]],
  ['Language', [['x = expr · f(a, b) = expr', 'assignment and functions; bodies can be { blocks }'], ['s => expr · (u, v) => expr', 'lambdas'], ['(x, y, z) · v.x · [a, b] · 0..n', 'vectors, lists, ranges (end excluded)'], ['for i in 0..n { … } · if c { … } else { … }', ''], ['"strings"', 'raw: backslashes are kept for LaTeX; + concatenates'], ['t', 'current time (the page re-runs while playing)']]],
  ['Math', [['sin cos tan sec csc cot asin acos atan atan2 sinh cosh tanh …', ''], ['sqrt cbrt exp log log10 abs floor ceil sign gamma fact erf sinc', ''], ['rad deg clamp lerp smoothstep ease · dot cross norm normalize len', ''], ['range linspace map sum prod str fmt print rgb hsl isnan', '']]],
  ['Keys', [['Ctrl+Enter', 'run now'], ['Ctrl+S / Ctrl+Shift+S', 'save / save as'], ['Ctrl+O · Ctrl+Alt+N', 'open · new'], ['Ctrl+M', 'jump to the auto-model box'], ['Ctrl+/', 'toggle comment'], ['Space · F · O', 'in the viewer: play, reset view, ortho']]],
];
export const REFERENCE = '<div class="ref">' + REF.map(([h, items]) => `<h4>${esc(h)}</h4>` + items.map(([c, d]) => `<div><code>${esc(c)}</code> ${d ? '<span>— ' + esc(d) + '</span>' : ''}</div>`).join('')).join('') + '</div>';
