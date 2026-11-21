// Axis tick placement in the classic 1–2–5 style, plus π-multiples for trig plots.

export function niceStep(range: number, count: number) {
  const raw = Math.abs(range) / Math.max(1, count);
  if (!isFinite(raw) || raw <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}

export function fmtTick(v: number, step: number) {
  if (Math.abs(v) < step * 1e-6) return '0';
  const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  let s = v.toFixed(Math.min(8, dec));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  if (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-4 && v !== 0)) {
    const e = Math.floor(Math.log10(Math.abs(v))); const m = v / Math.pow(10, e);
    return `${+m.toFixed(2)}\\times 10^{${e}}`;
  }
  return s;
}

export interface Ticks { vals: number[]; labels: string[]; step: number }

export function niceTicks(a: number, b: number, count = 6): Ticks {
  if (a > b) [a, b] = [b, a];
  const step = niceStep(b - a, count);
  const vals: number[] = [], labels: string[] = [];
  const start = Math.ceil(a / step - 1e-9) * step;
  for (let v = start; v <= b + step * 1e-9; v += step) {
    const vv = Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12);
    vals.push(vv); labels.push(fmtTick(vv, step));
    if (vals.length > 200) break;
  }
  return { vals, labels, step };
}

function piLabel(k: number, d: number) {
  // k·π/d reduced
  if (k === 0) return '0';
  const g = gcd(Math.abs(k), d); k /= g; d /= g;
  const sign = k < 0 ? '-' : ''; const a = Math.abs(k);
  const num = a === 1 ? '\\pi' : `${a}\\pi`;
  return d === 1 ? sign + num : `${sign}\\frac{${num}}{${d}}`;
}
function gcd(a: number, b: number): number { return b ? gcd(b, a % b) : a; }

export function piTicks(a: number, b: number, maxCount = 9): Ticks {
  const cands = [[1, 6], [1, 4], [1, 3], [1, 2], [1, 1], [2, 1], [4, 1], [8, 1], [16, 1]];
  for (const [m, d] of cands) {
    const step = Math.PI * m / d;
    const n = Math.floor((b - a) / step);
    if (n <= maxCount && n >= 2) {
      const vals: number[] = [], labels: string[] = [];
      for (let k = Math.ceil(a / step - 1e-9); k * step <= b + 1e-9; k++) { vals.push(k * step); labels.push(piLabel(k * m, d)); }
      return { vals, labels, step };
    }
  }
  return niceTicks(a, b, maxCount);
}
