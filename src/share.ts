// Share links: a page's code, compressed into the part of the URL after '#'.
// Browsers never send that part to a server, so the link itself carries the page and nothing is uploaded.
// Format: #s=<z|u><base64url>  (z = deflate-raw compressed JSON, u = uncompressed JSON) of {n: name, s: source}

/** where the web app lives; links made by the desktop app (or an exported page) point here */
export const APP_URL = 'https://latexmodeler.app/';
const MAX_SOURCE = 1_000_000; // refuse absurd payloads (and decompression bombs)

const b64url = (u8: Uint8Array) => {
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i); return u8;
};
const canZip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream, cap = Infinity): Promise<Uint8Array> {
  const out: Uint8Array[] = []; let n = 0;
  const reader = (new Blob([data as BlobPart]).stream().pipeThrough(stream as any) as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    n += value.length; if (n > cap) { await reader.cancel(); throw new Error('shared page is too large'); }
    out.push(value);
  }
  const all = new Uint8Array(n); let o = 0; for (const c of out) { all.set(c, o); o += c.length; } return all;
}

/** the share fragment ("s=…", without '#') for a page */
export async function shareFragment(name: string, source: string): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify({ n: name, s: source }));
  if (canZip()) return 's=z' + b64url(await pipe(json, new CompressionStream('deflate-raw')));
  return 's=u' + b64url(json);
}
/** a full share link; on the web it points at the app the user is on, elsewhere at the public site */
export async function shareLink(name: string, source: string): Promise<string> {
  const here = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && !/tauri/i.test(location.host)
    ? location.origin + location.pathname : APP_URL;
  return here + '#' + await shareFragment(name, source);
}
/** decode a location.hash; null when it isn't a share link */
export async function readShare(hash: string): Promise<{ name: string; source: string } | null> {
  const m = /^#?s=([zu])([A-Za-z0-9_-]+)$/.exec(hash.trim()); if (!m) return null;
  const bytes = unb64url(m[2]);
  const json = m[1] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_SOURCE * 2) : bytes;
  const o = JSON.parse(new TextDecoder().decode(json));
  if (!o || typeof o.s !== 'string' || o.s.length > MAX_SOURCE) throw new Error('not a valid shared page');
  const name = (typeof o.n === 'string' && o.n.trim() ? o.n.trim() : 'shared.bd').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  return { name: /\.bd$/.test(name) ? name : name + '.bd', source: o.s };
}
