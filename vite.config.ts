import { defineConfig } from 'vite';

// Relative base so the same build works on GitHub Pages, itch.io, a claude.ai artifact and inside Tauri.
export default defineConfig({
  base: './',
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2021', chunkSizeWarningLimit: 4000, sourcemap: false,
    // three.js in its own file: it rarely changes, so browsers keep it cached across app updates
    rollupOptions: { output: { manualChunks: (id) => (id.includes('node_modules/three/') ? 'three' : undefined) } },
  },
});
