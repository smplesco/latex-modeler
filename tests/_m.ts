import { autoModel } from '../src/model/generate';
import { runProgram } from '../src/lang/interp';
const cases = ['\\int_0^1 x^2\\,dx', '\\int_0^{\\pi} \\sin x\\,dx', '\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx', '\\int_0^1 \\frac{dx}{\\sqrt{x}}', '\\int_1^{\\infty} \\frac{1}{x}\\,dx',
  '\\int_{-1}^{2} x^3 - x\\,dx', 'F(x) = \\int_0^x \\cos(t^2)\\,dt', '\\int \\frac{1}{1+x^2}\\,dx', '\\int_0^{2\\pi} \\sin^2\\theta\\,d\\theta', '\\int_0^1 a x^2\\,dx',
  '\\lim_{x \\to 0} \\frac{\\sin x}{x}', '\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n', '\\lim_{x \\to 0^+} x \\ln x', '\\lim_{x \\to 0} \\frac{|x|}{x}', '\\lim_{x \\to \\infty} \\frac{3x^2+1}{x^2-5}', '\\lim_{x\\to 0} \\frac{1}{x^2}',
  '\\sum_{n=1}^{\\infty} \\frac{1}{n^2}', '\\sum_{n=1}^{\\infty} \\frac{1}{n}', '\\sum_{n=0}^{\\infty} \\frac{(-1)^n}{2n+1}', '\\sum_{n=0}^{\\infty} \\frac{x^n}{n!}', '\\sum_{n=1}^{\\infty} \\frac{x^n}{n}', '\\sum_{k=0}^{\\infty} \\frac{1}{2^k}'];
for (const c of cases) {
  const r = autoModel(c);
  if (!r.ok) { console.log('FAIL ', c, '→', r.error); continue; }
  let msg = '';
  try { for (const t of [0, 1.5, 4, 7.5]) { const ctx = runProgram(r.code!, t); msg = `${ctx.prims.length} marks`; } } catch (e: any) { msg = 'RUNTIME ' + e.message + (e.line ? ' line ' + e.line + ': ' + r.code!.split('\n')[e.line - 1] : ''); }
  const facts = r.code!.split('\n').filter(l => l.startsWith('eq(')).slice(0, 3).map(l => l.slice(4, l.indexOf('", ')).slice(0, 70)).join(' | ');
  console.log(msg.startsWith('RUN') ? 'ERR  ' : 'ok   ', c.padEnd(46), r.kind?.padEnd(9), msg.padEnd(10), facts);
}
