import { defineConfig, type Plugin } from 'vite';
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

/* After a web build, write dist/sw.js: a service worker that keeps the whole app (pages, the figure host,
   MathJax, the exported-page player) on the device, so it opens offline after one visit. Board mode
   (dist/board/) has its own service worker and is left to it. */
function offline(): Plugin {
  return {
    name: 'offline-sw', apply: 'build',
    closeBundle() {
      const dist = 'dist', files: string[] = [];
      const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(relative(dist, p).split('\\').join('/')); } };
      walk(dist);
      const list = files.filter(f => !f.startsWith('board/') && !f.startsWith('licenses/') && f !== 'sw.js').sort();
      const h = createHash('sha256'); for (const f of list) h.update(f).update(readFileSync(join(dist, f)));
      const version = h.digest('hex').slice(0, 12);
      writeFileSync(join(dist, 'sw.js'), readFileSync('src/sw-template.js', 'utf8')
        .replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./', ...list.map(f => './' + f)])));
    },
  };
}

// Relative base so the same build works on GitHub Pages, itch.io, a claude.ai artifact and inside Tauri.
export default defineConfig({
  base: './',
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  plugins: [offline()],
  build: {
    target: 'es2021', chunkSizeWarningLimit: 4000, sourcemap: false,
    // three.js in its own file: it rarely changes, so browsers keep it cached across app updates
    // two pages: the app, and the figure host that board mode embeds
    rollupOptions: { input: { main: 'index.html', figure: 'figure.html' }, output: { manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined) } },
  },
});
