#!/usr/bin/env python3
"""Fetch daily (dividend-adjusted) closes and write data/prices.json.

Uses only the standard library. The data source is Yahoo Finance's public,
*unofficial* chart endpoint; check its terms before redistributing the output
(see README). ^IRX (13-week T-bill yield, in percent) is stored as plain close.

Usage:  python3 -I scripts/fetch_data.py [output_path]
"""
import datetime as dt
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

SYMBOLS = ["QQQ", "SPY", "VOO", "SPMO", "QLD", "TQQQ"]
RATE_SYMBOL = "^IRX"
PERIOD1 = 915148800  # 1999-01-01


def fetch(symbol):
    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/"
        + urllib.parse.quote(symbol)
        + f"?period1={PERIOD1}&period2={int(time.time()) + 2 * 86400}"
        + "&interval=1d&events=div%7Csplit"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.load(resp)
    result = payload["chart"]["result"][0]
    stamps = result["timestamp"]
    adj = result["indicators"].get("adjclose")
    closes = adj[0]["adjclose"] if adj else result["indicators"]["quote"][0]["close"]
    dates, values = [], []
    for ts, px in zip(stamps, closes):
        if px is None:
            continue
        day = dt.datetime.fromtimestamp(ts, dt.timezone.utc).date().isoformat()
        dates.append(day)
        values.append(px)
    return {"d": dates, "c": values}


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / "data" / "prices.json"
    series = {}
    for sym in SYMBOLS + [RATE_SYMBOL]:
        series[sym] = fetch(sym)
        print(f"{sym}: {len(series[sym]['d'])} rows, last {series[sym]['d'][-1]}")
    doc = {
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "Yahoo Finance chart API (unofficial); adjusted close",
        "series": series,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":")))
    print("wrote", out, f"({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
