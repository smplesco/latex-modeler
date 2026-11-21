// npm test — runs the auto-modeller over a corpus of LaTeX inputs and executes every generated page.
import { autoModel, MODEL_EXAMPLES } from '../src/model/generate';
import { runProgram } from '../src/lang/interp';
import { readFileSync, readdirSync } from 'node:fs';

const EXTRA = [
  'y = x^2', 'y = \\tan x', 'y = \\ln x', 'y = \\sqrt{x}', 'y = e^x', 'y = \\frac{1}{x}', 'y = |x - 1| + |x + 1|', 'y = \\lfloor x \\rfloor',
  'f(x) = \\frac{x^2 - 1}{x^2 + 1}', 'y = \\sin^2 x + \\cos 2x', 'y = 2^{-x} \\cos(3x)', 'y = \\arctan x', 'y = x!',
  'z = x^2 + y^2', 'z = \\sin x \\cos y', 'f(x, y) = \\frac{xy}{x^2 + y^2 + 1}', 'z = \\ln(x^2 + y^2)',
  'x^2 - y^2 = 1', 'y^2 = x^3 - x', 'x^2 + xy + y^2 = 3', 'x^4 + y^4 = 1', '\\sin x = \\cos y', 'xy = 1',
  'x^2 + y^2 + z^2 = 4', 'z = x^2 + y^2', 'x^2 + y^2 = z^2', 'x^2 + y^2 = 1', 'x^4 + y^4 + z^4 = 1',
  'r = \\theta', 'r = 2\\sin\\theta', 'r^2 = \\cos 2\\theta', 'r = e^{0.1\\theta}',
  'x = \\cos 3t, \\; y = \\sin 2t', '\\gamma(s) = (s, s^2, s^3)', '(\\cos t, \\sin t)', 'x = t^2, y = t^3',
  '\\mathbf{r}(u, v) = (u \\cos v, u \\sin v, u)', '\\mathbf{r}(u,v) = (\\cos u \\sin v, \\sin u \\sin v, \\cos v)',
  '\\vec F(x, y, z) = (-y, x, z)', '(y, -x)', '\\mathbf{v} = (3, 4)', '\\mathbf{v} = (1, 2, 2)',
  '\\dot x = -x', '\\frac{dy}{dt} = -ty', "y' = \\sin(x y)",
  'R = \\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}', '\\begin{vmatrix} 1 & 2 \\\\ 3 & 4 \\end{vmatrix}',
  'y > x^2', '|x| + |y| < 2', '1 \\le x^2 + y^2 \\le 4',
  '\\frac{22}{7} - \\pi', '\\sqrt{2}', 'E = mc^2', 'A = P\\left(1 + \\frac{r}{n}\\right)^{nt}', 'V = \\frac{4}{3}\\pi r^3',
  'y = a x^2 + b x + c', 'y = \\sin x, \\; x \\in [0, 4\\pi]', 'z = x^2 - y^2, \\; -1 \\le x \\le 1',
  'f(x, y, z) = x^2 + y^2 - z', 'y = \\sum_{k=0}^{6} \\frac{x^k}{k!}', 'y = \\binom{6}{2} x', '\\cos x = x',
  'x^2 + y^2 = 4, \\; x + y = 1, \\; y = 0.5 x^2', 'y = 45^\\circ', 'y = x^{2/3}', 'y = \\sqrt[3]{x}', 'y = \\operatorname{sinc}(x)',
];

let fail = 0, n = 0;
const kinds: Record<string, number> = {};
for (const input of [...MODEL_EXAMPLES.map(e => e.tex), ...EXTRA]) {
  n++;
  const r = autoModel(input);
  if (!r.ok) { console.log(`✗ MODEL  ${input}\n    ${r.error}`); fail++; continue; }
  kinds[r.kind!] = (kinds[r.kind!] || 0) + 1;
  try {
    const t0 = performance.now();
    const ctx = runProgram(r.code!, 2.5, { measure: () => 10 });
    const ms = performance.now() - t0;
    console.log(`✓ ${r.kind!.padEnd(9)} ${String(ctx.prims.length).padStart(5)} marks ${ms.toFixed(0).padStart(5)}ms  ${input}${r.warnings.length ? '   ⚠ ' + r.warnings.join('; ') : ''}`);
  } catch (e: any) {
    fail++;
    console.log(`✗ RUN    ${input}\n    line ${e.line}: ${e.message}`);
    const lines = r.code!.split('\n'); console.log('    > ' + (lines[(e.line || 1) - 1] ?? ''));
  }
}
// inputs that must fail gracefully with a readable message
for (const input of ['e^{i\\pi}', '\\int_0^1 x^2', '\\iint_D x\\,dA', '\\lim x', 'y = ', '\\frac{1}{', 'y = \\foo x', "y'' = -y"]) {
  n++;
  const r = autoModel(input);
  if (r.ok) { fail++; console.log(`✗ expected an error for ${input}`); }
  else console.log(`✓ error     ${input.padEnd(28)} → ${r.error}`);
}
// calculus answers: the page must state the right value (exact form where one is recognised)
const CALC: [string, string, string][] = [
  ['\\int_0^1 x^2\\,dx', 'integral', '\\frac{1}{3}'], ['\\int_0^{\\pi} \\sin x\\,dx', 'integral', '= 2'], ['\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx', 'integral', '\\sqrt{\\pi}'],
  ['\\int_0^1 \\frac{dx}{\\sqrt{x}}', 'integral', '= 2'], ['\\int_1^{\\infty} \\frac{1}{x}\\,dx', 'integral', 'diverges'], ['\\int_{-\\infty}^{\\infty} \\frac{1}{1+x^2}\\,dx', 'integral', '\\pi'],
  ['F(x) = \\int_0^x \\cos(t^2)\\,dt', 'accum', "F'(x) = f(x)"], ['\\int x e^{-x}\\,dx', 'accum', 'F(x) + C'],
  ['\\lim_{x \\to 0} \\frac{\\sin x}{x}', 'limit', '= 1'], ['\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n', 'limit', '= e'], ['\\lim_{x \\to 0^+} x \\ln x', 'limit', '= 0'],
  ['\\lim_{x \\to 0} \\frac{|x|}{x}', 'limit', 'does not exist'], ['\\lim_{x \\to \\infty} \\frac{3x^2+1}{x^2-5}', 'limit', '= 3'], ['\\lim_{x \\to 0} \\frac{1}{x^2}', 'limit', '\\infty'],
  ['\\lim_{x \\to 0} \\frac{1 - \\cos x}{x^2}', 'limit', '\\frac{1}{2}'], ['\\lim_{x \\to 0} \\frac{\\sin x - x}{x^3}', 'limit', '-\\frac{1}{6}'], ['\\lim_{x \\to 0} \\sin\\frac{1}{x}', 'limit', 'does not exist'],
  ['\\sum_{n=1}^{\\infty} \\frac{1}{n^2}', 'series', '\\frac{\\pi^2}{6}'], ['\\sum_{n=1}^{\\infty} \\frac{1}{n}', 'series', 'diverges'], ['\\sum_{n=0}^{\\infty} \\frac{(-1)^n}{2n+1}', 'series', '\\frac{\\pi}{4}'],
  ['\\sum_{n=1}^{\\infty} \\frac{1}{n^4}', 'series', '\\frac{\\pi^4}{90}'], ['\\sum_{n=0}^{\\infty} \\frac{x^n}{n!}', 'series', 'R = \\infty'], ['\\sum_{n=1}^{\\infty} \\frac{x^n}{n}', 'series', 'R = 1'],
];
for (const [input, kind, want] of CALC) {
  n++;
  const r = autoModel(input);
  if (!r.ok) { fail++; console.log(`✗ calculus  ${input}: ${r.error}`); continue; }
  try { for (const t of [0, 2.5, 7.9]) runProgram(r.code!, t, { measure: () => 10 }); } catch (e: any) { fail++; console.log(`✗ calculus  ${input}: line ${e.line}: ${e.message}`); continue; }
  if (r.kind !== kind || !r.code!.includes(want)) { fail++; console.log(`✗ calculus  ${input}: kind ${r.kind}, expected "${want}" on the page`); }
  else console.log(`✓ calculus  ${kind.padEnd(9)} ${input.padEnd(44)} ${want}`);
}
// the hand-written examples must run too
for (const f of readdirSync('src/examples').filter(f => f.endsWith('.bd'))) {
  n++;
  try { const ctx = runProgram(readFileSync('src/examples/' + f, 'utf8'), 1, { measure: () => 10 }); console.log(`✓ example   ${String(ctx.prims.length).padStart(5)} marks  ${f}`); }
  catch (e: any) { fail++; console.log(`✗ example ${f}: line ${e.line}: ${e.message}`); }
}
console.log('\nkinds:', kinds);
console.log(`${n - fail}/${n} passed`);
if (fail) process.exit(1);
