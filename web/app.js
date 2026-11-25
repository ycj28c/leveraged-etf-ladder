/* UI glue. All numbers come from engine.js. Not investment advice. */
(function () {
  'use strict';
  // Author credit: put your GitHub username here (leave '' to hide the footer).
  const AUTHOR_GITHUB = 'ycj28c';
  const E = window.Engine;
  const $ = (id) => document.getElementById(id);
  const num = (id) => parseFloat($(id).value);
  const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
  const money = (x) => (Math.abs(x) >= 1e8 ? (x / 1e8).toFixed(2) + '亿' : Math.abs(x) >= 1e4 ? (x / 1e4).toFixed(1) + '万' : x.toFixed(0));
  const cls = (x) => (x < 0 ? 'neg' : 'pos');
  let raw = null;
  function syncMode() {
    const real = $('mode').value === 'real';
    $('cashYield').disabled = !real; $('expense').disabled = real;
    $('modeHint').textContent = real
      ? '真实:用真实 ETF 价格,现金按"现金年化"计息。'
      : '合成:VOO/SPMO 用 SPY 代替(选 QQQ 则用 QQQ),现金用国债收益率。';
  }
  function syncExt() { $('extCap').disabled = $('extAsset').value !== 'tq'; }
  const cashNote = () => ($('mode').value === 'real'
    ? `现金按年化 ${(num('cashYield') * 100).toFixed(2)}% 计息,底仓 ${$('baseSym').value}`
    : `现金按 13 周国债收益率计息,底仓 ${$('baseSym').value === 'QQQ' ? 'QQQ' : 'SPY(代替 VOO/SPMO)'};QLD/TQQQ 为合成`);
  const openState = {};
  const secKey = (d) => d.querySelector('summary').textContent.split('(')[0].trim();
  const sec = (title, body, open) => `<details class="sec"${open ? ' open' : ''}><summary>${title}</summary>${body}</details>`;

  const DEFAULT_STAGE_ROWS = E.DEFAULT_STAGES.map((s) => [s.dd * 100, s.fb * 100, s.fc * 100]);

  function buildStageTable(rows) {
    const tb = $('stageTable').querySelector('tbody');
    tb.innerHTML = '';
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      r.forEach((v) => {
        const td = document.createElement('td');
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = 'any'; inp.min = 0; inp.max = 100; inp.value = +(+v).toFixed(4);
        td.appendChild(inp); tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
  }

  function readStages() {
    const out = [];
    $('stageTable').querySelectorAll('tbody tr').forEach((tr) => {
      const v = [...tr.querySelectorAll('input')].map((i) => parseFloat(i.value));
      if (v.every((x) => isFinite(x))) out.push({ dd: v[0] / 100, fb: v[1] / 100, fc: v[2] / 100, tgt: 'tq' });
    });
    return out.sort((a, b) => a.dd - b.dd);
  }

  function addRuleRow(pct = 400, frac = 50, baseShare = 100) {
    const tb = $('ruleTable').querySelector('tbody');
    const tr = document.createElement('tr');
    [pct, frac, baseShare].forEach((v, k) => {
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.type = 'number'; inp.step = 'any'; inp.min = 0; inp.value = v;
      if (k > 0) inp.max = 100;
      td.appendChild(inp); tr.appendChild(td);
    });
    const td = document.createElement('td');
    const del = document.createElement('button');
    del.type = 'button'; del.textContent = '✕'; del.title = '删除';
    del.onclick = () => { tr.remove(); $('params').dispatchEvent(new Event('change')); };
    td.appendChild(del); tr.appendChild(td); tb.appendChild(tr);
  }

  function readRules() {
    const out = [];
    $('ruleTable').querySelectorAll('tbody tr').forEach((tr) => {
      const v = [...tr.querySelectorAll('input')].map((i) => parseFloat(i.value));
      if (v.every((x) => isFinite(x) && x >= 0) && v[0] > 0) out.push({ pct: v[0] / 100, frac: Math.min(1, v[1] / 100), baseShare: Math.min(1, v[2] / 100) });
    });
    return out;
  }

  function readParams() {
    const w = { tq: num('w_tq') / 100, base: num('w_base') / 100, b2: num('w_b2') / 100, cash: num('w_cash') / 100 };
    const P = {
      capital: num('capital'), weights: w, stages: readStages(),
      capMode: $('capMode').value, capConst: num('capConst') / 100,
      capK: num('capK') / 100, capLo: num('capLo') / 100, capHi: num('capHi') / 100,
      ext: null,
      sells: { tqRules: readRules(), peak: { on: $('sB').checked, frac: num('sB_frac') / 100 } },
      recover: $('recOn').checked,
    };
    if ($('extOn').checked) {
      const thr = $('extThr').value.split(',').map((s) => parseFloat(s) / 100).filter((x) => isFinite(x)).sort((a, b) => a - b);
      P.ext = { thr, amt: num('extAmt') / 100, asset: $('extAsset').value, capped: $('extCap').checked };
    }
    return P;
  }

  // useEnd=false ignores the end date (the "current position" tab always runs to the latest bar).
  function buildDataset(startOverride, useEnd = true) {
    const start = startOverride || $('start').value || null;
    const end = useEnd ? $('end').value || null : null;
    if ($('mode').value === 'real') {
      return E.buildReal(raw, { base: $('baseSym').value, start: start || '2016-11-22', end, cashYield: isFinite(num('cashYield')) ? num('cashYield') : 0 });
    }
    return E.buildSynthetic(raw, { start, end, base: $('baseSym').value, expense: num('expense') });
  }

  function validate(P) {
    const s = P.weights.tq + P.weights.base + P.weights.b2 + P.weights.cash;
    $('wSum').textContent = '(合计 ' + (s * 100).toFixed(1) + '%)';
    if (Math.abs(s - 1) > 1e-6) return '平常仓位合计必须为 100%。';
    if (!P.stages.length) return '至少需要一档阶梯。';
    if (!(P.capital > 0)) return '起始资金必须大于 0。';
    if ([...document.querySelectorAll('#params input[type=number]')].some((i) => parseFloat(i.value) < 0)) return '参数不能为负数。';
    if ($('start').value && $('end').value && $('end').value <= $('start').value) return '结束日期必须晚于起始日期。';
    return null;
  }

  /* ---------- charts ---------- */
  function lineChart(canvas, dates, series, opt) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    const css = getComputedStyle(document.body);
    const fg = css.getPropertyValue('--mut').trim(), line = css.getPropertyValue('--line').trim();
    const L = 58, R = 8, T = 8, B = 22;
    const f = opt.log ? (v) => Math.log(Math.max(v, 1e-9)) : (v) => v;
    let lo = Infinity, hi = -Infinity;
    series.forEach((s) => s.y.forEach((v) => { const t = f(v); if (t < lo) lo = t; if (t > hi) hi = t; }));
    if (opt.zero != null) hi = Math.max(hi, f(opt.zero));
    const pad = (hi - lo) * 0.05 || 1; lo -= pad; hi += opt.zero != null ? 0 : pad;
    if (opt.min != null) lo = opt.min;
    const X = (i) => L + ((W - L - R) * i) / (dates.length - 1);
    const Y = (v) => T + (H - T - B) * (1 - (f(v) - lo) / (hi - lo));
    g.font = '11px sans-serif'; g.fillStyle = fg; g.strokeStyle = line;
    const ticks = 5;
    for (let k = 0; k <= ticks; k++) {
      const tv = lo + ((hi - lo) * k) / ticks, y = T + (H - T - B) * (1 - k / ticks);
      g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
      const val = opt.log ? Math.exp(tv) : tv;
      g.fillText(opt.fmt ? opt.fmt(val) : val.toPrecision(3), 4, y + 4);
    }
    let lastYear = null;
    dates.forEach((d, i) => {
      const y = +d.slice(0, 4);
      if (y !== lastYear && y % (dates.length > 3000 ? 5 : 1) === 0) { g.fillText(y, X(i) - 12, H - 6); }
      lastYear = y;
    });
    series.forEach((s) => {
      g.strokeStyle = s.color; g.lineWidth = s.w || 1.4; g.beginPath();
      const step = Math.max(1, Math.floor(dates.length / (W * 2)));
      for (let i = 0; i < dates.length; i += step) { const x = X(i), y = Y(s.y[i]); if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.lineTo(X(dates.length - 1), Y(s.y[dates.length - 1]));
      g.stroke();
    });
  }
  const legend = (items) => '<div class="legend">' + items.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('') + '</div>';

  /* ---------- backtest ---------- */
  function row(label, cells) { return `<tr><td>${label}</td>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`; }

  function runBacktest() {
    const P = readParams();
    const err = validate(P);
    const out = $('btOut');
    if (err) { out.innerHTML = `<p class="neg">${err}</p>`; return; }
    const ds = buildDataset();
    if (ds.dates.length < 60) { out.innerHTML = '<p class="neg">所选区间数据不足。</p>'; return; }
    const res = E.run(ds, P);
    const a = E.analyze(res);
    const n = res.values.length - 1, dates = res.dates;
    const hold = (k) => E.holdSeries(ds, k, P.capital, 0, n);
    const hs = { QQQ: hold('QQQ'), B2: hold('B2'), TQ: hold('TQ'), BASE: hold('BASE') };
    const baseName = ds.baseName;
    const stat = (v) => { const s = E.perfStats(v, dates); return { ...s, final: v[n], uw: E.longestUnderwater(v, dates) }; };
    const S = { QQQ: stat(hs.QQQ), B2: stat(hs.B2), TQ: stat(hs.TQ), BASE: stat(hs.BASE) };
    const uwTxt = (u) => (u.to ? `${u.days} 交易日` : `${u.days} 交易日(至今未恢复)`);

    const extEv = res.events.filter((e) => e.type === 'ext');
    const extSum = extEv.reduce((t, e) => t + e.amt, 0);
    let qpk = -Infinity, qdd = 0;
    for (let i = 0; i <= n; i++) { qpk = Math.max(qpk, ds.QQQ[i]); qdd = Math.max(qdd, 1 - ds.QQQ[i] / qpk); }
    let ov = `<p class="muted small">${cashNote()}。</p>`;
    if (P.ext && extEv.length) {
      const diverted = extEv.filter((e) => e.toBase > 0), divSum = diverted.reduce((t, e) => t + e.toBase, 0);
      const maxShare = Math.max(...extEv.map((e) => e.hold.tq / e.total));
      let capTxt;
      if (P.ext.asset !== 'tq') capTxt = '买入标的是底仓,"受 TQQQ 上限约束"不适用(要买 TQQQ 请把买入标的改成 TQQQ)。';
      else if (!P.ext.capped) capTxt = '买 TQQQ,未勾选受上限约束,整笔买入。';
      else if (diverted.length) capTxt = `买 TQQQ 且受上限约束:其中 ${diverted.length} 笔触到上限,共 ${money(divSum)} 转买底仓。`;
      else capTxt = `买 TQQQ 且受上限约束:但每笔买入后 TQQQ 占比最高仅 ${(maxShare * 100).toFixed(1)}%,始终低于上限,所以约束没有触发(与不勾选结果相同)。`;
      ov += `<p class="muted small">外部资金已启用:共触发 ${extEv.length} 笔,合计 ${money(extSum)}(起始资金的 ${(extSum / P.capital * 100).toFixed(0)}%),详见操作日志。${capTxt}</p>`;
    } else if (P.ext) {
      ov += `<p class="warn">已启用外部资金,但该区间内 QQQ 最大回撤只有 ${(qdd * 100).toFixed(1)}%,未达到触发阈值 ${(P.ext.thr[0] * 100).toFixed(0)}%,所以没有追加。可把起始日期改早(如合成模式 1999 年),或调低触发回撤。</p>`;
    }
    ov += `<div class="kv"><div>终值<b>${money(a.finalValue)}</b></div><div>年化 CAGR<b>${pct(a.cagr)}</b></div><div>最大回撤<b class="neg">${pct(a.mdd)}</b></div><div>Sharpe<b>${a.sharpe.toFixed(2)}</b></div>${P.ext ? `<div>IRR / MOIC<b>${pct(a.irr)} / ${a.moic.toFixed(1)}x</b></div><div>外部资金<b>${extEv.length} 笔 / ${money(extSum)}</b></div>` : ''}</div>`;
    ov += '<div class="scroll"><table><thead><tr><th></th><th>阶梯策略</th><th>持有 QQQ</th><th>持有 QLD</th><th>持有 TQQQ</th><th>持有 ' + baseName + '</th></tr></thead><tbody>';
    ov += row('终值', [money(a.finalValue), money(S.QQQ.final), money(S.B2.final), money(S.TQ.final), money(S.BASE.final)]);
    if (P.ext) ov += row('累计投入(含外部资金)', [money(a.invested), '-', '-', '-', '-']);
    ov += row('年化 CAGR' + (P.ext ? '(时间加权)' : ''), [pct(a.cagr), pct(S.QQQ.cagr), pct(S.B2.cagr), pct(S.TQ.cagr), pct(S.BASE.cagr)]);
    if (P.ext) ov += row('IRR / MOIC', [`${pct(a.irr)} / ${a.moic.toFixed(1)}x`, '-', '-', '-', '-']);
    ov += row('年化波动', [pct(a.vol), pct(S.QQQ.vol), pct(S.B2.vol), pct(S.TQ.vol), pct(S.BASE.vol)]);
    ov += row('Sharpe(rf=0)', [a.sharpe.toFixed(2), S.QQQ.sharpe.toFixed(2), S.B2.sharpe.toFixed(2), S.TQ.sharpe.toFixed(2), S.BASE.sharpe.toFixed(2)]);
    ov += row('最大回撤', [`${pct(a.mdd)} (${a.mddDate})`, `${pct(S.QQQ.mdd)} (${S.QQQ.mddDate})`, `${pct(S.B2.mdd)} (${S.B2.mddDate})`, `${pct(S.TQ.mdd)} (${S.TQ.mddDate})`, `${pct(S.BASE.mdd)} (${S.BASE.mddDate})`]);
    ov += row('最长回到前高时间', [uwTxt(a.underwater), uwTxt(S.QQQ.uw), uwTxt(S.B2.uw), uwTxt(S.TQ.uw), uwTxt(S.BASE.uw)]);
    ov += '</tbody></table></div>';

    const eqSeries = [
      { name: '阶梯策略', color: '#2358d6', y: res.values, w: 2 },
      { name: 'QQQ', color: '#e08a00', y: hs.QQQ }, { name: 'QLD', color: '#c0392b', y: hs.B2 }, { name: 'TQQQ', color: '#8e44ad', y: hs.TQ }, { name: baseName, color: '#1b8a4b', y: hs.BASE },
    ];
    let ch = '<div class="charts"><div><h3>资产曲线(对数坐标' + (P.ext ? ';策略含外部资金' : '') + ')</h3>' + legend(eqSeries) + '<canvas id="cEq"></canvas></div>';
    const dd = (v) => { let pk = -Infinity; return v.map((x) => { pk = Math.max(pk, x); return x / pk - 1; }); };
    const ddSeries = [
      { name: '阶梯策略', color: '#2358d6', y: dd(a.idx), w: 1.6 }, { name: 'QQQ', color: '#e08a00', y: dd(hs.QQQ) }, { name: 'QLD', color: '#c0392b', y: dd(hs.B2) }, { name: 'TQQQ', color: '#8e44ad', y: dd(hs.TQ) },
    ];
    ch += '<div><h3>回撤' + (P.ext ? '(策略为时间加权)' : '') + '</h3>' + legend(ddSeries) + '<canvas id="cDd"></canvas></div></div>';

    let h = `<h2>${dates[0]} → ${dates[n]}(${a.years.toFixed(1)} 年)</h2>` + sec('概览', ov, true) + sec('资产曲线与回撤', ch, true);
    const ys = E.yearly(a.idx, dates, null), yq = E.yearly(hs.QQQ, dates), y2 = E.yearly(hs.B2, dates), yb = E.yearly(hs.BASE, dates);
    h += '<details class="sec"><summary>按年度收益</summary><div class="scroll"><table><thead><tr><th>年份</th><th>策略</th><th>策略年内最大回撤</th><th>QQQ</th><th>QLD</th><th>' + baseName + '</th></tr></thead><tbody>';
    ys.forEach((r, i) => {
      const c = (x) => `<span class="${cls(x)}">${pct(x)}</span>`;
      h += row(r.year, [c(r.ret), pct(r.mdd), c(yq[i].ret), c(y2[i].ret), c(yb[i].ret)]);
    });
    h += '</tbody></table></div></details>';

    const eps = E.episodes(a.idx, dates, 0.2);
    h += '<details class="sec"><summary>策略回撤 ≥20% 的区间</summary>';
    h += eps.length ? '<div class="scroll"><table><thead><tr><th>前高</th><th>谷底</th><th>深度</th><th>恢复日</th></tr></thead><tbody>' +
      eps.map((e) => row(e.peak, [e.trough, pct(-e.depth), e.recovered || '未恢复'])).join('') + '</tbody></table></div>' : '<p class="muted">无</p>';
    h += '</details>';

    const evs = res.events;
    const hc = (e) => {
      const t = e.total;
      return ['tq', 'base', 'b2', 'qq', 'cash'].map((k) => `${money(e.hold[k] || 0)}<small>${pct((e.hold[k] || 0) / t, 0)}</small>`).concat([`<b>${money(t)}</b>`]);
    };
    h += `<details class="sec"><summary>操作日志(共 ${evs.length} 条${evs.length > 80 ? ',显示最近 80 条' : ''})</summary><div class="scroll"><table class="log"><thead><tr><th>日期</th><th>事件</th><th>QQQ</th><th>详情</th><th>TQQQ</th><th>底仓</th><th>QLD</th><th>QQQ 持仓</th><th>现金</th><th>总值</th></tr></thead><tbody>`;
    evs.slice(-80).forEach((e) => {
      let ev, det;
      if (e.type === 'stage') { ev = `−${(e.th * 100).toFixed(0)}% 档`; det = `卖底仓 ${money(e.sellBase)} + 现金 ${money(e.useCash)} → 买 TQQQ ${money(e.bought)}${e.frac < 1 ? `(上限 ${isFinite(e.cap) ? (e.cap * 100).toFixed(0) : '-'}%,仅执行 ${(e.frac * 100).toFixed(0)}%)` : ''}`; }
      else if (e.type === 'sell') {
        const nm = e.rule === 'peak' ? 'QQQ 回到前高' : `TQQQ 自低点 +${(e.pct * 100).toFixed(0)}%`;
        ev = '减仓'; det = `${nm}:卖 TQQQ ${money(e.sold)} → ${[e.toBase > 0 ? `底仓 ${money(e.toBase)}` : '', e.toQQ > 0 ? `QQQ ${money(e.toQQ)}` : '', e.toCash > 0 ? `现金 ${money(e.toCash)}` : ''].filter(Boolean).join(' + ')}`;
      }
      else if (e.type === 'rearm') { ev = '重置'; det = `QQQ 创新高 ${e.peak.toFixed(2)},重置前高与档位,持仓不变(回补已关闭)`; }
      else if (e.type === 'recover') { ev = '回补'; det = `到达 ${e.line.toFixed(1)},恢复平常仓位`; }
      else { ev = '外部资金'; det = `回撤 ${(e.dd * 100).toFixed(1)}% ≥ ${(e.th * 100).toFixed(0)}%,追加 ${money(e.amt)} → ${e.asset === 'tq' ? (e.toBase > 0 ? `TQQQ ${money(e.toTq)} + 底仓 ${money(e.toBase)}(受上限约束)` : 'TQQQ') : '底仓'}`; }
      h += row(e.date, [ev, e.qqq.toFixed(2), det].concat(hc(e)));
    });
    h += '</tbody></table></div></details>';
    h += sec('滚动 5 年窗口分布', '<div id="rollBox" class="muted">展开后自动计算…</div>', false);
    out.innerHTML = h;

    const drawCharts = () => {
      lineChart($('cEq'), dates, eqSeries, { log: true, fmt: money });
      lineChart($('cDd'), dates, ddSeries, { log: false, fmt: (v) => pct(v, 0), zero: 0, min: -1 });
    };
    let rollStarted = false;
    const computeRolling = () => {
      if (rollStarted) return;
      rollStarted = true;
      const box = $('rollBox');
      box.textContent = '计算中…';
      setTimeout(() => {
        if (ds.dates.length < 252 * 5 + 40) { box.innerHTML = '<p class="muted">数据不足 5 年。</p>'; return; }
        const r = E.rolling(ds, P, { years: 5, step: 20 });
        box.innerHTML = `<p class="muted">每 20 个交易日一个起点,共 ${r.n} 个窗口;起点按当时前高与回撤档位初始化。</p><div class="kv">
          <div>最差<b>${r.worst.toFixed(2)}x</b></div><div>10 分位<b>${r.p10.toFixed(2)}x</b></div><div>中位数<b>${r.median.toFixed(2)}x</b></div>
          <div>均值<b>${r.mean.toFixed(2)}x</b></div><div>几何均值<b>${r.geomean.toFixed(2)}x</b></div><div>最好<b>${r.best.toFixed(2)}x</b></div>
          <div>5 年亏损占比<b>${pct(r.lossShare, 0)}</b></div><div>5 年 ≥3.33x 占比<b>${pct(r.targetShare, 0)}</b></div></div>
          <p class="muted">倍数 = 终值 ÷ (起始资金 + 外部资金)。窗口彼此高度重叠,不是独立样本。</p>`;
      }, 30);
    };
    out.querySelectorAll('details.sec').forEach((d) => {
      const k = secKey(d);
      if (openState[k] !== undefined) d.open = openState[k];
      d.addEventListener('toggle', () => {
        openState[k] = d.open;
        if (!d.open) return;
        if (k === '资产曲线与回撤') drawCharts();
        if (k === '滚动 5 年窗口分布') computeRolling();
      });
      if (d.open && k === '滚动 5 年窗口分布') computeRolling();
    });
    drawCharts();
  }

  /* ---------- current state ---------- */
  function runNow() {
    const P = readParams();
    const err = validate(P);
    const out = $('nowOut');
    if (err) { out.innerHTML = `<p class="neg">${err}</p>`; return; }
    let ds = buildDataset($('mode').value === 'real' ? undefined : '1999-01-01', false);
    const man = parseFloat($('manQ').value);
    let note = '';
    if (isFinite(man) && man > 0) {
      const n = ds.dates.length - 1, r = man / ds.QQQ[n] - 1;
      ds = E.appendBar(ds, { QQQ: man, TQ: ds.TQ[n] * Math.max(1e-9, 1 + 3 * r), B2: ds.B2[n] * Math.max(1e-9, 1 + 2 * r), BASE: ds.BASE[n] * (1 + r) });
      note = `<p class="muted">已追加假设价格 QQQ=${man}(其余标的按 3x/2x/1x 近似,忽略当日融资成本)。</p>`;
    }
    const P2 = { ...P, ext: null };
    const last = ds.dates.length - 1;
    if ($('nowDyn').checked) {
      let pk = -Infinity, pi = 0;
      for (let i = 0; i <= last; i++) if (ds.QQQ[i] >= pk) { pk = ds.QQQ[i]; pi = i; }
      if (pi === 0 || ds.dates[pi] < ds.dates[0]) P2.dynamicStart = true;
      P2.startIndex = pi;
    }
    const actual = ['tq', 'base', 'b2', 'qq', 'cash'].reduce((o, k) => { o[k] = parseFloat($('a_' + k).value) || 0; return o; }, {});
    const curVol = E.trailingVol(ds.vol, ds.vol.dates.length - 1, 252);
    const adv = E.advise(ds, P2, E.total(actual) > 0 ? actual : null);
    const s = adv.state;
    let h = note + `<p class="muted small">${cashNote()}。</p><div class="kv">
      <div>日期<b>${s.date}</b></div><div>QQQ<b>${s.qqq.toFixed(2)}</b></div><div>冻结前高<b>${s.peak.toFixed(2)}</b></div>
      <div>回撤<b class="neg">${pct(-s.dd)}</b></div><div>已触发档数<b>${s.stage}/${P.stages.length}</b></div>
      <div>回补线<b>${adv.recoveryLine ? adv.recoveryLine.toFixed(1) : '-'}</b></div>
      <div>TQQQ 上限<b>${isFinite(s.cap) ? pct(s.cap, 0) : '无'}</b></div>
      <div>QQQ 年化波动(近 252 日)<b>${curVol === null ? '-' : pct(curVol)}</b></div>
      <div>按 K 算的上限(K÷波动)<b>${curVol === null ? '-' : pct(Math.min(P.capHi, Math.max(P.capLo, P.capK / Math.max(0.05, curVol))), 0)}</b></div></div>`;
    h += '<h3>建议</h3><ul class="advice">' + adv.lines.map((l) => `<li>${l}</li>`).join('') + '</ul>';
    h += '<h3>各档触发价</h3><div class="scroll"><table><thead><tr><th>回撤</th><th>QQQ 触发价</th><th>距现价</th><th>状态</th></tr></thead><tbody>' +
      adv.triggers.map((t) => row(`−${(t.dd * 100).toFixed(0)}%`, [t.price.toFixed(2), pct(t.away), t.done ? '已触发' : '未触发'])).join('') + '</tbody></table></div>';
    const w = (o, t) => ['tq', 'base', 'b2', 'qq', 'cash'].map((k) => `${money(o[k] || 0)}(${pct((o[k] || 0) / t)})`).concat([`<b>${money(t)}</b>(100%)`]);
    h += `<h3>${adv.usingActual ? '规则模拟持仓 vs 你的实际持仓' : '规则模拟持仓'}(按 ${$('capital').value} 起始资金推演)</h3><div class="scroll"><table><thead><tr><th></th><th>TQQQ</th><th>底仓</th><th>QLD</th><th>QQQ 持仓</th><th>现金</th><th>合计</th></tr></thead><tbody>` +
      row('规则模拟', w(adv.sim, adv.simTotal)) + (adv.usingActual ? row('实际', w(actual, E.total(actual))) : '') + '</tbody></table></div>';
    h += '<p class="muted">模拟持仓为"从最近前高起按收盘价推演"的结果,与你的真实成交会有偏差(盘中触发、成交价、费用)。仅供参考,不构成投资建议。</p>';
    const recent = adv.events.slice(-8);
    if (recent.length) h += '<h3>推演中的最近操作</h3><ul>' + recent.map((e) => `<li>${e.date} ${e.type === 'stage' ? `−${(e.th * 100).toFixed(0)}% 档,买入 TQQQ ${money(e.bought)}` : e.type === 'recover' ? '回补' : e.type === 'sell' ? '减仓(卖 TQQQ)' : e.type === 'rearm' ? '重置前高(不回补)' : '外部资金'}</li>`).join('') + '</ul>';
    out.innerHTML = h;
  }

  /* ---------- init ---------- */
  function resetDefaults() {
    $('mode').value = 'synthetic'; $('start').value = '1999-03-10'; $('end').value = ''; $('capital').value = 1000000; $('baseSym').value = 'VOO';
    $('cashYield').value = 0.02; $('expense').value = 0.0095;
    $('w_tq').value = 0; $('w_base').value = 70; $('w_b2').value = 15; $('w_cash').value = 15;
    $('capMode').value = 'const'; $('capConst').value = 50; $('capK').value = 11; $('capLo').value = 20; $('capHi').value = 70;
    $('recOn').checked = true; $('sB').checked = false; $('sB_frac').value = 50;
    $('ruleTable').querySelector('tbody').innerHTML = '';
    $('extOn').checked = false; $('extCap').checked = true; $('extThr').value = '35,40,45,50,55,60,65,70,75,80,85'; $('extAmt').value = 10; $('extAsset').value = 'base';
    buildStageTable(DEFAULT_STAGE_ROWS);
    syncMode(); syncExt();
  }

  // Number boxes never accept negatives (typing '-', pasting, or arrow keys); percent boxes cap at 100.
  function guardNumbers() {
    const fix = (i) => {
      const v = parseFloat(i.value);
      if (v < 0) i.value = 0;
      else if (i.max !== '' && v > parseFloat(i.max)) i.value = i.max;
    };
    document.querySelectorAll('input[type=number]').forEach((i) => { i.min = 0; });
    ['sB_frac'].forEach((id) => { $(id).max = 100; });
    document.addEventListener('keydown', (e) => {
      if (e.target.matches && e.target.matches('input[type=number]') && (e.key === '-' || e.key === 'e' || e.key === 'E')) e.preventDefault();
    });
    document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('input[type=number]')) fix(e.target); });
    document.addEventListener('change', (e) => { if (e.target.matches && e.target.matches('input[type=number]')) fix(e.target); }, true);
  }

  function init() {
    resetDefaults();
    guardNumbers();
    document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
      ['bt', 'now', 'about'].forEach((id) => ($(id).hidden = id !== b.dataset.tab));
      if (b.dataset.tab === 'now') runNow(); else if (b.dataset.tab === 'bt') runBacktest();
    }));
    $('extAsset').addEventListener('change', syncExt);
    $('addRule').onclick = () => { addRuleRow(); $('params').dispatchEvent(new Event('change')); };
    $('runBtn').onclick = () => { runBacktest(); };
    let timer = null;
    $('params').addEventListener('change', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!$('now').hidden) runNow(); else if (!$('bt').hidden) runBacktest(); }, 300);
    });
    $('nowBtn').onclick = runNow;
    $('nowResetBtn').onclick = () => {
      $('nowDyn').checked = true; $('manQ').value = '';
      ['tq', 'base', 'b2', 'qq', 'cash'].forEach((k) => { $('a_' + k).value = ''; });
      runNow();
    };
    $('resetBtn').onclick = () => { resetDefaults(); };
    ['w_tq', 'w_base', 'w_b2', 'w_cash'].forEach((id) => $(id).addEventListener('input', () => validate(readParams())));
    validate(readParams());
    $('mode').onchange = () => { syncMode(); $('end').value = ''; $('start').value = $('mode').value === 'real' ? '2016-11-22' : '1999-03-10'; };
  }

  function load() {
    const urls = ['data/prices.json', '../data/prices.json'];
    const attempt = (i) => fetch(urls[i]).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch((e) => { if (i + 1 < urls.length) return attempt(i + 1); throw e; });
    attempt(0).then((j) => {
      raw = j;
      const q = j.series.QQQ;
      $('dataInfo').textContent = `数据:${j.source};更新于 ${j.updated};最新交易日 ${q.d[q.d.length - 1]}。`;
      init();
      runBacktest();
    }).catch((e) => { $('dataInfo').innerHTML = `<span class="neg">加载 data/prices.json 失败(${e.message})。请通过本地 HTTP 服务打开,而不是直接双击 html。</span>`; });
  }
  if (AUTHOR_GITHUB) {
    const f = document.getElementById('author');
    const link = document.createElement('a');
    link.href = 'https://github.com/' + encodeURIComponent(AUTHOR_GITHUB);
    link.textContent = '@' + AUTHOR_GITHUB;
    link.target = '_blank'; link.rel = 'noopener';
    f.append('作者:', link, ' · 仅为个人研究工具,不构成投资建议。');
    f.hidden = false;
  }
  load();
})();
