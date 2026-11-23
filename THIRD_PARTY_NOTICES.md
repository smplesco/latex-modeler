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
| [Tauri](https://tauri.app) 2 and its Rust and JavaScript packages | desktop app | MIT or Apache License 2.0 | © Tauri Programme within The Commons Conservancy |

MathJax, jsPDF, JSZip, PDF.js and PeerJS are redistributed unmodified (board mode keeps its own copy of MathJax 3.2.2 in `board/lib/`). Exported interactive HTML pages contain MathJax and three.js and carry a notice naming them and their licenses.
