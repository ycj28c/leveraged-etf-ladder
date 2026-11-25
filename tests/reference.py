#!/usr/bin/env python3
"""Independent Python implementation of the engine, used only to cross-check web/engine.js.

It reads the same data/prices.json and writes tests/reference.json, which
tests/engine.test.js compares against. Standard library only.

Usage:  python3 -I tests/reference.py
"""
import datetime as dt
import json
import math
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = json.loads((ROOT / "data" / "prices.json").read_text())
S = {k: dict(zip(v["d"], v["c"])) for k, v in RAW["series"].items()}
VOL_D, VOL_P = RAW["series"]["QQQ"]["d"], RAW["series"]["QQQ"]["c"]
END = "2026-11-17"

STAGES = [
    (0.10, 0.10, 0.0, "tq"),
    (0.15, 1 / 4, 1 / 4, "tq"),
    (0.20, 1 / 3, 1 / 3, "tq"),
    (0.25, 1 / 2, 1 / 2, "tq"),
    (0.30, 1.0, 1.0, "tq"),
]
W0 = {"tq": 0.0, "base": 0.70, "b2": 0.15, "cash": 0.15}


def days(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days


def build_real(base="VOO", start="2016-11-22"):
    syms = ["QQQ", base, "QLD", "TQQQ"]
    dates = sorted(d for d in S["QQQ"] if all(d in S[s] for s in syms) and start <= d <= END)
    return dict(
        dates=dates,
        QQQ=[S["QQQ"][d] for d in dates],
        BASE=[S[base][d] for d in dates],
        B2=[S["QLD"][d] for d in dates],
        TQ=[S["TQQQ"][d] for d in dates],
        CASH=[1.0] * len(dates),
    )


def build_syn(expense=0.0095):
    dates = sorted(d for d in S["QQQ"] if d in S["SPY"] and d <= END)
    rf, last = [], 0.03
    for d in dates:
        if d in S["^IRX"]:
            last = S["^IRX"][d] / 100
        rf.append(last)
    exp = expense / 252
    QQQ, BASE, B2, TQ, CASH = [S["QQQ"][dates[0]]], [1.0], [1.0], [1.0], [1.0]
    for i in range(1, len(dates)):
        a, b = dates[i - 1], dates[i]
        rq = S["QQQ"][b] / S["QQQ"][a] - 1
        rs = S["SPY"][b] / S["SPY"][a] - 1
        r = rf[i - 1] / 252
        QQQ.append(S["QQQ"][b])
        BASE.append(BASE[-1] * (1 + rs))
        TQ.append(TQ[-1] * max(1e-9, 1 + 3 * rq - 2 * r - exp))
        B2.append(B2[-1] * max(1e-9, 1 + 2 * rq - r - exp))
        CASH.append(CASH[-1] * (1 + r))
    return dict(dates=dates, QQQ=QQQ, BASE=BASE, B2=B2, TQ=TQ, CASH=CASH)


def vol_at(j, n=252):
    r = [VOL_P[k] / VOL_P[k - 1] - 1 for k in range(max(1, j - n + 1), j + 1)]
    if len(r) < 60:
        return None
    m = sum(r) / len(r)
    return math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1)) * math.sqrt(252)


def cap_fn(mode, const=0.5, k=0.11, lo=0.2, hi=0.7):
    if mode == "const":
        return lambda d: const
    cache = {}

    def f(d):
        y = int(d[:4])
        if y not in cache:
            j = max([i for i, x in enumerate(VOL_D) if x < f"{y}-01-01"], default=-1)
            v = vol_at(j) if j >= 1 else None
            cache[y] = const if v is None else min(hi, max(lo, k / max(0.05, v)))
        return cache[y]

    return f


def targets(W):
    v = dict(W)
    out = [dict(W)]
    prev = 0.0
    for dd, fb, fc, tgt in STAGES:
        x = (1 - dd) / (1 - prev) - 1
        prev = dd
        v["tq"] *= 1 + 3 * x
        v["base"] *= 1 + x
        v["b2"] *= 1 + 2 * x
        m = v["base"] * fb + v["cash"] * fc
        v["base"] *= 1 - fb
        v["cash"] *= 1 - fc
        v[tgt] += m
        s = sum(v.values())
        out.append({a: b / s for a, b in v.items()})
    return out


def run(ds, capital, cap, i0=0, i1=None, dynamic=False, ext=None):
    i1 = len(ds["dates"]) - 1 if i1 is None else i1
    W = W0
    q0 = ds["QQQ"][i0]
    stage, inc, ei, contrib = 0, False, 0, 0.0
    if dynamic:
        upto = len([d for d in VOL_D if d <= ds["dates"][i0]])
        pk, pk_i = -1e18, 0
        for k in range(upto):
            if VOL_P[k] >= pk:
                pk, pk_i = VOL_P[k], k
        tr = min(VOL_P[pk_i:upto])
        peak, trough = max(pk, q0), min(tr, q0)
        stage = sum(1 for s in STAGES if 1 - q0 / peak >= s[0])
        inc = stage > 0
        w = targets(W)[stage]
    else:
        peak = trough = q0
        w = W
    v = {k: capital * x for k, x in w.items()}
    values, contribs, nev = [sum(v.values())], [0.0], 0
    for i in range(i0 + 1, i1 + 1):
        v["tq"] *= ds["TQ"][i] / ds["TQ"][i - 1]
        v["base"] *= ds["BASE"][i] / ds["BASE"][i - 1]
        v["b2"] *= ds["B2"][i] / ds["B2"][i - 1]
        v["cash"] *= ds["CASH"][i] / ds["CASH"][i - 1]
        q, tot, d = ds["QQQ"][i], sum(v.values()), ds["dates"][i]
        if not inc and q > peak:
            peak = q
        if inc:
            trough = min(trough, q)
            if q >= peak + (peak - trough):
                v = {k: tot * x for k, x in W.items()}
                inc, stage, trough, ei = False, 0, q, 0
                nev += 1
        dd = 1 - q / peak
        if ext and inc:
            while ei < len(ext["thr"]) and dd >= ext["thr"][ei]:
                amt = ext["amt"] * capital
                v[ext["asset"]] += amt
                contrib += amt
                ei += 1
        while stage < len(STAGES) and dd >= STAGES[stage][0]:
            _, fb, fc, tgt = STAGES[stage]
            if not inc:
                inc, trough = True, q
            moved = v["base"] * fb + v["cash"] * fc
            f = 1.0
            c = cap(d)
            if tgt != "base" and moved > 0:
                f = min(1.0, max(0.0, c * tot - v[tgt]) / moved)
            v["base"] -= v["base"] * fb * f
            v["cash"] -= v["cash"] * fc * f
            v[tgt] += moved * f
            stage += 1
            nev += 1
        values.append(sum(v.values()))
        contribs.append(contrib)
    return dict(dates=ds["dates"][i0 : i1 + 1], values=values, contribs=contribs, capital=capital, events=nev)


def analyze(res):
    vals, cons, dates = res["values"], res["contribs"], res["dates"]
    idx = [1.0]
    for i in range(1, len(vals)):
        idx.append(idx[-1] * ((vals[i] - (cons[i] - cons[i - 1])) / vals[i - 1]))
    yrs = days(dates[0], dates[-1]) / 365.25
    cagr = idx[-1] ** (1 / yrs) - 1
    r = [idx[i] / idx[i - 1] - 1 for i in range(1, len(idx))]
    m = sum(r) / len(r)
    vol = math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1)) * math.sqrt(252)
    pk, mdd, mdd_d = idx[0], 0.0, dates[0]
    for x, d in zip(idx, dates):
        pk = max(pk, x)
        if x / pk - 1 < mdd:
            mdd, mdd_d = x / pk - 1, d
    n = len(vals) - 1
    invested = res["capital"] + cons[n]
    flows = [(dates[0], res["capital"])] + [
        (dates[i], cons[i] - cons[i - 1]) for i in range(1, n + 1) if cons[i] - cons[i - 1] > 0
    ]

    def fz(rate):
        t = -sum(a / (1 + rate) ** (days(dates[0], d) / 365.25) for d, a in flows)
        return t + vals[n] / (1 + rate) ** (days(dates[0], dates[n]) / 365.25)

    lo, hi = -0.99, 3.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if fz(mid) > 0:
            lo = mid
        else:
            hi = mid
    return dict(final=vals[n], invested=invested, moic=vals[n] / invested, irr=(lo + hi) / 2,
                cagr=cagr, vol=vol, sharpe=cagr / vol, mdd=mdd, mddDate=mdd_d, events=res["events"])


def rolling(ds, cap, capital=1.0, years=5, step=20):
    H, last, m = round(252 * years), len(ds["dates"]) - 1, []
    for i0 in range(0, last - H, step):
        r = run(ds, capital, cap, i0, i0 + H, dynamic=True)
        n = len(r["values"]) - 1
        m.append(max(1e-6, r["values"][n] / (capital + r["contribs"][n])))
    m.sort()
    q = lambda x: m[min(len(m) - 1, int(len(m) * x))]
    return dict(n=len(m), p10=q(0.1), median=q(0.5), mean=sum(m) / len(m),
                geomean=math.exp(sum(math.log(x) for x in m) / len(m)),
                lossShare=sum(1 for x in m if x < 1) / len(m))


def main():
    real, syn = build_real(), build_syn()
    out = {
        "end": END,
        "real_const50": analyze(run(real, 1e6, cap_fn("const", 0.5))),
        "syn_const50": analyze(run(syn, 100.0, cap_fn("const", 0.5))),
        "syn_vol11": analyze(run(syn, 100.0, cap_fn("vol", 0.5, 0.11, 0.2, 0.7))),
        "syn_const50_ext": analyze(
            run(syn, 1e6, cap_fn("const", 0.5), ext={"thr": [0.35, 0.40, 0.45, 0.50], "amt": 0.10, "asset": "base"})
        ),
        "rolling_syn_const50": rolling(syn, cap_fn("const", 0.5)),
    }
    path = ROOT / "tests" / "reference.json"
    path.write_text(json.dumps(out, indent=1))
    print("wrote", path)
    for k, v in [(k, v) for k, v in out.items() if isinstance(v, dict)]:
        print(k, {a: (round(b, 4) if isinstance(b, float) else b) for a, b in v.items()})


if __name__ == "__main__":
    main()
