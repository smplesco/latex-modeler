// Vector PDF: the page's SVG export drawn into a PDF with jsPDF + svg2pdf (loaded only when someone exports).
// A deck gives one PDF page per slide.
export async function svgToPDF(pages: { svg: string; w: number; h: number }[]): Promise<Uint8Array> {
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const first = pages[0];
  const doc = new jsPDF({ unit: 'mm', format: [first.w, first.h], orientation: first.w > first.h ? 'landscape' : 'portrait', compress: true });
  // svg2pdf reads styles from the live document, so each page's SVG is attached (off screen) while it's drawn
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: '10px', height: '10px', overflow: 'hidden' });
  document.body.appendChild(host);
  try {
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (i > 0) doc.addPage([p.w, p.h], p.w > p.h ? 'landscape' : 'portrait');
      const el = new DOMParser().parseFromString(p.svg, 'image/svg+xml').documentElement;
      if (el.nodeName !== 'svg') throw new Error('the page could not be drawn');
      host.replaceChildren(el);
      await (doc as any).svg(el, { x: 0, y: 0, width: p.w, height: p.h });
    }
  } finally { host.remove(); }
  doc.setProperties({ creator: 'LaTeX Modeler' });
  return new Uint8Array(doc.output('arraybuffer'));
}
