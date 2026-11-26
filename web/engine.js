/* Ladder strategy engine (browser + Node, no dependencies).
 *
 * Holdings keys: tq (TQQQ), base (1x core, e.g. VOO), b2 (QLD), cash.
 * Signal: QQQ close vs a *frozen* prior high. Not investment advice.
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const dayDiff = (a, b) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY;
  const total = (o) => o.tq + o.base + o.b2 + o.cash;
  const scale = (w, k) => ({ tq: w.tq * k, base: w.base * k, b2: w.b2 * k, cash: w.cash * k });
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const DEFAULT_STAGES = [
    { dd: 0.10, fb: 0.10, fc: 0, tgt: 'tq' },
    { dd: 0.15, fb: 1 / 4, fc: 1 / 4, tgt: 'tq' },
    { dd: 0.20, fb: 1 / 3, fc: 1 / 3, tgt: 'tq' },
    { dd: 0.25, fb: 1 / 2, fc: 1 / 2, tgt: 'tq' },
    { dd: 0.30, fb: 1, fc: 1, tgt: 'tq' },
  ];

  const DEFAULT_PARAMS = {
    capital: 1000000,
    weights: { tq: 0, base: 0.70, b2: 0.15, cash: 0.15 },
    // Optional de-risking while in the add-on state; each rule fires at most once per cycle.
    //   tqRules: list of { pct, frac, baseShare }: TQQQ price >= its low since the cycle began x (1+pct)
    //            -> sell `frac` of the current TQQQ position; `baseShare` of the proceeds buys the core, the rest goes to cash
    sells: null, // { tqRules:[{pct:4,frac:.5,baseShare:1}] }
    // Recovery: QQQ >= peak + (peak - trough) -> restore base weights. When false, nothing is rebalanced;
    // the cycle just re-arms (peak/stage reset, holdings kept) once QQQ makes a new high above the frozen peak.
    recover: true,
    stages: DEFAULT_STAGES,
    capMode: 'const', // 'none' | 'const' | 'vol'
    capConst: 0.5,
    capK: 0.11,
    capLo: 0.2,
    capHi: 0.7,
    volWindow: 252,
    ext: null, // { thr:[0.35,...], amt:0.10 (fraction of initial capital), asset:'base'|'tq', capped:bool (tq buys obey the TQQQ cap; excess buys core) }
    dynamicStart: false,
    noEvents: false,
  };

  /* ---------------- data builders ---------------- */

  function toMaps(raw) {
    const maps = {};
    for (const s of Object.keys(raw.series)) {
      const o = {};
      const S = raw.series[s];
      for (let i = 0; i < S.d.length; i++) o[S.d[i]] = S.c[i];
      maps[s] = o;
    }
    return maps;
  }

  function volSeries(raw) {
    return { dates: raw.series.QQQ.d, px: raw.series.QQQ.c };
  }

  /** Real ETFs (VOO/SPMO base, QLD, TQQQ). */
  function buildReal(raw, opts) {
    const o = Object.assign({ base: 'VOO', start: '2016-11-22', end: null, cashYield: 0 }, opts);
    const m = toMaps(raw);
    const syms = ['QQQ', o.base, 'QLD', 'TQQQ'];
    const dates = Object.keys(m.QQQ)
      .filter((d) => syms.every((s) => m[s][d] !== undefined))
      .filter((d) => d >= o.start && (!o.end || d <= o.end))
      .sort();
    const cash = [1];
    for (let i = 1; i < dates.length; i++) cash.push(cash[i - 1] * Math.pow(1 + o.cashYield, 1 / 252));
    return {
      kind: 'real',
      baseName: o.base,
      dates,
      QQQ: dates.map((d) => m.QQQ[d]),
      BASE: dates.map((d) => m[o.base][d]),
      B2: dates.map((d) => m.QLD[d]),
      TQ: dates.map((d) => m.TQQQ[d]),
      CASH: cash,
      vol: volSeries(raw),
    };
  }

  /** Synthetic 2x/3x from QQQ daily returns; base = SPY; cash = T-bill. */
  function buildSynthetic(raw, opts) {
    const o = Object.assign({ start: null, end: null, expense: 0.0095, finSpread: 0, base: 'SPY' }, opts);
    const baseIsQQQ = o.base === 'QQQ'; // core = QQQ itself; anything else = SPY (stands in for VOO/SPMO)
    const m = toMaps(raw);
    let dates = Object.keys(m.QQQ).filter((d) => m.SPY[d] !== undefined).sort();
    dates = dates.filter((d) => (!o.start || d >= o.start) && (!o.end || d <= o.end));
    const rf = [];
    let last = 0.03;
    for (const d of dates) {
      if (m['^IRX'][d] !== undefined) last = m['^IRX'][d] / 100;
      rf.push(last);
    }
    const exp = o.expense / 252;
    const QQQ = [m.QQQ[dates[0]]], BASE = [1], B2 = [1], TQ = [1], CASH = [1];
    // QQQ level is kept as its real adjusted close; others start at 1.
    for (let i = 1; i < dates.length; i++) {
      const a = dates[i - 1], b = dates[i];
      const rq = m.QQQ[b] / m.QQQ[a] - 1;
      const rs = baseIsQQQ ? rq : m.SPY[b] / m.SPY[a] - 1;
      const r = rf[i - 1] / 252;
      const sp = o.finSpread / 252;
      QQQ.push(m.QQQ[b]);
      BASE.push(BASE[i - 1] * (1 + rs));
      TQ.push(TQ[i - 1] * Math.max(1e-9, 1 + 3 * rq - 2 * (r + sp) - exp));
      B2.push(B2[i - 1] * Math.max(1e-9, 1 + 2 * rq - (r + sp) - exp));
      CASH.push(CASH[i - 1] * (1 + r));
    }
    return { kind: 'synthetic', baseName: baseIsQQQ ? 'QQQ' : 'SPY', dates, QQQ, BASE, B2, TQ, CASH, vol: volSeries(raw) };
  }

  /** Append one manual bar (for "what if latest price is X"). Returns a new dataset. */
  function appendBar(ds, bar) {
    const out = Object.assign({}, ds);
    const last = ds.dates[ds.dates.length - 1];
    const d = bar.date || new Date(Date.parse(last + 'T00:00:00Z') + DAY).toISOString().slice(0, 10);
    out.dates = ds.dates.concat([d]);
    out.QQQ = ds.QQQ.concat([bar.QQQ]);
    out.BASE = ds.BASE.concat([bar.BASE]);
    out.B2 = ds.B2.concat([bar.B2]);
    out.TQ = ds.TQ.concat([bar.TQ]);
    out.CASH = ds.CASH.concat([ds.CASH[ds.CASH.length - 1]]);
    return out;
  }

  /* ---------------- helpers ---------------- */

  function lastIndexBefore(dates, iso) {
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] < iso) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  function trailingVol(vs, j, n) {
    const k0 = Math.max(1, j - n + 1);
    const r = [];
    for (let k = k0; k <= j; k++) r.push(vs.px[k] / vs.px[k - 1] - 1);
    if (r.length < 60) return null;
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const v = r.reduce((a, b) => a + (b - m) * (b - m), 0) / (r.length - 1);
    return Math.sqrt(v) * Math.sqrt(252);
  }

  /** Annual cap rule: vol measured at the last close before Jan 1 of that year. */
  function makeCapFn(ds, p) {
    if (p.capMode === 'none') return () => Infinity;
    if (p.capMode === 'const') return () => p.capConst;
    const cache = {};
    return function (date) {
      const y = +date.slice(0, 4);
      if (cache[y] !== undefined) return cache[y];
      const j = lastIndexBefore(ds.vol.dates, y + '-01-01');
      const v = j >= 1 ? trailingVol(ds.vol, j, p.volWindow) : null;
      cache[y] = v === null ? p.capConst : clamp(p.capK / Math.max(0.05, v), p.capLo, p.capHi);
      return cache[y];
    };
  }

  /** Approximate target weights after each stage (used for a mid-drawdown start). */
  function stageTargets(W, stages) {
    const v = Object.assign({}, W);
    const out = [Object.assign({}, W)];
    let prev = 0;
    for (const st of stages) {
      const x = (1 - st.dd) / (1 - prev) - 1;
      prev = st.dd;
      v.tq *= 1 + 3 * x; v.base *= 1 + x; v.b2 *= 1 + 2 * x;
      const m = v.base * st.fb + v.cash * st.fc;
      v.base *= 1 - st.fb; v.cash *= 1 - st.fc; v[st.tgt] += m;
      const s = total(v);
      out.push({ tq: v.tq / s, base: v.base / s, b2: v.b2 / s, cash: v.cash / s });
    }
    return out;
  }

  /* ---------------- engine ---------------- */

  function run(ds, P) {
    const p = Object.assign({}, DEFAULT_PARAMS, P);
    const W = p.weights, st = p.stages, nS = st.length;
    const i0 = p.startIndex || 0;
    const i1 = p.endIndex == null ? ds.dates.length - 1 : p.endIndex;
    const capFn = makeCapFn(ds, p);

    let peak, trough, stage = 0, inc = false, ei = 0, contrib = 0;
    let tqTr = null;
    const SL = p.sells || {}, TR = SL.tqRules || [], firedTq = TR.map(() => false);
    const q0 = ds.QQQ[i0];
    let v;
    if (p.dynamicStart && ds.vol) {
      const j = lastIndexBefore(ds.vol.dates, ds.dates[i0]) + 1; // include start date itself if present
      let jj = j;
      while (jj < ds.vol.dates.length && ds.vol.dates[jj] <= ds.dates[i0]) jj++;
      const upto = jj; // exclusive
      let pk = -Infinity, pkIdx = 0;
      for (let k = 0; k < upto; k++) if (ds.vol.px[k] >= pk) { pk = ds.vol.px[k]; pkIdx = k; }
      let tr = Infinity;
      for (let k = pkIdx; k < upto; k++) tr = Math.min(tr, ds.vol.px[k]);
      peak = Math.max(pk, q0); trough = Math.min(tr, q0);
      const dd0 = 1 - q0 / peak;
      stage = st.filter((s) => dd0 >= s.dd).length;
      inc = stage > 0;
      v = scale(stageTargets(W, st)[stage], p.capital);
      if (inc) tqTr = ds.TQ[i0];
    } else {
      peak = trough = q0;
      v = scale(W, p.capital);
    }

    const values = [total(v)], contribs = [0], events = [];
    const holds = p.trackHold ? [Object.assign({}, v)] : null;
    for (let i = i0 + 1; i <= i1; i++) {
      v.tq *= ds.TQ[i] / ds.TQ[i - 1];
      v.base *= ds.BASE[i] / ds.BASE[i - 1];
      v.b2 *= ds.B2[i] / ds.B2[i - 1];
      v.cash *= ds.CASH[i] / ds.CASH[i - 1];
      const q = ds.QQQ[i], tot = total(v), date = ds.dates[i];

      if (!inc && q > peak) peak = q;
      if (inc) {
        if (q < trough) trough = q;
        if (p.recover !== false && q >= peak + (peak - trough)) {
          const before = Object.assign({}, v);
          v = scale(W, tot); inc = false; stage = 0; trough = q; ei = 0; tqTr = null; firedTq.fill(false);
          if (!p.noEvents) events.push({ type: 'recover', date, qqq: q, peak, line: peak + (peak - trough), before, hold: Object.assign({}, v), total: tot });
        }
      }
      if (inc) {
        if (tqTr === null || ds.TQ[i] < tqTr) tqTr = ds.TQ[i];
        TR.forEach((r, k) => {
          if (firedTq[k] || ds.TQ[i] < tqTr * (1 + r.pct)) return;
          firedTq[k] = true;
          if (!(v.tq > 0)) return;
          const b = clamp(r.baseShare == null ? 1 : r.baseShare, 0, 1);
          const sold = v.tq * clamp(r.frac, 0, 1), toBase = sold * b, toCash = sold - toBase;
          v.tq -= sold; v.base += toBase; v.cash += toCash;
          if (!p.noEvents) events.push({ type: 'sell', rule: 'tq', idx: k, pct: r.pct, date, qqq: q, sold, toBase, toCash, hold: Object.assign({}, v), total: total(v) });
        });
        if (p.recover === false && q >= peak) {
          // no recovery: re-arm the ladder on a new high, keep holdings as they are
          if (!p.noEvents) events.push({ type: 'rearm', date, qqq: q, peak, hold: Object.assign({}, v), total: total(v) });
          inc = false; stage = 0; peak = q; trough = q; ei = 0; tqTr = null; firedTq.fill(false);
        }
      }
      const dd = 1 - q / peak;

      if (p.ext && inc) {
        while (ei < p.ext.thr.length && dd >= p.ext.thr[ei]) {
          const amt = p.ext.amt * p.capital;
          const asset = p.ext.asset === 'tq' ? 'tq' : 'base';
          let toTq = 0;
          if (asset === 'tq') {
            if (p.ext.capped) {
              // same rule as the ladder: allowed = cap x (total after the new money) - current TQQQ; the rest buys core
              const capV = capFn(date);
              toTq = isFinite(capV) ? Math.min(amt, Math.max(0, capV * (total(v) + amt) - v.tq)) : amt;
            } else toTq = amt;
          }
          v.tq += toTq; v.base += amt - toTq; contrib += amt; ei++;
          if (!p.noEvents) events.push({ type: 'ext', date, qqq: q, dd, th: p.ext.thr[ei - 1], amt, asset, toTq, toBase: amt - toTq, hold: Object.assign({}, v), total: total(v) });
        }
      }

      while (stage < nS && dd >= st[stage].dd) {
        const s = st[stage];
        if (!inc) { inc = true; trough = q; tqTr = ds.TQ[i]; }
        const moved = v.base * s.fb + v.cash * s.fc;
        let f = 1;
        const capV = capFn(date);
        if (s.tgt !== 'base' && moved > 0 && isFinite(capV)) f = Math.min(1, Math.max(0, capV * tot - v[s.tgt]) / moved);
        const sellBase = v.base * s.fb * f, useCash = v.cash * s.fc * f;
        v.base -= sellBase; v.cash -= useCash; v[s.tgt] += moved * f;
        if (!p.noEvents) events.push({ type: 'stage', date, qqq: q, dd, th: s.dd, sellBase, useCash, bought: moved * f, planned: moved, frac: f, cap: capV, tgt: s.tgt, hold: Object.assign({}, v), total: total(v) });
        stage++;
      }
      values.push(total(v)); contribs.push(contrib);
      if (holds) holds.push(Object.assign({}, v));
    }
    return {
      dates: ds.dates.slice(i0, i1 + 1), values, contribs, events, holds,
      final: { holdings: v, stage, inc, peak, trough, tqTrough: tqTr, tqNow: ds.TQ[i1], firedTq: firedTq.slice(), extDone: ei, qqq: ds.QQQ[i1], date: ds.dates[i1], cap: capFn(ds.dates[i1]) },
      params: p,
    };
  }

  /* ---------------- analytics ---------------- */

  /** Index with external cash flows removed (time-weighted). */
  function twrIndex(res) {
    const idx = [1];
    for (let i = 1; i < res.values.length; i++) {
      const fl = res.contribs[i] - res.contribs[i - 1];
      idx.push(idx[i - 1] * (1 + (res.values[i] - fl) / res.values[i - 1] - 1));
    }
    return idx;
  }

  function perfStats(idx, dates) {
    const yrs = dayDiff(dates[0], dates[dates.length - 1]) / 365.25;
    const last = idx[idx.length - 1] / idx[0];
    const cagr = last > 0 ? Math.pow(last, 1 / yrs) - 1 : -1;
    const r = [];
    for (let i = 1; i < idx.length; i++) r.push(idx[i] / idx[i - 1] - 1);
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) * (b - m), 0) / (r.length - 1)) * Math.sqrt(252);
    let pk = idx[0], mdd = 0, mddDate = dates[0];
    for (let i = 0; i < idx.length; i++) {
      pk = Math.max(pk, idx[i]);
      if (idx[i] / pk - 1 < mdd) { mdd = idx[i] / pk - 1; mddDate = dates[i]; }
    }
    return { cagr, vol: sd, sharpe: cagr / sd, mdd, mddDate, years: yrs };
  }

  function longestUnderwater(idx, dates) {
    let pk = idx[0], st = 0, best = { days: 0, from: null, to: null };
    for (let i = 0; i < idx.length; i++) {
      if (idx[i] >= pk) {
        if (i - st > best.days) best = { days: i - st, from: dates[st], to: dates[i] };
        pk = idx[i]; st = i;
      }
    }
    if (idx.length - 1 - st > best.days) best = { days: idx.length - 1 - st, from: dates[st], to: null };
    return best;
  }

  function episodes(idx, dates, minDepth) {
    const out = [];
    let pk = idx[0], pi = 0, tr = idx[0], ti = 0, open = false;
    for (let i = 0; i < idx.length; i++) {
      const x = idx[i];
      if (x >= pk) {
        if (open && 1 - tr / pk >= minDepth) out.push({ peak: dates[pi], trough: dates[ti], depth: 1 - tr / pk, recovered: dates[i] });
        pk = x; pi = i; tr = x; ti = i; open = false;
      } else {
        open = true;
        if (x < tr) { tr = x; ti = i; }
      }
    }
    if (open && 1 - tr / pk >= minDepth) out.push({ peak: dates[pi], trough: dates[ti], depth: 1 - tr / pk, recovered: null });
    return out;
  }

  function yearly(idx, dates, values) {
    const years = [...new Set(dates.map((d) => +d.slice(0, 4)))].sort();
    return years.map((y) => {
      const ids = [];
      dates.forEach((d, i) => { if (+d.slice(0, 4) === y) ids.push(i); });
      const a = ids[0] > 0 ? ids[0] - 1 : 0, b = ids[ids.length - 1];
      let pk = idx[a], mdd = 0;
      for (let i = a; i <= b; i++) { pk = Math.max(pk, idx[i]); mdd = Math.min(mdd, idx[i] / pk - 1); }
      return { year: y, ret: idx[b] / idx[a] - 1, mdd, endValue: values ? values[b] : null };
    });
  }

  function irr(flows, endValue, d0, d1) {
    const f = (r) => {
      let t = 0;
      for (const [d, a] of flows) t -= a / Math.pow(1 + r, dayDiff(d0, d) / 365.25);
      return t + endValue / Math.pow(1 + r, dayDiff(d0, d1) / 365.25);
    };
    let lo = -0.99, hi = 3.0;
    for (let k = 0; k < 100; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  /** Full analysis of a run (handles external cash flows). */
  function analyze(res) {
    const idx = twrIndex(res);
    const ps = perfStats(idx, res.dates);
    const n = res.values.length - 1;
    const invested = res.params.capital + res.contribs[n];
    const flows = [[res.dates[0], res.params.capital]];
    for (let i = 1; i <= n; i++) {
      const fl = res.contribs[i] - res.contribs[i - 1];
      if (fl > 0) flows.push([res.dates[i], fl]);
    }
    const mwr = irr(flows, res.values[n], res.dates[0], res.dates[n]);
    let minRatio = Infinity;
    for (let i = 0; i <= n; i++) minRatio = Math.min(minRatio, res.values[i] / (res.params.capital + res.contribs[i]));
    return Object.assign({}, ps, {
      idx, finalValue: res.values[n], invested, moic: res.values[n] / invested, irr: mwr, minRatio,
      underwater: longestUnderwater(idx, res.dates),
    });
  }

  function holdSeries(ds, key, capital, i0, i1) {
    const a = ds[key];
    const out = [];
    for (let i = i0; i <= i1; i++) out.push((capital * a[i]) / a[i0]);
    return out;
  }

  /** Rolling N-year windows (every `step` bars). Returns multiples = final/(capital+contrib). */
  function rolling(ds, P, o) {
    const opt = Object.assign({ years: 5, step: 20, target: 10 / 3 }, o);
    const H = Math.round(252 * opt.years), last = ds.dates.length - 1;
    const m = [];
    for (let i0 = 0; i0 < last - H; i0 += opt.step) {
      const r = run(ds, Object.assign({}, P, { startIndex: i0, endIndex: i0 + H, dynamicStart: true, noEvents: true }));
      const n = r.values.length - 1;
      m.push(Math.max(1e-6, r.values[n] / (r.params.capital + r.contribs[n])));
    }
    m.sort((a, b) => a - b);
    const q = (x) => m[Math.min(m.length - 1, Math.floor(m.length * x))];
    return {
      n: m.length, p10: q(0.1), median: q(0.5),
      mean: m.reduce((a, b) => a + b, 0) / m.length,
      geomean: Math.exp(m.reduce((a, b) => a + Math.log(b), 0) / m.length),
      lossShare: m.filter((x) => x < 1).length / m.length,
      targetShare: m.filter((x) => x >= opt.target).length / m.length,
      worst: m[0], best: m[m.length - 1],
    };
  }

  /* ---------------- current-state advisor ---------------- */

  function advise(ds, P, actual) {
    const res = run(ds, P);
    const p = res.params, f = res.final, W = p.weights;
    const peak = f.peak, q = f.qqq, dd = 1 - q / peak;
    const stages = p.stages;
    const done = f.stage;
    const sim = f.holdings, simTotal = total(sim);
    const pct = (o, t) => ({ tq: o.tq / t, base: o.base / t, b2: o.b2 / t, cash: o.cash / t });
    const lines = [];
    const out = { state: { qqq: q, peak, trough: f.trough, dd, stage: done, inRecovery: f.inc, cap: f.cap, date: f.date }, sim, simTotal, events: res.events };
    out.recoveryLine = f.inc && p.recover !== false ? peak + (peak - f.trough) : null;
    out.triggers = stages.map((s, k) => ({ dd: s.dd, price: peak * (1 - s.dd), done: k < done, away: q / (peak * (1 - s.dd)) - 1 }));

    // working holdings: actual if provided, else simulated
    const useActual = actual && total(actual) > 0;
    const hold = useActual ? actual : sim, holdTotal = total(hold);
    out.usingActual = !!useActual;
    out.compare = useActual ? { simWeights: pct(sim, simTotal), actWeights: pct(actual, holdTotal) } : null;

    if (!f.inc) {
      lines.push(`QQQ 距前高 ${(dd * 100).toFixed(1)}%,未进入加仓状态:保持平常仓位 TQQQ ${(W.tq * 100).toFixed(0)}% / 底仓 ${(W.base * 100).toFixed(0)}% / QLD ${(W.b2 * 100).toFixed(0)}% / 现金 ${(W.cash * 100).toFixed(0)}%。第一档触发价 ${(peak * (1 - stages[0].dd)).toFixed(2)}。`);
    } else {
      lines.push(`QQQ ${q.toFixed(2)},冻结前高 ${peak.toFixed(2)},回撤 ${(dd * 100).toFixed(1)}%,已触发到 -${stages[Math.max(0, done - 1)] ? (stages[done - 1].dd * 100).toFixed(0) : 0}% 档(共 ${done} 档)。`);
      lines.push(p.recover === false
        ? `回补已关闭:QQQ 创新高(≥ ${peak.toFixed(2)})时只重置前高与档位,不调整现有持仓。`
        : `回补线 ${out.recoveryLine.toFixed(1)}(= 前高 + (前高 − 谷底 ${f.trough.toFixed(2)}));到价后一次性恢复平常仓位。回补前不更新前高、不重复买已用过的档位。`);
    }
    if (done < stages.length) {
      const s = stages[done];
      const trig = peak * (1 - s.dd);
      let sellBase = hold.base * s.fb, useCash = hold.cash * s.fc;
      let moved = sellBase + useCash, frac = 1;
      const capV = f.cap;
      if (s.tgt !== 'base' && isFinite(capV) && moved > 0) {
        frac = Math.min(1, Math.max(0, capV * holdTotal - hold[s.tgt]) / moved);
        sellBase *= frac; useCash *= frac; moved *= frac;
      }
      out.next = { dd: s.dd, price: trig, away: q / trig - 1, sellBase, useCash, bought: moved, frac, capV };
      lines.push(`下一档 -${(s.dd * 100).toFixed(0)}%:QQQ ≤ ${trig.toFixed(1)}(距现价 ${((q / trig - 1) * 100).toFixed(1)}%)。按${useActual ? '你的实际持仓' : '规则模拟持仓'},届时卖底仓约 ${sellBase.toFixed(0)}、动用现金约 ${useCash.toFixed(0)},买入 ${s.tgt === 'tq' ? 'TQQQ' : 'QLD'} 约 ${moved.toFixed(0)}${frac < 1 ? `(受 ${(capV * 100).toFixed(0)}% 上限约束,只执行计划的 ${(frac * 100).toFixed(0)}%)` : ''}。`);
    } else {
      lines.push('五档均已触发,不再有阶梯买入;等待回补线(或外部资金,如已设置)。');
    }
    const SL = p.sells || {};
    if (f.inc && f.tqTrough) {
      const gain = f.tqNow / f.tqTrough - 1;
      (SL.tqRules || []).forEach((r, k) => {
        const bs = r.baseShare == null ? 1 : r.baseShare;
        lines.push(`减仓规则 ${k + 1}:TQQQ 自本轮低点已涨 ${(gain * 100).toFixed(0)}%,涨到 +${(r.pct * 100).toFixed(0)}% 时卖出当前 ${(r.frac * 100).toFixed(0)}% 的 TQQQ,其中 ${(bs * 100).toFixed(0)}% 换底仓${bs < 1 ? `、其余 ${((1 - bs) * 100).toFixed(0)}% 换现金` : ''}${f.firedTq[k] ? '(已执行)' : ''}。`);
      });
    }
    if (isFinite(f.cap)) {
      const tqShare = hold.tq / holdTotal;
      lines.push(`当前 TQQQ 上限 ${(f.cap * 100).toFixed(0)}%(总资产),现有占比 ${(tqShare * 100).toFixed(1)}%。上限只在买入时检查,TQQQ 上涨后占比可能超过上限,系统不会强制卖出。`);
    }
    if (useActual) {
      const a = out.compare.actWeights, s = out.compare.simWeights;
      const diffs = [['TQQQ', 'tq'], ['底仓', 'base'], ['QLD', 'b2'], ['现金', 'cash']]
        .map(([n, k]) => ({ n, d: a[k] - s[k] })).filter((x) => Math.abs(x.d) >= 0.03);
      lines.push(diffs.length
        ? '与规则模拟持仓相比,偏差 ≥3 个百分点:' + diffs.map((x) => `${x.n} ${x.d > 0 ? '+' : ''}${(x.d * 100).toFixed(1)}pp`).join(',') + '。'
        : '你的实际持仓与规则模拟持仓基本一致(偏差均 <3 个百分点)。');
    }
    out.lines = lines;
    return out;
  }

  const Engine = {
    DEFAULT_PARAMS, DEFAULT_STAGES,
    buildReal, buildSynthetic, appendBar,
    run, analyze, perfStats, twrIndex, longestUnderwater, episodes, yearly, holdSeries, rolling, advise,
    lastIndexBefore, trailingVol, stageTargets, total,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof self !== 'undefined' ? self : this);
