// Copies MathJax's self-contained SVG build into public/ so the app works offline (desktop) and on any host.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
const src = 'node_modules/mathjax/es5/tex-svg-full.js';
const dst = 'public/vendor/tex-svg-full.js';
if (!existsSync(src)) { console.error('MathJax not installed — run npm install first'); process.exit(1); }
mkdirSync('public/vendor', { recursive: true });
copyFileSync(src, dst);
console.log('vendor: MathJax copied to', dst);
