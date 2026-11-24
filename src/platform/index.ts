// The only part of the app that differs between the browser and the desktop (Tauri) build.
export interface OpenedFile { name: string; path?: string; text: string; /** a .screenboard file: board mode opens it */ board?: boolean }
export interface Platform {
  kind: 'web' | 'desktop';
  /** let the user pick a .bd file */
  openFile(): Promise<OpenedFile | null>;
  /** save text; returns where it went (path on desktop) or null if cancelled */
  saveFile(name: string, text: string, path?: string, saveAs?: boolean): Promise<{ name: string; path?: string } | null>;
  /** export binary/text data (SVG, PNG); returns false if cancelled or unsupported */
  exportFile(defaultName: string, data: string | Uint8Array, mime: string): Promise<boolean>;
  setTitle(title: string): void;
  /** a file the app was launched with (double-clicked .bd on Windows) */
  initialFile(): Promise<OpenedFile | null>;
}

export const isTauri = () => typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);

export async function getPlatform(): Promise<Platform> {
  if (isTauri()) { const m = await import('./tauri'); return m.tauriPlatform(); }
  const m = await import('./web'); return m.webPlatform();
}
