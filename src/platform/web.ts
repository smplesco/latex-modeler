// Browser implementation: file picker + downloads.
import type { Platform, OpenedFile } from './index';

function pick(): Promise<File | null> {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.bd,.txt,.tex,.tikz';
    inp.onchange = () => resolve(inp.files?.[0] ?? null);
    inp.click();
  });
}
function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function webPlatform(): Platform {
  return {
    kind: 'web',
    async openFile(): Promise<OpenedFile | null> {
      const f = await pick(); if (!f) return null;
      return { name: /\.(bd|tex|tikz)$/i.test(f.name) ? f.name : f.name + '.bd', text: await f.text() };
    },
    async saveFile(name, text) { download(name, new Blob([text], { type: 'text/plain' })); return { name }; },
    async exportFile(defaultName, data, mime) { download(defaultName, new Blob([data as BlobPart], { type: mime })); return true; },
    setTitle(t) { document.title = t; },
    async initialFile() { return null; },
  };
}
