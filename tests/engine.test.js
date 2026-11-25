/* Reproduces reference numbers produced by the original Python research scripts.
 * Run: node tests/engine.test.js
 * Reference data end date is pinned to 2026-11-17 so later data updates don't move the numbers.
 */
const fs = require('fs');
const path = require('path');
const E = require('../web/engine.js');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'prices.json'), 'utf8'));
const END = '2026-11-17';
let failed = 0;

function check(name, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(4)}, want ${want} (±${tol})`);
}
function checkStr(name, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got}, want ${want}`);
}

/* 1) Real ETFs, 1,000,000 start, VOO base, const cap 50%. Python: backtest20.py */
{
  const ds = E.buildReal(raw, { base: 'VOO', start: '2016-11-22', end: END, cashYield: 0 });
  const res = E.run(ds, { capital: 1e6, capMode: 'const', capConst: 0.5 });
  const a = E.analyze(res);
  check('real: final value (万)', a.finalValue / 1e4, 1648, 3);
  check('real: CAGR %', a.cagr * 100, 32.4, 0.15);
  check('real: vol %', a.vol * 100, 38.8, 0.2);
  check('real: Sharpe', a.sharpe, 0.84, 0.01);
  check('real: max drawdown %', a.mdd * 100, -54.4, 0.15);
  checkStr('real: max drawdown date', a.mddDate, '2022-12-28');
  const n = ds.dates.length - 1;
  check('real: QQQ hold final (万)', E.holdSeries(ds, 'QQQ', 1e6, 0, n)[n] / 1e4, 591, 3);
  check('real: QLD hold final (万)', E.holdSeries(ds, 'B2', 1e6, 0, n)[n] / 1e4, 1390, 4);
  const ev = res.events.filter((e) => e.type === 'stage' || e.type === 'recover');
  check('real: number of ladder/recover events', ev.length, 21, 0);
}

/* 2-5) Synthetic scenarios: compare against tests/reference.json, produced by the
 * independent Python implementation (tests/reference.py) on the SAME data/prices.json.
 * Note: results are sensitive to ~1e-6 noise in adjusted closes (a borderline -15% trigger on
 * 2000-04-11 flips and moves the final value ~3%), so never compare against numbers from
 * a different data fetch. Regenerate with: python3 -I tests/reference.py */
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'reference.json'), 'utf8'));
const syn = E.buildSynthetic(raw, { end: END });
function cmp(name, a, r, rel) {
  check(`${name}: final`, a.finalValue / r.final, 1, rel);
  check(`${name}: CAGR %`, a.cagr * 100, r.cagr * 100, 0.01);
  check(`${name}: vol %`, a.vol * 100, r.vol * 100, 0.01);
  check(`${name}: Sharpe`, a.sharpe, r.sharpe, 0.001);
  check(`${name}: max drawdown %`, a.mdd * 100, r.mdd * 100, 0.01);
  checkStr(`${name}: max drawdown date`, a.mddDate, r.mddDate);
  check(`${name}: IRR %`, a.irr * 100, r.irr * 100, 0.01);
  check(`${name}: invested`, a.invested / r.invested, 1, 1e-9);
}
cmp('syn const50', E.analyze(E.run(syn, { capital: 100, capMode: 'const', capConst: 0.5 })), ref.syn_const50, 1e-6);
cmp('syn vol11', E.analyze(E.run(syn, { capital: 100, capMode: 'vol', capK: 0.11, capLo: 0.2, capHi: 0.7 })), ref.syn_vol11, 1e-6);
cmp('syn ext', E.analyze(E.run(syn, { capital: 1e6, capMode: 'const', capConst: 0.5, ext: { thr: [0.35, 0.40, 0.45, 0.50], amt: 0.10, asset: 'base' } })), ref.syn_const50_ext, 1e-6);
const SMULTI = { tqRules: [{ pct: 4, frac: 0.5, baseShare: 1 }, { pct: 8, frac: 0.5, baseShare: 0.5 }], peak: { on: true, frac: 0.5 } };
const base50 = { capital: 100, capMode: 'const', capConst: 0.5 };
cmp('syn sell A', E.analyze(E.run(syn, { ...base50, sells: { tqRules: [{ pct: 4, frac: 0.5, baseShare: 1 }] } })), ref.syn_sells_A, 1e-6);
cmp('syn sells multi', E.analyze(E.run(syn, { ...base50, sells: SMULTI })), ref.syn_sells_multi, 1e-6);
cmp('syn no-recover', E.analyze(E.run(syn, { ...base50, recover: false })), ref.syn_norecover, 1e-6);
cmp('syn no-recover + sells', E.analyze(E.run(syn, { ...base50, sells: SMULTI, recover: false })), ref.syn_norecover_sells, 1e-6);
{
  const r = E.rolling(syn, { capital: 1, capMode: 'const', capConst: 0.5 }, { years: 5, step: 20 });
  const q = ref.rolling_syn_const50;
  check('rolling: windows', r.n, q.n, 0);
  check('rolling: p10', r.p10, q.p10, 1e-6);
  check('rolling: median', r.median, q.median, 1e-6);
  check('rolling: geomean', r.geomean, q.geomean, 1e-6);
  check('rolling: loss share', r.lossShare, q.lossShare, 1e-9);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
