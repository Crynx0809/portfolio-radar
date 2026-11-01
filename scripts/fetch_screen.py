"""Chancen-Finder: durchsucht große US- und deutsche Aktien (TradingView-Screener) nach zwei Mustern
und schreibt die besten Treffer nach data/screen.json.
  A) Rücksetzer im Aufwärtstrend: über der 200-Tage-Linie, stark im Halbjahr, jetzt abgekühlt an die 50-Tage-Linie.
  B) Kurz vor dem Ausbruch: nahe am 52-Wochen-Hoch, Momentum intakt, noch nicht überhitzt.
Nur ein automatischer Vorfilter – keine Elliott-Analyse."""
import json, os, datetime, urllib.request

NOW = datetime.datetime.now(datetime.timezone.utc)
UA = {"User-Agent": "Mozilla/5.0 (portfolio-radar; GitHub Actions)", "Content-Type": "application/json"}
COLS = ["name", "description", "close", "currency", "sector", "market_cap_basic", "SMA50", "SMA200", "RSI", "Perf.W", "Perf.1M",
        "Perf.3M", "Perf.6M", "price_52_week_high", "price_earnings_ttm", "price_earnings_growth_ttm", "Recommend.All",
        "total_revenue_yoy_growth_ttm", "exchange", "ATR"]
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch_prices.py"), encoding="utf-8").read()
ns = {}
exec(src.split("def tradingview")[0], ns)
HAVE = set(ns["TV"].values())


def scan(market, mincap):
    body = {"markets": [market], "symbols": {"query": {"types": []}, "tickers": []}, "options": {"lang": "de"},
            "filter": [{"left": "market_cap_basic", "operation": "greater", "right": mincap},
                       {"left": "type", "operation": "equal", "right": "stock"},
                       {"left": "is_primary", "operation": "equal", "right": True}],
            "columns": COLS, "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"}, "range": [0, 700]}
    req = urllib.request.Request(f"https://scanner.tradingview.com/{market}/scan", data=json.dumps(body).encode(), headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        res = json.loads(r.read().decode())
    return [{"tv": row["s"], **dict(zip(COLS, row["d"]))} for row in res.get("data", [])]


errors, rows = {}, []
for market, cap in (("america", 2e10), ("germany", 5e9)):
    try:
        rows += scan(market, cap)
    except Exception as e:  # noqa
        errors[market] = str(e)[:200]


def ok(r, *ks):
    return all(isinstance(r.get(k), (int, float)) for k in ks)


pull, brk = [], []
for r in rows:
    if not ok(r, "close", "SMA50", "SMA200", "RSI", "Perf.6M", "price_52_week_high"):
        continue
    c, s50, s200, rsi = r["close"], r["SMA50"], r["SMA200"], r["RSI"]
    off_high = c / r["price_52_week_high"] - 1
    rec = r.get("Recommend.All") or 0
    peg = r.get("price_earnings_growth_ttm")
    growth = r.get("total_revenue_yoy_growth_ttm")
    why = []
    base = {"tv": r["tv"], "ticker": r.get("name"), "name": r.get("description"), "close": round(c, 2), "currency": r.get("currency"),
            "sector": r.get("sector"), "rsi": round(rsi, 1), "perf_6m": round(r["Perf.6M"] / 100, 4), "perf_1m": round((r.get("Perf.1M") or 0) / 100, 4),
            "off_high": round(off_high, 4), "vs_sma50": round(c / s50 - 1, 4), "vs_sma200": round(c / s200 - 1, 4),
            "peg": round(peg, 2) if isinstance(peg, (int, float)) else None, "growth": round(growth / 100, 4) if isinstance(growth, (int, float)) else None,
            "mcap": r.get("market_cap_basic"), "have": r["tv"] in HAVE}
    val_ok = (peg is None or peg < 3) and not (isinstance(growth, (int, float)) and growth < -5)
    # A) Rücksetzer im Aufwärtstrend
    if c > s200 and s50 > s200 and r["Perf.6M"] > 10 and 0.94 * s50 <= c <= 1.03 * s50 and 30 <= rsi <= 52 and -0.25 <= off_high <= -0.05 and val_ok:
        score = min(r["Perf.6M"], 80) / 80 * 40 + (52 - rsi) / 22 * 25 + max(0, 1 - abs(c / s50 - 1) / 0.04) * 20 + (rec + 1) / 2 * 15
        why = ["Aufwärtstrend (über 200-T-Linie)", f"Halbjahr {r['Perf.6M']:+.0f} %".replace(".", ","), "Rücksetzer an die 50-T-Linie", f"RSI {rsi:.0f} – abgekühlt"]
        if isinstance(peg, (int, float)) and peg < 1.5:
            why.append(f"PEG {peg:.1f} – günstig".replace(".", ","))
        pull.append({**base, "score": round(score), "why": why})
    # B) Kurz vor dem Ausbruch
    if c > s50 > s200 and -0.04 <= off_high <= 0 and 52 <= rsi <= 70 and r["Perf.3M"] and r["Perf.3M"] > 8 and val_ok:
        score = min(r["Perf.3M"], 60) / 60 * 40 + (1 + off_high / 0.04) * 30 + (70 - abs(rsi - 61) * 2) / 70 * 15 + (rec + 1) / 2 * 15
        why = [f"{abs(off_high) * 100:.1f} % unter dem 52-W-Hoch".replace(".", ","), f"3 Monate {r['Perf.3M']:+.0f} %".replace(".", ","), f"RSI {rsi:.0f} – noch nicht überhitzt"]
        if isinstance(growth, (int, float)) and growth > 15:
            why.append(f"Umsatz {growth:+.0f} %".replace(".", ","))
        brk.append({**base, "score": round(score), "why": why})

pull.sort(key=lambda x: -x["score"]); brk.sort(key=lambda x: -x["score"])
out = {"generated_at": NOW.isoformat(timespec="seconds"), "universe": len(rows), "pullback": pull[:12], "breakout": brk[:12], "errors": errors}
json.dump(out, open("data/screen.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(f"Universum {len(rows)}, Rücksetzer {len(pull)}, Ausbruch {len(brk)}, Fehler {errors}")
