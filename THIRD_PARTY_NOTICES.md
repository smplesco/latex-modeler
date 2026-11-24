# Third-party notices

LaTeX Modeler is proprietary software (see `LICENSE`), but it includes the open-source components below. Each one remains under its own license, and the full license texts are shipped in `public/licenses/` (and therefore with the website, the desktop app and the source).

| Component | Used for | License | Copyright |
|---|---|---|---|
| [MathJax](https://www.mathjax.org) 3.2 | typesetting LaTeX | Apache License 2.0 | © The MathJax Consortium |
| [three.js](https://threejs.org) 0.160 | 3D rendering | MIT | © 2010–2023 three.js authors |
| [Inter](https://rsms.me/inter/) (via Fontsource) | interface font | SIL Open Font License 1.1 | © The Inter Project Authors |
| [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (via Fontsource) | code font | SIL Open Font License 1.1 | © The JetBrains Mono Project Authors |
| [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 5.2 | writing MP4 video files | MIT | © Vanilagy |
| [gifenc](https://github.com/mattdesl/gifenc) 1.0 | writing animated GIFs | MIT | © 2017 Matt DesLauriers |
| [jsPDF](https://github.com/parallax/jsPDF) 2.5.1 | board mode: PDF export | MIT | © 2010–2021 James Hall, yWorks GmbH |
| [JSZip](https://stuk.github.io/jszip/) 3.10.1 | board mode: exporting several pictures as a .zip | MIT (dual-licensed MIT or GPLv3; used under MIT) | © 2009–2016 Stuart Knightley and contributors |
| [PDF.js](https://mozilla.github.io/pdf.js/) 3.11.174 | board mode: opening PDFs to write on | Apache License 2.0 | © Mozilla Foundation |
| [PeerJS](https://peerjs.com) 1.5.4 | board mode: live sessions | MIT | © 2015 Michelle Bu and Eric Zhang |
| [jsPDF](https://github.com/parallax/jsPDF) 4.2 and [svg2pdf.js](https://github.com/yWorks/svg2pdf.js) 2.9 | pages: vector PDF export (loaded only when you export a PDF) | MIT | © 2010–2025 James Hall, yWorks GmbH and contributors |
| jsPDF's helpers [fflate](https://github.com/101arrowz/fflate), [DOMPurify](https://github.com/cure53/DOMPurify), [html2canvas](https://html2canvas.hertzen.com), [canvg](https://github.com/canvg/canvg), [core-js](https://github.com/zloirock/core-js) | compression and optional features of jsPDF | MIT; DOMPurify MPL 2.0 or Apache 2.0 (used under Apache 2.0) | © their authors |
| [hersheytext](https://github.com/techninja/hersheytext) 2.0 (Hershey stroke fonts and the EMS single-line fonts) | handwriting recognition: the letter shapes it compares your writing with (converted to point lists at build time) | MIT; the EMS fonts under the SIL Open Font License 1.1; the Hershey fonts by A. V. Hershey (U.S. National Bureau of Standards), freely usable with this notice | © James T. Ewing, Evil Mad Scientist Laboratories, and contributors |
| [Tauri](https://tauri.app) 2 and its Rust and JavaScript packages | desktop app | MIT or Apache License 2.0 | © Tauri Programme within The Commons Conservancy |

MathJax, jsPDF, JSZip, PDF.js and PeerJS are redistributed unmodified (live presenting on pages uses the same pinned copy of PeerJS as board mode) (board mode keeps its own copy of MathJax 3.2.2 in `board/lib/`). Exported interactive HTML pages contain MathJax and three.js and carry a notice naming them and their licenses.
