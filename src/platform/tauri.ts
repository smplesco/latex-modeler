// Desktop implementation (Tauri v2): native Open / Save dialogs and real files on disk.
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Platform, OpenedFile } from './index';

const BD = [{ name: 'LaTeX Modeler page', extensions: ['bd'] }];
const base = (p: string) => p.split(/[\\/]/).pop() || p;

export function tauriPlatform(): Platform {
  return {
    kind: 'desktop',
    async openFile(): Promise<OpenedFile | null> {
      const p = await open({ multiple: false, directory: false, filters: [...BD, { name: 'All files', extensions: ['*'] }] });
      if (!p || Array.isArray(p)) return null;
      return { name: base(p), path: p, text: await readTextFile(p) };
    },
    async saveFile(name, text, path, saveAs) {
      let target = path;
      if (!target || saveAs) {
        const p = await save({ defaultPath: name.endsWith('.bd') ? name : name + '.bd', filters: BD });
        if (!p) return null;
        target = p;
      }
      await writeTextFile(target, text);
      return { name: base(target), path: target };
    },
    async exportFile(defaultName, data, mime) {
      const ext = defaultName.split('.').pop() || '';
      const p = await save({ defaultPath: defaultName, filters: [{ name: mime, extensions: [ext] }] });
      if (!p) return false;
      if (typeof data === 'string') await writeTextFile(p, data); else await writeFile(p, data);
      return true;
    },
    setTitle(t) { getCurrentWindow().setTitle(t).catch(() => {}); document.title = t; },
    async initialFile() {
      try {
        const p = await invoke<string | null>('opened_file');
        if (!p) return null;
        return { name: base(p), path: p, text: await readTextFile(p) };
      } catch { return null; }
    },
  };
}
