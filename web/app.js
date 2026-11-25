/* UI glue. All numbers come from engine.js. Not investment advice. */
(function () {
  'use strict';
  const E = window.Engine;
  const $ = (id) => document.getElementById(id);
  const num = (id) => parseFloat($(id).value);
  const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
  const money = (x) => (Math.abs(x) >= 1e8 ? (x / 1e8).toFixed(2) + '亿' : Math.abs(x) >= 1e4 ? (x / 1e4).toFixed(1) + '万' : x.toFixed(0));
  const cls = (x) => (x < 0 ? 'neg' : 'pos');
  let raw = null;

  const DEFAULT_STAGE_ROWS = E.DEFAULT_STAGES.map((s) => [s.dd * 100, s.fb * 100, s.fc * 100]);

  function buildStageTable(rows) {
    const tb = $('stageTable').querySelector('tbody');
    tb.innerHTML = '';
    rows.forEach((r) => {
      const tr = document.createElement('tr');
      r.forEach((v) => {
        const td = document.createElement('td');
        const inp = document.createElement('input');
        inp.type = 'number'; inp.step = 'any'; inp.value = +(+v).toFixed(4);
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

  function readParams() {
    const w = { tq: num('w_tq') / 100, base: num('w_base') / 100, b2: num('w_b2') / 100, cash: num('w_cash') / 100 };
    const P = {
      capital: num('capital'), weights: w, stages: readStages(),
      capMode: $('capMode').value, capConst: num('capConst') / 100,
      capK: num('capK') / 100, capLo: num('capLo') / 100, capHi: num('capHi') / 100,
      ext: null,
    };
    if ($('extOn').checked) {
      const thr = $('extThr').value.split(',').map((s) => parseFloat(s) / 100).filter((x) => isFinite(x)).sort((a, b) => a - b);
      P.ext = { thr, amt: num('extAmt') / 100, asset: $('extAsset').value };
    }
    return P;
  }

  function buildDataset(startOverride) {
    const start = startOverride || $('start').value || null;
    if ($('mode').value === 'real') {
      return E.buildReal(raw, { base: $('baseSym').value, start: start || '2016-11-22', cashYield: num('cashYield') || 0 });
    }
    return E.buildSynthetic(raw, { start, expense: num('expense') });
  }

  function validate(P) {
    const s = P.weights.tq + P.weights.base + P.weights.b2 + P.weights.cash;
    $('wSum').textContent = '(合计 ' + (s * 100).toFixed(1) + '%)';
    if (Math.abs(s - 1) > 1e-6) return '平常仓位合计必须为 100%。';
    if (!P.stages.length) return '至少需要一档阶梯。';
    if (!(P.capital > 0)) return '起始资金必须大于 0。';
    return null;
  }

  /* ---------- charts ---------- */
  function lineChart(canvas, dates, series, opt) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
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
    const hs = { QQQ: hold('QQQ'), B2: hold('B2'), BASE: hold('BASE') };
    const baseName = ds.baseName;
    const stat = (v) => { const s = E.perfStats(v, dates); return { ...s, final: v[n], uw: E.longestUnderwater(v, dates) }; };
    const S = { QQQ: stat(hs.QQQ), B2: stat(hs.B2), BASE: stat(hs.BASE) };
    const uwTxt = (u) => (u.to ? `${u.days} 交易日` : `${u.days} 交易日(至今未恢复)`);

    let h = `<h2>${dates[0]} → ${dates[n]}(${a.years.toFixed(1)} 年)</h2>`;
    h += `<div class="kv"><div>终值<b>${money(a.finalValue)}</b></div><div>年化 CAGR<b>${pct(a.cagr)}</b></div><div>最大回撤<b class="neg">${pct(a.mdd)}</b></div><div>Sharpe<b>${a.sharpe.toFixed(2)}</b></div>${P.ext ? `<div>IRR / MOIC<b>${pct(a.irr)} / ${a.moic.toFixed(1)}x</b></div>` : ''}</div>`;
    h += '<div class="scroll"><table><thead><tr><th></th><th>阶梯策略</th><th>持有 QQQ</th><th>持有 QLD</th><th>持有 ' + baseName + '</th></tr></thead><tbody>';
    h += row('终值', [money(a.finalValue), money(S.QQQ.final), money(S.B2.final), money(S.BASE.final)]);
    if (P.ext) h += row('累计投入(含外部资金)', [money(a.invested), '-', '-', '-']);
    h += row('年化 CAGR' + (P.ext ? '(时间加权)' : ''), [pct(a.cagr), pct(S.QQQ.cagr), pct(S.B2.cagr), pct(S.BASE.cagr)]);
    if (P.ext) h += row('IRR / MOIC', [`${pct(a.irr)} / ${a.moic.toFixed(1)}x`, '-', '-', '-']);
    h += row('年化波动', [pct(a.vol), pct(S.QQQ.vol), pct(S.B2.vol), pct(S.BASE.vol)]);
    h += row('Sharpe(rf=0)', [a.sharpe.toFixed(2), S.QQQ.sharpe.toFixed(2), S.B2.sharpe.toFixed(2), S.BASE.sharpe.toFixed(2)]);
    h += row('最大回撤', [`${pct(a.mdd)} (${a.mddDate})`, `${pct(S.QQQ.mdd)} (${S.QQQ.mddDate})`, `${pct(S.B2.mdd)} (${S.B2.mddDate})`, `${pct(S.BASE.mdd)} (${S.BASE.mddDate})`]);
    h += row('最长回到前高时间', [uwTxt(a.underwater), uwTxt(S.QQQ.uw), uwTxt(S.B2.uw), uwTxt(S.BASE.uw)]);
    h += '</tbody></table></div>';

    const eqSeries = [
      { name: '阶梯策略', color: '#2358d6', y: res.values, w: 2 },
      { name: 'QQQ', color: '#e08a00', y: hs.QQQ }, { name: 'QLD', color: '#c0392b', y: hs.B2 }, { name: baseName, color: '#1b8a4b', y: hs.BASE },
    ];
    h += '<div class="charts"><div><h3>资产曲线(对数坐标' + (P.ext ? ';策略含外部资金' : '') + ')</h3>' + legend(eqSeries) + '<canvas id="cEq"></canvas></div>';
    const dd = (v) => { let pk = -Infinity; return v.map((x) => { pk = Math.max(pk, x); return x / pk - 1; }); };
    const ddSeries = [
      { name: '阶梯策略', color: '#2358d6', y: dd(a.idx), w: 1.6 }, { name: 'QQQ', color: '#e08a00', y: dd(hs.QQQ) }, { name: 'QLD', color: '#c0392b', y: dd(hs.B2) },
    ];
    h += '<div><h3>回撤' + (P.ext ? '(策略为时间加权)' : '') + '</h3>' + legend(ddSeries) + '<canvas id="cDd"></canvas></div></div>';

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
    h += `<details class="sec"><summary>操作日志(共 ${evs.length} 条${evs.length > 80 ? ',显示最近 80 条' : ''})</summary><div class="scroll"><table><thead><tr><th>日期</th><th>事件</th><th>QQQ</th><th>详情</th></tr></thead><tbody>`;
    evs.slice(-80).forEach((e) => {
      if (e.type === 'stage') h += row(e.date, [`−${(e.th * 100).toFixed(0)}% 档`, e.qqq.toFixed(2), `卖底仓 ${money(e.sellBase)} + 现金 ${money(e.useCash)} → 买 TQQQ ${money(e.bought)}${e.frac < 1 ? `(上限 ${isFinite(e.cap) ? (e.cap * 100).toFixed(0) : '-'}%,仅执行 ${(e.frac * 100).toFixed(0)}%)` : ''}`]);
      else if (e.type === 'recover') h += row(e.date, ['回补', e.qqq.toFixed(2), `到达 ${e.line.toFixed(1)},恢复平常仓位,总资产 ${money(e.total)}`]);
      else h += row(e.date, ['外部资金', e.qqq.toFixed(2), `回撤 ${(e.dd * 100).toFixed(1)}% ≥ ${(e.th * 100).toFixed(0)}%,追加 ${money(e.amt)} → ${e.asset === 'tq' ? 'TQQQ' : '底仓'}`]);
    });
    h += '</tbody></table></div></details>';
    h += '<details class="sec"><summary>滚动 5 年窗口分布</summary><div id="rollBox"><button id="rollBtn">计算(约几秒)</button></div></details>';
    out.innerHTML = h;

    lineChart($('cEq'), dates, eqSeries, { log: true, fmt: money });
    lineChart($('cDd'), dates, ddSeries, { log: false, fmt: (v) => pct(v, 0), zero: 0, min: -1 });
    $('rollBtn').onclick = () => {
      $('rollBox').innerHTML = '计算中…';
      setTimeout(() => {
        if (ds.dates.length < 252 * 5 + 40) { $('rollBox').innerHTML = '<p class="muted">数据不足 5 年。</p>'; return; }
        const r = E.rolling(ds, P, { years: 5, step: 20 });
        $('rollBox').innerHTML = `<h3>滚动 5 年窗口(每 20 个交易日一个起点,共 ${r.n} 个;起点按当时前高与回撤档位初始化)</h3><div class="kv">
          <div>最差<b>${r.worst.toFixed(2)}x</b></div><div>10 分位<b>${r.p10.toFixed(2)}x</b></div><div>中位数<b>${r.median.toFixed(2)}x</b></div>
          <div>均值<b>${r.mean.toFixed(2)}x</b></div><div>几何均值<b>${r.geomean.toFixed(2)}x</b></div><div>最好<b>${r.best.toFixed(2)}x</b></div>
          <div>5 年亏损占比<b>${pct(r.lossShare, 0)}</b></div><div>5 年 ≥3.33x 占比<b>${pct(r.targetShare, 0)}</b></div></div>
          <p class="muted">倍数 = 终值 ÷ (起始资金 + 外部资金)。窗口彼此高度重叠,不是独立样本。</p>`;
      }, 30);
    };
  }

  /* ---------- current state ---------- */
  function runNow() {
    const P = readParams();
    const err = validate(P);
    const out = $('nowOut');
    if (err) { out.innerHTML = `<p class="neg">${err}</p>`; return; }
    let ds = buildDataset($('mode').value === 'real' ? undefined : '1999-01-01');
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
    const actual = ['tq', 'base', 'b2', 'cash'].reduce((o, k) => { o[k] = parseFloat($('a_' + k).value) || 0; return o; }, {});
    const adv = E.advise(ds, P2, E.total(actual) > 0 ? actual : null);
    const s = adv.state;
    let h = note + `<div class="kv">
      <div>日期<b>${s.date}</b></div><div>QQQ<b>${s.qqq.toFixed(2)}</b></div><div>冻结前高<b>${s.peak.toFixed(2)}</b></div>
      <div>回撤<b class="neg">${pct(-s.dd)}</b></div><div>已触发档数<b>${s.stage}/${P.stages.length}</b></div>
      <div>回补线<b>${adv.recoveryLine ? adv.recoveryLine.toFixed(1) : '-'}</b></div>
      <div>TQQQ 上限<b>${isFinite(s.cap) ? pct(s.cap, 0) : '无'}</b></div></div>`;
    h += '<h3>建议</h3><ul class="advice">' + adv.lines.map((l) => `<li>${l}</li>`).join('') + '</ul>';
    h += '<h3>各档触发价</h3><div class="scroll"><table><thead><tr><th>回撤</th><th>QQQ 触发价</th><th>距现价</th><th>状态</th></tr></thead><tbody>' +
      adv.triggers.map((t) => row(`−${(t.dd * 100).toFixed(0)}%`, [t.price.toFixed(2), pct(t.away), t.done ? '已触发' : '未触发'])).join('') + '</tbody></table></div>';
    const w = (o, t) => ['tq', 'base', 'b2', 'cash'].map((k) => `${money(o[k])}(${pct(o[k] / t)})`);
    h += `<h3>${adv.usingActual ? '规则模拟持仓 vs 你的实际持仓' : '规则模拟持仓'}(按 ${$('capital').value} 起始资金推演)</h3><div class="scroll"><table><thead><tr><th></th><th>TQQQ</th><th>底仓</th><th>QLD</th><th>现金</th></tr></thead><tbody>` +
      row('规则模拟', w(adv.sim, adv.simTotal)) + (adv.usingActual ? row('实际', w(actual, E.total(actual))) : '') + '</tbody></table></div>';
    h += '<p class="muted">模拟持仓为"从最近前高起按收盘价推演"的结果,与你的真实成交会有偏差(盘中触发、成交价、费用)。仅供参考,不构成投资建议。</p>';
    const recent = adv.events.slice(-8);
    if (recent.length) h += '<h3>推演中的最近操作</h3><ul>' + recent.map((e) => `<li>${e.date} ${e.type === 'stage' ? `−${(e.th * 100).toFixed(0)}% 档,买入 TQQQ ${money(e.bought)}` : e.type === 'recover' ? '回补' : '外部资金'}</li>`).join('') + '</ul>';
    out.innerHTML = h;
  }

  /* ---------- init ---------- */
  function resetDefaults() {
    $('mode').value = 'synthetic'; $('start').value = '1999-03-10'; $('capital').value = 1000000; $('baseSym').value = 'VOO';
    $('cashYield').value = 0; $('expense').value = 0.0095;
    $('w_tq').value = 0; $('w_base').value = 70; $('w_b2').value = 15; $('w_cash').value = 15;
    $('capMode').value = 'const'; $('capConst').value = 50; $('capK').value = 11; $('capLo').value = 20; $('capHi').value = 70;
    $('extOn').checked = false; $('extThr').value = '35,40,45,50'; $('extAmt').value = 10; $('extAsset').value = 'base';
    buildStageTable(DEFAULT_STAGE_ROWS);
  }

  function init() {
    resetDefaults();
    document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
      ['bt', 'now', 'about'].forEach((id) => ($(id).hidden = id !== b.dataset.tab));
      if (b.dataset.tab === 'now') runNow(); else if (b.dataset.tab === 'bt') runBacktest();
    }));
    $('runBtn').onclick = () => { runBacktest(); };
    let timer = null;
    $('params').addEventListener('change', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!$('now').hidden) runNow(); else if (!$('bt').hidden) runBacktest(); }, 300);
    });
    $('nowBtn').onclick = runNow;
    $('resetBtn').onclick = () => { resetDefaults(); };
    ['w_tq', 'w_base', 'w_b2', 'w_cash'].forEach((id) => $(id).addEventListener('input', () => validate(readParams())));
    validate(readParams());
    $('mode').onchange = () => { $('start').value = $('mode').value === 'real' ? '2016-11-22' : '1999-03-10'; };
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
  load();
})();
