// Register the service worker that keeps the app usable offline (web only: the desktop app already has
// everything on disk, and its pages aren't served over http).
export function registerOffline() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || (window as any).__TAURI_INTERNALS__) return;
  if (location.hostname === 'localhost' && location.port === '5173') return;   // not under the dev server
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline mode is a bonus */ }); });
}
