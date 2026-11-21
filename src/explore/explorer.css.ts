// Styles for the Figure Explorer (injected at runtime so the standalone HTML player gets them too).
export const EXPLORER_CSS = `
.xp{position:absolute;inset:0;z-index:30;display:none;flex-direction:column;background:#fbfcfd;color:#1e2329;font-family:Inter,system-ui,'Segoe UI',sans-serif;font-size:12.5px}
.xp.show{display:flex}
.xp.max{position:fixed;inset:0;z-index:45}
.xp-bar{flex:none;display:flex;align-items:center;gap:5px;padding:6px 10px;background:#eef1f5;border-bottom:1px solid #d9dee5;flex-wrap:wrap}
.xp-title{font-weight:600;font-size:13px;margin-right:4px}
.xp-sub{color:#69727d;font-size:12px;margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}
.xp-b{border:1px solid #c9d0d9;background:#fff;border-radius:5px;padding:3px 9px;font-size:12px;cursor:pointer;color:#1e2329;white-space:nowrap}
.xp-b:hover{background:#e6f3fd;border-color:#36b4ff}
.xp-b.on{background:#36b4ff;border-color:#36b4ff;color:#04121c;font-weight:600}
.xp-sep{width:1px;height:20px;background:#cfd5dd;margin:0 3px}
.xp-main{flex:1;display:flex;min-height:0}
.xp-gl{position:relative;flex:1;min-width:0;cursor:grab;touch-action:none;overflow:hidden}
.xp-gl.dragging{cursor:grabbing}
.xp-gl.flat{cursor:crosshair}
.xp-gl canvas{display:block;width:100%;height:100%}
.xp-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.xp-lab{position:absolute;transform:translate(8px,-50%);background:rgba(255,255,255,.92);border:1px solid #c9d0d9;border-radius:4px;padding:1px 6px;font:11px/1.45 'JetBrains Mono',ui-monospace,Consolas,monospace;color:#1e2329;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.12)}
.xp-lab.pin{border-color:#d64545;color:#8c1d1d}
.xp-hint{position:absolute;left:10px;bottom:10px;font-size:11px;color:#56606b;background:rgba(255,255,255,.88);border:1px solid #dde2e8;padding:4px 9px;border-radius:5px;pointer-events:none;line-height:1.5}
.xp-side{width:288px;flex:none;border-left:1px solid #d9dee5;background:#f5f7fa;overflow-y:auto;padding:6px 12px 16px}
.xp-side h5{margin:12px 0 6px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:#56606b}
.xp-read{margin:0;font:12px/1.6 'JetBrains Mono',ui-monospace,Consolas,monospace;white-space:pre-wrap;background:#fff;border:1px solid #dde2e8;border-radius:5px;padding:7px 9px;min-height:54px;color:#1e2329}
.xp-tools label{display:flex;align-items:center;gap:7px;margin:4px 0;cursor:pointer}
.xp-grid{display:grid;grid-template-columns:auto 1fr 1fr;gap:4px 6px;align-items:center}
.xp-grid input{width:100%;box-sizing:border-box;border:1px solid #c9d0d9;border-radius:4px;padding:3px 5px;font:12px 'JetBrains Mono',ui-monospace,monospace;background:#fff;color:#1e2329}
.xp-row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center}
.xp-param{margin:7px 0}
.xp-param .top{display:flex;justify-content:space-between;font:12px 'JetBrains Mono',ui-monospace,monospace}
.xp-param input[type=range]{width:100%;accent-color:#36b4ff}
.xp-param .wb{font-size:11px;padding:1px 6px}
.xp-pins{font:11.5px/1.55 'JetBrains Mono',ui-monospace,monospace;background:#fff;border:1px solid #dde2e8;border-radius:5px;padding:6px 8px;max-height:160px;overflow:auto;white-space:pre-wrap}
.xp-empty{color:#8a939d}
.xp-chip{position:absolute;z-index:6;transform:translate(-100%,0);background:rgba(17,24,32,.78);color:#e8f4ff;border:1px solid #36b4ff;border-radius:5px;padding:2px 8px;font:600 11px Inter,system-ui,sans-serif;cursor:pointer;opacity:.55;transition:opacity .15s;white-space:nowrap}
.xp-chip:hover{opacity:1;background:#36b4ff;color:#04121c}
@media (max-width:860px){.xp-side{width:220px}}
`;
export function injectExplorerCSS() {
  if (document.getElementById('xp-css')) return;
  const st = document.createElement('style'); st.id = 'xp-css'; st.textContent = EXPLORER_CSS; document.head.appendChild(st);
}
