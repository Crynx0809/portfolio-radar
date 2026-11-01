"""Markt-Cockpit und Kennzahlen je Aktie.
Schreibt data/market.json (Indizes, VIX, Zinsen, Rohstoffe, Sektoren, Stimmung) und data/kpis.json (Kennzahlen je Wert).
Läuft in GitHub Actions nach fetch_prices.py. Quellen: Yahoo Finance (Kurse/Historie), TradingView-Screener (Bewertung),
CNN Fear & Greed (inoffiziell, optional)."""
import json, os, time, datetime, statistics, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (portfolio-radar; GitHub Actions)"}
NOW = datetime.datetime.now(datetime.timezone.utc)

MARKET = [  # key, Yahoo-Symbol, Name, Gruppe
    ("SPX", "^GSPC", "S&P 500", "index"), ("NDX", "^NDX", "Nasdaq 100", "index"), ("DAX", "^GDAXI", "DAX", "index"),
    ("STOXX", "^STOXX50E", "Euro Stoxx 50", "index"), ("VIX", "^VIX", "VIX", "risk"),
    ("EURUSD", "EURUSD=X", "EUR/USD", "macro"), ("TNX", "^TNX", "US-Zins 10 J.", "macro"),
    ("BRENT", "BZ=F", "Öl (Brent)", "macro"), ("GOLD", "GC=F", "Gold", "macro"), ("BTC", "BTC-USD", "Bitcoin", "macro"),
]
SECTORS = [("XLK", "Technologie"), ("XLC", "Kommunikation"), ("XLY", "Zykl. Konsum"), ("XLP", "Basiskonsum"),
           ("XLF", "Finanzen"), ("XLV", "Gesundheit"), ("XLI", "Industrie"), ("XLE", "Energie"), ("XLB", "Rohstoffe"),
           ("XLU", "Versorger"), ("XLRE", "Immobilien"), ("SMH", "Halbleiter")]


def get(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def yahoo(sym, rng="2y", interval="1d"):
    d = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.request.quote(sym)}?range={rng}&interval={interval}"))
    res = d["chart"]["result"][0]
    off = res["meta"].get("gmtoffset", 0)
    out = []
    for t, c in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
        if c is not None:
            out.append((datetime.datetime.utcfromtimestamp(t + off).strftime("%Y-%m-%d"), float(c)))
    # doppelte Tage (Live-Kerze) zusammenfassen
    ded = {}
    for day, c in out:
        ded[day] = c
    return sorted(ded.items())


def perf(series, days):
    if len(series) <= days:
        return None
    return series[-1][1] / series[-1 - days][1] - 1


def ytd(series):
    y = str(NOW.year)
    prev = [c for d, c in series if d < y + "-01-01"]
    return series[-1][1] / prev[-1] - 1 if prev else None


def sma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def rnd(x, n=5):
    return None if x is None else round(x, n)


errors = {}
market = {"generated_at": NOW.isoformat(timespec="seconds"), "items": [], "sectors": [], "errors": errors}
closes = {}
for key, sym, name, grp in MARKET:
    try:
        s = yahoo(sym)
        closes[key] = s
        vals = [c for _, c in s]
        last = vals[-1]
        if key == "TNX" and last > 20:
            vals = [v / 10 for v in vals]; last = vals[-1]
        s200, s50 = sma(vals, 200), sma(vals, 50)
        market["items"].append({
            "key": key, "name": name, "group": grp, "date": s[-1][0], "last": rnd(last, 4),
            "chg_1d": rnd(perf(s, 1)), "chg_1w": rnd(perf(s, 5)), "chg_1m": rnd(perf(s, 21)), "chg_ytd": rnd(ytd(s)),
            "sma50": rnd(s50, 4), "sma200": rnd(s200, 4),
            "above_200": None if s200 is None else last > s200,
            "spark": [rnd(v, 4) for v in vals[-60:]],
        })
    except Exception as e:  # noqa
        errors[key] = str(e)[:160]
    time.sleep(0.3)

for sym, name in SECTORS:
    try:
        s = yahoo(sym, "6mo")
        market["sectors"].append({"key": sym, "name": name, "chg_1d": rnd(perf(s, 1)), "chg_1w": rnd(perf(s, 5)),
                                  "chg_1m": rnd(perf(s, 21)), "chg_3m": rnd(perf(s, 63))})
    except Exception as e:  # noqa
        errors[sym] = str(e)[:160]
    time.sleep(0.3)

# Fear & Greed (CNN, inoffiziell) – optional
try:
    fg = json.loads(get("https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
                        headers={"Accept": "application/json", "Referer": "https://edition.cnn.com/"}))["fear_and_greed"]
    market["fear_greed"] = {"score": round(fg["score"]), "rating": fg.get("rating"),
                            "prev_week": round(fg.get("previous_1_week") or 0), "prev_month": round(fg.get("previous_1_month") or 0)}
except Exception as e:  # noqa
    errors["fear_greed"] = str(e)[:160]

# Marktbreite und Kennzahlen je Aktie aus prices.json
prices = json.load(open("data/prices.json"))["stocks"]
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch_prices.py"), encoding="utf-8").read()
ns = {}
exec(src.split("def tradingview")[0], ns)  # nur TICKERS / TV / UA laden, ohne Abruf
TICKERS, TV = ns["TICKERS"], ns["TV"]

above50 = [p["close"] > sma([r[4] for r in p["ohlc"]], 50) for p in prices.values() if len(p.get("ohlc", [])) >= 50]
market["breadth_50"] = rnd(sum(above50) / len(above50), 3) if above50 else None

# TradingView-Kennzahlen: jedes Feld einzeln prüfen, unbekannte Felder weglassen
TV_FIELDS = ["market_cap_basic", "price_earnings_ttm", "price_earnings_growth_ttm", "price_sales_current", "price_book_fq",
             "dividends_yield_current", "dividend_yield_recent", "beta_1_year", "Recommend.All", "earnings_release_next_date",
             "gross_margin_ttm", "net_margin_ttm", "free_cash_flow_ttm", "total_revenue_yoy_growth_ttm",
             "earnings_per_share_diluted_yoy_growth_ttm", "Perf.Y", "Volatility.M"]


def tv_scan(cols):
    body = json.dumps({"symbols": {"tickers": list(TV.values()), "query": {"types": []}}, "columns": cols}).encode()
    res = json.loads(get("https://scanner.tradingview.com/global/scan", data=body, headers={"Content-Type": "application/json"}))
    return {row["s"]: row["d"] for row in res.get("data", [])}


tvdata, ok_fields = {}, []
try:
    tvdata = tv_scan(TV_FIELDS); ok_fields = TV_FIELDS
except Exception:
    for f in TV_FIELDS:
        try:
            d = tv_scan([f]); ok_fields.append(f)
            for s, v in d.items():
                tvdata.setdefault(s, []).append(v[0])
        except Exception as e:  # noqa
            errors["tv:" + f] = str(e)[:80]
        time.sleep(0.2)
    tvdata = {s: v for s, v in tvdata.items()}

kpis = {"generated_at": NOW.isoformat(timespec="seconds"), "fields": ok_fields, "stocks": {}}
old = {}
try:
    old = json.load(open("data/kpis.json")).get("stocks", {})
except Exception:  # noqa
    pass
bench = {"USD": closes.get("SPX"), "EUR": closes.get("DAX")}
month = NOW.month
for t, (ysym, _, ccy) in TICKERS.items():
    p = prices.get(t)
    k = {}
    if p and len(p.get("ohlc", [])) > 30:
        o = p["ohlc"]; c = [r[4] for r in o]; last = c[-1]
        s50 = sma(c, 50)
        trs = [max(o[i][2], o[i - 1][4]) - min(o[i][3], o[i - 1][4]) for i in range(1, len(o))][-14:]
        k.update({"perf_1w": rnd(last / c[-6] - 1) if len(c) > 5 else None, "perf_1m": rnd(last / c[-22] - 1) if len(c) > 21 else None,
                  "perf_3m": rnd(last / c[-64] - 1) if len(c) > 63 else None,
                  "vs_sma50": rnd(last / s50 - 1) if s50 else None, "atr_pct": rnd(sum(trs) / len(trs) / last, 4),
                  "from_high_52w": rnd(last / p["high_52w"] - 1) if p.get("high_52w") else None,
                  "from_low_52w": rnd(last / p["low_52w"] - 1) if p.get("low_52w") else None})
        b = bench.get(ccy)
        if b:
            def at(day):
                vals = [c2 for d2, c2 in b if d2 <= day]
                return vals[-1] if vals else None
            for lab, n in (("rs_1m", 21), ("rs_3m", 63)):
                if len(o) > n:
                    b0, b1 = at(o[-1 - n][0]), at(o[-1][0])
                    if b0 and b1:
                        k[lab] = rnd((last / o[-1 - n][4]) / (b1 / b0) - 1)
    # Saisonalität (10 Jahre Monatsdaten) – nur einmal am Tag neu
    prev = old.get(t, {})
    if prev.get("season_date") == NOW.strftime("%Y-%m-%d") and prev.get("season"):
        k["season"] = prev["season"]; k["season_date"] = prev["season_date"]; k["sma200_gap"] = prev.get("sma200_gap")
    else:
        try:
            m = yahoo(ysym, "10y", "1mo")
            rets = {}
            for i in range(1, len(m)):
                mm = int(m[i][0][5:7])
                rets.setdefault(mm, []).append(m[i][1] / m[i - 1][1] - 1)
            k["season"] = {str(mm): {"avg": rnd(statistics.mean(v), 4), "up": rnd(sum(x > 0 for x in v) / len(v), 3), "n": len(v)}
                           for mm, v in rets.items()}
            k["season_date"] = NOW.strftime("%Y-%m-%d")
            d = yahoo(ysym, "2y")
            v = [x for _, x in d]
            s200 = sma(v, 200)
            k["sma200_gap"] = rnd(v[-1] / s200 - 1) if s200 else None
        except Exception as e:  # noqa
            errors["season:" + t] = str(e)[:80]
        time.sleep(0.3)
    row = tvdata.get(TV.get(t))
    if row:
        for f, v in zip(ok_fields, row):
            if v is not None:
                k["tv_" + f.replace(".", "_")] = v
    kpis["stocks"][t] = k

json.dump(market, open("data/market.json", "w"), ensure_ascii=False, separators=(",", ":"))
json.dump(kpis, open("data/kpis.json", "w"), ensure_ascii=False, separators=(",", ":"))
print("Markt:", len(market["items"]), "Werte,", len(market["sectors"]), "Sektoren; TV-Felder:", ok_fields, "; Fehler:", errors)
