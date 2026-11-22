# LaTeX Modeler

**3D LaTeX pages, plus an automatic equation modeller.**

You write pages in a small scripting language (`.bd`). Text and math are typeset with LaTeX and turned into real 3D geometry. Figures look like flat textbook drawings when viewed straight on, and you can orbit around them in 3D. You can also type any equation into the **Auto-model** box, and LaTeX Modeler works out what kind of object it is, frames and analyses it, and writes a complete annotated page for it. The page is ordinary code, so you can edit every line.

Runs in the browser, or as a Windows / macOS / Linux desktop app (Tauri).

**Start screen.** The app opens on a start screen instead of a page. From there you can:
- pick a **template**: blank page, lecture notes (ruled paper on a desk), chalkboard (framed on a classroom wall), 16:9 slides, blueprint, poster, graph-paper worksheet, or a floating figure. Or build a blank page in any size, paper and stage.
- open an **example** from the library, sorted into folders: getting started, surfaces, curves and fields, physics, calculus, linear algebra.
- type an equation to auto-model it.
- go back to the pages you already have open.

**Formats.** A page has a size, a paper and a *stage*, the room it sits in:
```
page("A4", "lined", {stage: "desk"})
```
- **Papers:** plain, grid, dots, lined, graph, cream, dark, blueprint, chalk.
- **Stages:**
  - studio: the classic dark room
  - desk: a wooden desk
  - gallery: a bright room
  - board: a framed chalkboard
  - present: fills the screen on black
  - float: no sheet, figures float on the page colour

To change the format of any page, use **Page ▾** in the viewer. It rewrites the `page(…)` line, so Ctrl+Z undoes it.

---

## 1. Use it right away (no install)

Open the hosted web version (see *Publishing the web version* below), or run it locally (next section). Everything works in Chrome, Edge or Firefox.

## 2. Run it on your Windows PC (web version, for development)

1. Install **Node.js LTS** and **Git**. In PowerShell:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   ```
   Close and reopen PowerShell afterwards.
2. Unzip the project (e.g. to `C:\Users\you\code\latex-modeler`) and open PowerShell in that folder.
3. Install and start:
   ```powershell
   npm install
   npm run dev
   ```
4. Open **http://localhost:5173**. Edits to the source reload instantly.

Other commands:

| command | what it does |
|---|---|
| `npm test` | runs the auto-modeller over ~100 equations and executes every generated page |
| `npm run typecheck` | TypeScript check |
| `npm run build` | production web build in `dist/` (works on any static host) |

## 3. Get the Windows desktop app

### Option A: let GitHub build it (no installs on your PC)

1. Create an empty repository on GitHub (e.g. `smplesco/latex-modeler`).
2. In the project folder:
   ```powershell
   git init
   git add .
   git commit -m "Initial version"
   git branch -M main
   git remote add origin https://github.com/<you>/latex-modeler.git
   git push -u origin main
   ```
3. On GitHub, open **Actions → Desktop release → Run workflow**. It builds Windows, macOS and Linux installers in about 10–15 minutes.
4. Open **Releases**. There's a draft named *LaTeX Modeler v0.1.0*. Download `LaTeX Modeler_0.1.0_x64_en-US.msi` (or `LaTeX Modeler_0.1.0_x64-setup.exe`) and run it.
5. The app isn't code-signed yet, so Windows will show **"Windows protected your PC"**. Click **More info → Run anyway**.
6. LaTeX Modeler appears in the Start menu, and double-clicking any `.bd` file opens it in LaTeX Modeler.

Click **Publish release** on the draft when you want others to download it. To make a new version, bump `version` in `package.json` and `src-tauri/tauri.conf.json`, then run the workflow again (or push a tag like `v0.2.0`).

### Option B: build it on your own PC

One-time setup:

1. **Microsoft C++ Build Tools**: install from https://visualstudio.microsoft.com/visual-cpp-build-tools/ and tick **"Desktop development with C++"**.
2. **Rust**: `winget install Rustlang.Rustup`, then reopen PowerShell.
3. **WebView2** is already part of Windows 11 and current Windows 10.

Then, in the project folder:

```powershell
npm install
npm run tauri dev      # opens the desktop app with live reload
npm run tauri build    # makes the installers
```

The installers end up in `src-tauri\target\release\bundle\msi\` and `...\bundle\nsis\`.

## 4. Publishing the web version

* **GitHub Pages:** in the repository, go to **Settings → Pages → Source: GitHub Actions**. Every push to `main` then publishes the site (workflow `pages.yml`).
* **itch.io or any static host:** run `npm run build` and upload the contents of `dist/` (zip it for itch.io as an HTML project).

---

## Using LaTeX Modeler

### Auto-model: type an equation, get a page

Type LaTeX in the box at the top of the viewer and press **Enter** (or pick one from **Examples…**). A live preview shows the typeset equation and what LaTeX Modeler thinks it is. Examples of what it understands:

| you type | you get |
|---|---|
| `y = \frac{\sin x}{x}`, `f(x) = x^3 - 3x` | graph with π-ticks when it helps; roots, extrema, inflections, f′ and f″, and a tangent line that slides along when you press play |
| `z = x e^{-x^2-y^2}` | shaded 3D surface with floor contours, critical points classified (min / max / saddle), partial derivatives, and a point travelling over the surface with its gradient |
| `(x^2+y^2-1)^3 = x^2 y^3`, `\frac{x^2}{9}+\frac{y^2}{4}=1` | implicit curve; conics are named (circle, ellipse, parabola, hyperbola) with centre and radius |
| `x^2 + y^2 = 4, \quad y = x^2 - 1` | system of equations, with the solutions marked and listed |
| `x^2 + y^2 - z^2 = 1` | implicit surface; quadrics are named (sphere, ellipsoid, hyperboloids, cone, paraboloids, cylinders) |
| `r = \sin 4\theta`, `r = 1 + 0.3\sin 3\theta \sin 2\phi` | polar curve (period and area detected) · spherical surface |
| `\mathbf{r}(t) = (\cos t, \sin t, t/5)` or `x = \cos 3t, y = \sin 2t` | parametric curve with velocity, speed and arc length, and a moving point |
| `\mathbf{r}(u,v) = (\dots)` | parametric surface with tangent vectors and surface area |
| `\mathbf{F}(x,y) = (-y, x)` | vector field with streamlines, coloured arrows, divergence, curl and equilibria |
| `\frac{dy}{dx} = y(1-y)`, `y' = x - y` | slope field, RK4 solution curves, equilibria and their stability |
| `A = \begin{pmatrix} 2 & 1 \\ 1 & 3 \end{pmatrix}` | the matrix as a linear map, with eigenvectors, determinant and a morph animation (2×2 and 3×3) |
| `x^2 + y^2 \le 4` | shaded region with its area |
| `x^3 - 2x = 1` | the equation solved graphically |
| `F = G\frac{m_1 m_2}{r^2}` | any formula: the other letters become editable parameters |

You can add a domain after a comma: `y = \sin x, \; x \in [0, 4\pi]` or `z = x^2 - y^2, \; -1 \le x \le 1`.
The parser also accepts implicit multiplication (`2\pi r`, `xy`), `\sin^2 x`, `\sqrt[3]{x}`, `|x|`, `\lfloor x \rfloor`, `\binom{n}{k}`, `n!`, `\pm`, `cases`, matrices, finite `\sum` / `\prod`, `30^\circ`, and Unicode (π, θ, ², ≤).
Calculus: definite and improper integrals (shaded area, animated Riemann sums, exact value when it recognises one, like √π or π²/6), accumulation functions `F(x) = \int_0^x f(t)\,dt` and indefinite integrals, limits (two-sided, one-sided `0^+`, at infinity, sequences), and infinite series (partial sums, convergence verdict, ratio test) including power series in x (partial-sum curves and radius of convergence).

Not supported yet: double integrals, partial-derivative notation as input, complex numbers, higher-order ODEs.

### The viewer

* **Drag** to orbit, **right-drag** to pan, **scroll** to zoom.
* **Click** any element to jump to the line of code that drew it.
* **Play / slider:** scripts can use `t`, the time on the timeline.
* **Camera:** a turntable tour that follows the timeline.
* **Ortho:** switch between orthographic and perspective.
* **Reset:** back to the page view.

### Figure Explorer: open any graph as a 3D model

Every plot frame on the page, and every hand-drawn 3D figure made with `onpage(...)`, gets a small **⤢ Explore** button on its corner of the paper. Click it (or double-click the figure, or press **E**) and the figure opens as its own full-size, re-computed graph on top of the page. Hand-drawn figures show the coordinates of any point or line in the drawing's own x, y, z. The page and its code are untouched; **✕ Close** or **Esc** takes you back.

* **3D figures:** drag to turn, right-drag to pan, scroll to zoom. **Iso / Top / Front / Side** snap to standard views, **Persp** toggles perspective, **Spin** turns it on a turntable.
* **Hover to probe.** The readout on the right shows exact values at the point under the mouse:
  * surfaces `z = f(x, y)`: the point, ∂f/∂x and ∂f/∂y with the two cross-sections drawn (green and red) and their tangent lines, |∇f| with the gradient arrow on the floor, and the tangent-plane equation (tick *Tangent plane* to draw it);
  * parametric surfaces: (u, v), the point, S_u, S_v and the normal;
  * implicit surfaces: the point, ∇G, and a horizontal slice through the surface at that height;
  * curves: t, r(t), r′(t), speed and curvature, with the velocity arrow;
  * 2D graphs: f(x), f′(x), f″(x) and the tangent line; contour value G(x, y); vector field F(x, y); slope dy/dx.
* **2D figures:** drag to pan and scroll to zoom. Curves are recomputed for the new window, so zooming stays sharp.
* **Click to pin** a point; pins are listed and **Copy** puts them on the clipboard. On a slope field, a click draws the solution curve through that point.
* **Range:** type new x / y / z limits and press Apply; *equal scale* keeps circles round. **Original** puts them back.
* **Parameters:** every top-level number in the code (`a = 2`, `k = 0.5`…) gets a slider. Move it to see the figure change live; **write to code** puts the value into the page.
* **Show:** turn cross-sections, wireframe, box and other helpers on or off.
* **Snapshot** saves a PNG of the explorer view; **⤢** fills the window.
* **Export → 3D model (GLB)** saves the figure with its colours, curves and labels for Blender, PowerPoint (Insert → 3D Model), Windows 3D Viewer or a web viewer. **STL for 3D printing** saves its surfaces as watertight 1.2 mm shells in millimetres, z up, ready for a slicer.
* **Phones and tablets:** tap the figure to read values (then **📌 Pin this point**), drag to pan and pinch to zoom 2D graphs; the explorer fills the screen on small displays.


### Files and export

* **New, Open…, Save** (Shift-click Save for *Save As*). On the desktop these are real files with native dialogs. In the browser, Save downloads the `.bd` file, and open tabs are kept between visits.
* **Export ▾:**
  * **Page as SVG:** vector output for print or Inkscape.
  * **Page as PNG:** 200 dpi.
  * **Current view as PNG:** what you see on screen.
  * **Share link:** the page's code compressed into a link (after the `#`, so nothing is uploaded anywhere). Whoever opens it gets a live copy of the page in the web app. Links made in the desktop app point to the GitHub Pages site.
  * **Interactive HTML (3D):** one self-contained `.html` file with the page, the 3D viewer, the timeline and the Figure Explorer built in. Send it to anyone: it opens in Chrome, Edge, Firefox or Safari by double-clicking it, with nothing to install, and has an **Open in LaTeX Modeler** button for an editable copy. Two sizes:
    * **Compact (≈ 0.7–1 MB):** every label on the page is pre-rendered inside the file. Works offline; only brand-new labels (e.g. tick numbers after zooming in the explorer, or text that changes continuously while playing) fetch the LaTeX engine from the internet.
    * **Full (≈ 2.8 MB):** includes the whole LaTeX engine, so everything works offline, always.
    It can also be uploaded to itch.io (as an HTML project), GitHub Pages, Google Sites (Embed → code) or a learning platform that accepts HTML files.
  * **3D model (GLB):** the whole page as a 3D scene.
  * **Video or GIF…:** records the view as MP4 (or WebM where MP4 isn't available) or an animated GIF: a swing or full turn around the page, or the page's own animation, at 640×360 up to 1920×1080. Frames are rendered one by one, so the video is smooth however heavy the page is.
  * **Copy page code**

### Shortcuts

| shortcut | action |
|---|---|
| Ctrl+Enter | run now |
| Ctrl+S / Ctrl+Shift+S | save / save as |
| Ctrl+O | open |
| Ctrl+Alt+N | new page |
| Ctrl+M | jump to the auto-model box |
| Ctrl+/ | toggle comment |
| Space · F · O (in the viewer) | play, reset view, ortho |
| E | open the first figure in the explorer (Esc closes it) |

### The `.bd` language in one minute

```bd
page("A4", "paper")                         // sizes: A3 A4 A5 letter … · styles: paper grid dots dark blueprint
tex("\textbf{Title}", (105, 280), {size: 20})   // LaTeX at a point (mm, origin bottom-left)
f(x) = sin(x) / x                           // functions; vectors are (x, y, z)
F = frame2d((30, 140), (150, 100), (-10, 10), (-0.4, 1.2), {piTicks: true})
fplot(F, f)                                 // also: cplot region quiver streamlines slopefield solcurve pplot
B = frame3d((105, 70), 80, (-2, 2), (-2, 2), (-1, 1))
splot(B, (x, y) => sin(x * y))              // also: psurf isoplot quiver pplot (all in 3D)
dot(B.map((0, 0, 0)), {r: 1, color: "#d64545"})
for k in 0..5 { line((20, 30 + 4 * k), (60, 30 + 4 * k)) }
c = 1 + 0.5 * sin(t)                        // t = timeline time → animation
```

The **Reference** tab at the bottom of the app lists every function.

---

## Project layout

```
src/
  lang/       the .bd language: parser, interpreter, built-ins, plotting library (plots.ts)
  model/      auto-modeller: LaTeX parser (latex.ts), algebra engine (sym.ts),
              numerical analysis (numeric.ts), classification + page writer (generate.ts)
  geom/       ticks, colormaps, marching squares / tetrahedra
  render/     three.js viewer, MathJax glyph meshes, SVG export
  explore/    Figure Explorer (explorer.ts) and the ⤢ Explore buttons (chips.ts)
  player.ts   the viewer-only build used inside exported .html files
              (built to public/player/player.js by `npm run build:player`; dev and build run it for you)
  editor/     code editor
  platform/   web.ts and tauri.ts: the only code that differs between browser and desktop
  examples/   example pages, one folder per topic (shown on the start screen)
  templates/  starter pages for the New page templates
  library.ts  reads templates/examples (title from the first comment line)
  ui/         start screen (home.ts), card pictures (thumbs.ts), reference panel
src-tauri/    desktop wrapper (Rust): dialogs, file access, .bd file association
tests/run.ts  auto-model corpus test
.github/workflows/  CI, desktop release builds, GitHub Pages
```

Everything runs locally: MathJax, fonts and three.js are bundled, so the desktop app works offline.

---

## License

Copyright © 2026 smplesco. **All rights reserved.** This repository is public so the web version can be hosted on GitHub Pages, but no license is granted: you may not use, copy, modify or redistribute the code without written permission. See [`LICENSE`](LICENSE).

Pages you make with LaTeX Modeler, and the files you export from them, are yours.

Open-source components (MathJax, three.js, Tauri, the Inter and JetBrains Mono fonts) keep their own licenses: see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
