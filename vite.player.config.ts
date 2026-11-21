// Builds the standalone player (src/player.ts) as one self-contained script: public/player/player.js.
// The app's "Interactive HTML (3D)" export inlines this script + MathJax + the page code into one .html file.
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'public/player',
    emptyOutDir: true,
    copyPublicDir: false,
    assetsInlineLimit: 100_000_000,
    lib: { entry: 'src/player.ts', name: 'LatexModelerPlayer', formats: ['iife'], fileName: () => 'player.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
    minify: 'esbuild',
    reportCompressedSize: false,
  },
});
