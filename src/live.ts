// Live presenting: the presenter's browser connects straight to each viewer's browser (WebRTC through PeerJS).
// Viewers get the page code once, then small updates: the slide, the time, slider values, the camera and ink.
// The link carries a random key; a viewer who doesn't know it is disconnected straight away.

const PEERJS_URL = './board/lib/peerjs.min.js';
const CHUNK = 16000, MAX_DOC = 1_500_000;

export interface LiveDoc { name: string; source: string }
export interface LiveState { slide: number; t: number; playing: boolean; vals: Record<string, number>; cam: number[] | null; ortho: boolean }
type Msg = { t: 'hello'; key: string } | { t: 'doc'; doc: LiveDoc } | { t: 'state'; s: LiveState } | { t: 'bye' };

declare global { interface Window { Peer?: any; LM_PEER_OPTS?: any } }

let peerLoad: Promise<void> | null = null;
function loadPeer(): Promise<void> {
  if (window.Peer) return Promise.resolve();
  return (peerLoad ??= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = PEERJS_URL; s.async = true;
    s.integrity = 'sha384-nlUQ8ZqCbvStErob+biJNzSgltf6urV3VGqhfIfzhmg9RXmpeRm76ELw0pYnKlTR';   // the same pinned copy board mode uses
    s.onload = () => (window.Peer ? res() : rej(new Error('PeerJS did not load')));
    s.onerror = () => { peerLoad = null; rej(new Error("couldn't load the connection library")); };
    document.head.appendChild(s);
  }));
}
const peerOpts = () => Object.assign({ debug: 0 }, window.LM_PEER_OPTS || {});
function randId(n: number) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, b => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); }

/** one connection, with long messages split into pieces */
class Link {
  private parts = new Map<string, { n: number; got: number; a: string[] }>();
  constructor(public conn: any, private onMsg: (m: any) => void) {
    conn.on('data', (raw: any) => this.recv(raw));
  }
  send(m: Msg) {
    if (!this.conn.open) return;
    const s = JSON.stringify(m);
    try {
      if (s.length <= CHUNK) { this.conn.send(s); return; }
      const id = randId(6), n = Math.ceil(s.length / CHUNK);
      for (let i = 0; i < n; i++) this.conn.send(JSON.stringify({ t: '~', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
    } catch { /* the connection went away */ }
  }
  private recv(raw: any) {
    if (typeof raw !== 'string' || raw.length > CHUNK + 200) return;
    let m: any; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === '~') {
      if (typeof m.id !== 'string' || !Number.isInteger(m.n) || m.n < 1 || m.n > MAX_DOC / CHUNK + 2 || !Number.isInteger(m.i) || m.i < 0 || m.i >= m.n || typeof m.d !== 'string') return;
      let P = this.parts.get(m.id);
      if (!P) { if (this.parts.size > 8) this.parts.clear(); P = { n: m.n, got: 0, a: new Array(m.n) }; this.parts.set(m.id, P); }
      if (P.n !== m.n) return;
      if (P.a[m.i] == null) { P.a[m.i] = m.d; P.got++; }
      if (P.got === P.n) { this.parts.delete(m.id); try { this.onMsg(JSON.parse(P.a.join(''))); } catch { /* ignore */ } }
      return;
    }
    this.onMsg(m);
  }
}

// ---------------------------------------------------------------- presenter side
export class LiveHost {
  private peer: any = null; private key = randId(10);
  private links = new Set<Link>();
  link = '';
  onChange: (() => void) | null = null;
  constructor(private getDoc: () => LiveDoc, private getState: () => LiveState) {}
  get viewers() { let n = 0; for (const l of this.links) if (l.conn.open) n++; return n; }
  get on() { return !!this.peer; }

  async start(): Promise<string> {
    await loadPeer();
    return new Promise((res, rej) => {
      const peer = new window.Peer!('lm-' + randId(14), peerOpts());
      this.peer = peer;
      const fail = (e: any) => { if (!this.link) { this.stop(); rej(new Error(e?.type === 'network' || e?.type === 'server-error' ? "couldn't reach the connection server: check your internet connection" : (e?.message || 'live presenting failed'))); } };
      peer.on('open', (id: string) => {
        const base = /^https?:$/.test(location.protocol) && !/tauri/i.test(location.host) ? location.origin + location.pathname : 'https://latexmodeler.app/';
        this.link = `${base}#watch=${id}.${this.key}`;
        res(this.link); this.onChange?.();
      });
      peer.on('error', fail);
      peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* ignore */ } });
      peer.on('connection', (conn: any) => {
        let ok = false;
        const L = new Link(conn, (m: any) => {
          if (!ok) {
            if (m?.t === 'hello' && m.key === this.key) { ok = true; this.links.add(L); L.send({ t: 'doc', doc: this.getDoc() }); L.send({ t: 'state', s: this.getState() }); this.onChange?.(); }
            else { try { conn.close(); } catch { /* ignore */ } }
          }
        });
        conn.on('close', () => { this.links.delete(L); this.onChange?.(); });
        setTimeout(() => { if (!ok) try { conn.close(); } catch { /* ignore */ } }, 15000);
      });
    });
  }
  /** the page code or ink changed */
  doc() { if (!this.links.size) return; const d = this.getDoc(); for (const l of this.links) l.send({ t: 'doc', doc: d }); }
  private stateT = 0; private lastSig = '';
  /** the slide, time, sliders or camera changed (throttled) */
  state() {
    if (!this.links.size || this.stateT) return;
    this.stateT = window.setTimeout(() => {
      this.stateT = 0; const s = this.getState(); const sig = JSON.stringify(s); if (sig === this.lastSig) return; this.lastSig = sig;
      for (const l of this.links) l.send({ t: 'state', s });
    }, 90);
  }
  stop() {
    for (const l of this.links) { l.send({ t: 'bye' }); try { l.conn.close(); } catch { /* ignore */ } }
    this.links.clear();
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.peer = null; this.link = ''; this.onChange?.();
  }
}

// ---------------------------------------------------------------- viewer side
/** "#watch=<peer>.<key>" → its parts, or null */
export function parseWatch(hash: string): { id: string; key: string } | null {
  const m = /^#watch=(lm-[a-z0-9]{14})\.([a-z0-9]{10})$/.exec(hash.trim()); return m ? { id: m[1], key: m[2] } : null;
}
const num = (v: any, lo: number, hi: number) => typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
function cleanState(s: any): LiveState | null {
  if (!s || typeof s !== 'object' || !num(s.slide, 0, 1000) || !num(s.t, 0, 1e6)) return null;
  const vals: Record<string, number> = {};
  if (s.vals && typeof s.vals === 'object') for (const [k, v] of Object.entries(s.vals).slice(0, 40)) if (typeof k === 'string' && k.length <= 40 && num(v, -1e9, 1e9)) vals[k] = v as number;
  const cam = Array.isArray(s.cam) && s.cam.length === 14 && s.cam.every((v: any) => num(v, -1e7, 1e7)) ? s.cam : null;
  return { slide: Math.floor(s.slide), t: s.t, playing: !!s.playing, vals, cam, ortho: !!s.ortho };
}

export class LiveViewer {
  private peer: any = null; private link: Link | null = null;
  status: 'connecting' | 'live' | 'ended' | 'failed' = 'connecting';
  onDoc: ((d: LiveDoc) => void) | null = null;
  onState: ((s: LiveState) => void) | null = null;
  onStatus: (() => void) | null = null;
  constructor(private target: { id: string; key: string }) {}
  async join() {
    try { await loadPeer(); } catch { this.set('failed'); return; }
    const peer = new window.Peer!(undefined, peerOpts()); this.peer = peer;
    peer.on('error', () => { if (this.status === 'connecting') this.set('failed'); });
    peer.on('open', () => {
      const conn = peer.connect(this.target.id, { reliable: true });
      this.link = new Link(conn, (m: any) => this.msg(m));
      conn.on('open', () => this.link!.send({ t: 'hello', key: this.target.key }));
      conn.on('close', () => { if (this.status !== 'failed') this.set('ended'); });
      setTimeout(() => { if (this.status === 'connecting') this.set('failed'); }, 20000);
    });
  }
  private msg(m: any) {
    if (m?.t === 'doc' && m.doc && typeof m.doc.source === 'string' && m.doc.source.length <= MAX_DOC) {
      const name = (typeof m.doc.name === 'string' && m.doc.name.trim() ? m.doc.name.trim() : 'live.bd').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
      if (this.status !== 'live') this.set('live');
      this.onDoc?.({ name, source: m.doc.source });
    } else if (m?.t === 'state') { const s = cleanState(m.s); if (s) this.onState?.(s); }
    else if (m?.t === 'bye') this.set('ended');
  }
  private set(s: LiveViewer['status']) { this.status = s; this.onStatus?.(); }
  leave() { try { this.peer?.destroy(); } catch { /* ignore */ } this.peer = null; this.set('ended'); }
}
