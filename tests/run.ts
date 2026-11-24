// npm test — runs the auto-modeller over a corpus of LaTeX inputs and executes every generated page.
import { autoModel, MODEL_EXAMPLES } from '../src/model/generate';
import { antiderivative } from '../src/model/antideriv';
import { parseLatex } from '../src/model/latex';
import { compile, tryDiff, freeSyms } from '../src/model/sym';
import { runProgram } from '../src/lang/interp';
import { readFileSync, readdirSync } from 'node:fs';
import { joinInk, splitInk } from '../src/inkfile';

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
  ['F(x) = \\int_0^x \\cos(t^2)\\,dt', 'accum', "F'(x) = f(x)"], ['\\int x e^{-x}\\,dx', 'accum', '-x e^{-x} - e^{-x} + C'], ['\\int_0^1 x e^x\\,dx', 'integral', '= 1'], ['\\int_{-1}^{1} \\frac{1}{x^2}\\,dx', 'integral', 'is wrong here'], ['F(x) = \\int_1^x \\frac{1}{t}\\,dt', 'accum', '= \\ln \\left|x\\right|'], ['\\int_0^1 \\frac{1}{1+x^2}\\,dx', 'integral', 'F(x) = \\arctan x'],
  ['\\lim_{x \\to 0} \\frac{\\sin x}{x}', 'limit', '= 1'], ['\\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n', 'limit', '= e'], ['\\lim_{x \\to 0^+} x \\ln x', 'limit', '= 0'],
  ['\\lim_{x \\to 0} \\frac{|x|}{x}', 'limit', 'does not exist'], ['\\lim_{x \\to \\infty} \\frac{3x^2+1}{x^2-5}', 'limit', '= 3'], ['\\lim_{x \\to 0} \\frac{1}{x^2}', 'limit', '\\infty'],
  ['\\lim_{x \\to 0} \\frac{1 - \\cos x}{x^2}', 'limit', '\\frac{1}{2}'],
  ['\\lim_{x \\to \\infty} \\frac{x^2}{e^x}', 'limit', '\\frac{2}{e^{x}}'], ['\\lim_{x \\to \\infty} \\frac{\\ln x}{x}', 'limit', 'differentiate top and bottom'],
  ['\\prod_{n=1}^{\\infty} \\frac{4n^2}{4n^2-1}', 'product', '\\frac{\\pi}{2}'], ['\\prod_{n=2}^{\\infty} \\left(1 - \\frac{1}{n^2}\\right)', 'product', '= \\frac{1}{2}'], ['\\prod_{n=1}^{\\infty} \\left(1 + \\frac{1}{n}\\right)', 'product', 'grow without bound'],
  ['\\sum_{n=1}^{\\infty} \\left(\\frac{1}{n} - \\frac{1}{n+1}\\right)', 'series', 'inconclusive'], ['\\int_0^{\\pi/2} \\sin^2 x\\,dx', 'integral', 'F(x) = \\frac{x}{2} - \\frac{\\sin 2 x}{4}'], ['\\lim_{x \\to 0} \\frac{\\sin x - x}{x^3}', 'limit', '-\\frac{1}{6}'], ['\\lim_{x \\to 0} \\sin\\frac{1}{x}', 'limit', 'does not exist'],
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
// symbolic integration: every antiderivative must differentiate back to the integrand
const ANTI = ['x^2', '3x^2 - 2x + 5', '\\frac{1}{x}', '\\sqrt{x}', 'x^{-3/2}', 'e^{2x+1}', '2^x', '\\cos(3x)', '\\tan x', '\\sec^2 x', '\\frac{1}{1+x^2}', '\\frac{1}{\\sqrt{1-x^2}}',
  '\\ln x', 'x^5 e^x', 'x^2 \\cos x', 'x \\ln x', 'e^x \\sin x', 'e^{2x}\\cos(3x)', '\\arctan x', '2x\\cos(x^2)', 'x e^{x^2}', '\\frac{x}{x^2+1}', '\\frac{\\ln x}{x}', '\\sin^2 x', '\\sin^3 x',
  '\\sin^2 x \\cos^2 x', '\\cos^4 x', '\\frac{1}{x^2-1}', '\\frac{x+1}{x^2+2x+5}', '\\frac{1}{x^3+1}', '\\frac{x^3}{x^2+1}', '\\sqrt{1-x^2}', '\\sqrt{x^2+1}', '\\frac{1}{\\sqrt{x^2+4}}',
  'x(x^2+1)^3', '\\frac{e^x}{1+e^x}', '\\tan^2 x', 'x\\cosh x', '\\frac{1}{x \\ln x}', 'a x^2 + b'];
for (const src of ANTI) {
  n++;
  const f = parseLatex(src)[0]; const F = antiderivative(f, 'x');
  if (!F) { fail++; console.log(`✗ integral  ${src}: no antiderivative found`); continue; }
  const dF = tryDiff(F, 'x')!; const ps = Object.fromEntries([...freeSyms(f)].filter(v => v !== 'x').map((v, i) => [v, 1.5 + i]));
  const g = compile(f, ['x'], ps), h = compile(dF, ['x'], ps);
  const bad = [0.4, 1.3, 2.2].some(t => isFinite(g(t)) && Math.abs(g(t) - h(t)) > 1e-7 * Math.max(1, Math.abs(g(t))));
  if (bad) { fail++; console.log(`✗ integral  ${src}: derivative does not match`); } else console.log(`✓ integral  ${src}`);
}
for (const src of ['e^{-x^2}', '\\frac{\\sin x}{x}', '\\cos(x^2)']) { n++; if (antiderivative(parseLatex(src)[0], 'x')) { fail++; console.log(`✗ integral  ${src}: claimed an elementary antiderivative`); } else console.log(`✓ no elementary antiderivative: ${src}`); }
// the hand-written examples and templates must run too, at several times
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + '/' + e.name) : e.name.endsWith('.bd') ? [d + '/' + e.name] : []);
for (const f of [...walk('src/examples'), ...walk('src/templates')]) {
  n++;
  try {
    const src = readFileSync(f, 'utf8'); let marks = 0;
    for (const t of [0, 1, 3.7]) marks = runProgram(src, t, { measure: () => 10 }).prims.length;
    if (!/^\/\/ .+ — .+/.test(src.split('\n')[0])) throw Object.assign(new Error('first line must be "// Title — description"'), { line: 1 });
    console.log(`✓ example   ${String(marks).padStart(5)} marks  ${f.replace('src/', '')}`);
  }
  catch (e: any) { fail++; console.log(`✗ example ${f}: line ${e.line}: ${e.message}`); }
}
// ink rides along as a trailing comment line: the page still runs, and it comes back exactly
{
  const check = (name: string, ok: boolean) => { n++; if (!ok) { fail++; console.log('✗ ink       ' + name); } else console.log('✓ ink       ' + name); };
  const code = 'page("A4")\ntex("x^2", (105, 200))\n';
  const ink = [{ tool: 'pen' as const, color: '#e5484d', w: 0.6, pts: [10, 20, NaN, 30.125, 40, 5] }, { tool: 'hl' as const, color: '#ffd400', w: 4.5, pts: [1, 2, NaN] }];
  const file = joinInk(code, ink), back = splitInk(file);
  check('round trip keeps the code', back.code === code);
  check('round trip keeps the strokes', back.ink?.length === 2 && Number.isNaN(back.ink[0].pts[2]) && back.ink[0].pts[3] === 30.13 && back.ink[1].tool === 'hl');
  check('a file with ink still runs', runProgram(file, 0, { measure: () => 10 }).prims.length === runProgram(code, 0, { measure: () => 10 }).prims.length);
  check('no ink: the file is just the code', joinInk(code, []) === code && splitInk(code).code === code && !splitInk(code).ink);
  check('code without a trailing newline', splitInk(joinInk('page("A4")', ink)).code === 'page("A4")\n');
  check('an ink line in the middle is just a comment', splitInk('//@ink []\npage("A4")\n').code === '//@ink []\npage("A4")\n');
  check('broken ink is left as code', splitInk(code + '//@ink [{oops\n').code === code + '//@ink [{oops\n');
  check('bad strokes are dropped', !splitInk(code + '//@ink [{"tool":"pen","color":"red;x","w":1,"pts":[1,2,3]},{"tool":"pen","color":"#000","w":1,"pts":[1,2]}]\n').ink);
}
console.log('\nkinds:', kinds);
console.log(`${n - fail}/${n} passed`);
if (fail) process.exit(1);
