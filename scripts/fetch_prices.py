"""Lädt Kurse für alle Werte und schreibt data/prices.json.
Aktueller Kurs: TradingView (Screener-Abfrage). Tageskerzen für Chart und Analyse: Yahoo Finance, Ersatz Stooq.
Läuft in GitHub Actions (morgens, vor den Analysen und abends)."""
import json, os, time, csv, io, datetime, urllib.request

TICKERS = {  # unser Ticker -> (Yahoo-Symbol, Stooq-Symbol, Währung)
    "AMD": ("AMD", "amd.us", "USD"), "GOOGL": ("GOOGL", "googl.us", "USD"), "AMZN": ("AMZN", "amzn.us", "USD"),
    "APLD": ("APLD", "apld.us", "USD"), "BAC": ("BAC", "bac.us", "USD"), "FTNT": ("FTNT", "ftnt.us", "USD"),
    "MRVL": ("MRVL", "mrvl.us", "USD"), "NOVO-B": ("NOV.DE", "nov.de", "EUR"), "SAP": ("SAP.DE", "sap.de", "EUR"),
    "LLY": ("LLY", "lly.us", "USD"), "ISRG": ("ISRG", "isrg.us", "USD"), "XOM": ("XOM", "xom.us", "USD"),
    "RHM": ("RHM.DE", "rhm.de", "EUR"), "ENR": ("ENR.DE", "enr.de", "EUR"), "GEV": ("GEV", "gev.us", "USD"),
    "NEE": ("NEE", "nee.us", "USD"), "ALV": ("ALV.DE", "alv.de", "EUR"), "JPM": ("JPM", "jpm.us", "USD"),
    "V": ("V", "v.us", "USD"), "COST": ("COST", "cost.us", "USD"), "WMT": ("WMT", "wmt.us", "USD"),
    "FCX": ("FCX", "fcx.us", "USD"), "CAT": ("CAT", "cat.us", "USD"), "DTE": ("DTE.DE", "dte.de", "EUR"),
    "CCJ": ("CCJ", "ccj.us", "USD"), "AIR": ("AIR.PA", "air.fr", "EUR"), "BRK-B": ("BRK-B", "brk-b.us", "USD"),
    "RACE": ("RACE", "race.us", "USD"), "MELI": ("MELI", "meli.us", "USD"),
    "RKLB": ("RKLB", "rklb.us", "USD"), "OKLO": ("OKLO", "oklo.us", "USD"), "HIMS": ("HIMS", "hims.us", "USD"),
    "NU": ("NU", "nu.us", "USD"), "HOOD": ("HOOD", "hood.us", "USD"),
}
UA = {"User-Agent": "Mozilla/5.0 (portfolio-radar; GitHub Actions)"}
TV = {"AMD": "NASDAQ:AMD", "GOOGL": "NASDAQ:GOOGL", "AMZN": "NASDAQ:AMZN", "APLD": "NASDAQ:APLD", "BAC": "NYSE:BAC",
      "FTNT": "NASDAQ:FTNT", "MRVL": "NASDAQ:MRVL", "NOVO-B": "XETR:NOV", "SAP": "XETR:SAP", "LLY": "NYSE:LLY",
      "ISRG": "NASDAQ:ISRG", "XOM": "NYSE:XOM", "RHM": "XETR:RHM", "ENR": "XETR:ENR", "GEV": "NYSE:GEV", "NEE": "NYSE:NEE",
      "ALV": "XETR:ALV", "JPM": "NYSE:JPM", "V": "NYSE:V", "COST": "NASDAQ:COST", "WMT": "NASDAQ:WMT", "FCX": "NYSE:FCX",
      "CAT": "NYSE:CAT", "DTE": "XETR:DTE", "CCJ": "NYSE:CCJ", "AIR": "EURONEXT:AIR", "BRK-B": "NYSE:BRK.B",
      "RACE": "NYSE:RACE", "MELI": "NASDAQ:MELI", "RKLB": "NASDAQ:RKLB", "OKLO": "NYSE:OKLO", "HIMS": "NYSE:HIMS",
      "NU": "NYSE:NU", "HOOD": "NASDAQ:HOOD"}

def tradingview():
    body = json.dumps({"symbols": {"tickers": list(TV.values()), "query": {"types": []}},
                       "columns": ["close", "change", "open", "high", "low", "currency"]}).encode()
    req = urllib.request.Request("https://scanner.tradingview.com/global/scan", data=body,
                                 headers={**UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.loads(r.read().decode())
    by_sym = {row["s"]: row["d"] for row in res.get("data", [])}
    out = {}
    for t, sym in TV.items():
        d = by_sym.get(sym)
        if d and d[0] is not None:
            out[t] = {"close": d[0], "chg_pct": (d[1] / 100) if d[1] is not None else None, "open": d[2], "high": d[3], "low": d[4]}
    return out

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")

def yahoo(sym):
    d = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1y&interval=1d"))
    res = d["chart"]["result"][0]
    ts, q = res["timestamp"], res["indicators"]["quote"][0]
    rows = []
    for i, t in enumerate(ts):
        c = q["close"][i]
        if c is None:
            continue
        day = datetime.datetime.utcfromtimestamp(t + res["meta"].get("gmtoffset", 0)).strftime("%Y-%m-%d")
        rows.append([day, round(q["open"][i] or c, 4), round(q["high"][i] or c, 4), round(q["low"][i] or c, 4), round(c, 4)])
    live = res["meta"].get("regularMarketPrice")
    return rows, live, res["meta"].get("regularMarketTime")

def stooq(sym):
    text = get(f"https://stooq.com/q/d/l/?s={sym}&i=d")
    rows = []
    for r in csv.DictReader(io.StringIO(text)):
        try:
            rows.append([r["Date"], float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"])])
        except (KeyError, ValueError):
            pass
    return rows[-260:], None, None

try:
    TVQ = tradingview()
except Exception as e:  # noqa
    TVQ = {}
    print("TradingView nicht erreichbar:", e)
out = {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "stocks": {}, "errors": {}}
for t, (ysym, ssym, ccy) in TICKERS.items():
    rows, live, live_ts, src = [], None, None, None
    for name, fn, sym in (("yahoo", yahoo, ysym), ("stooq", stooq, ssym)):
        try:
            rows, live, live_ts = fn(sym)
            if rows:
                src = name
                break
        except Exception as e:  # noqa
            out["errors"][f"{t}:{name}"] = str(e)[:160]
        time.sleep(0.4)
    if not rows:
        continue
    tvq = TVQ.get(t)
    today = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    if tvq:  # TradingView-Kurs ist maßgeblich; heutige Kerze damit aktualisieren bzw. anlegen
        if rows[-1][0] == today or (live_ts and datetime.datetime.utcfromtimestamp(live_ts).strftime("%Y-%m-%d") == rows[-1][0]):
            rows[-1][4] = round(tvq["close"], 4)
            rows[-1][2] = max(rows[-1][2], tvq["close"]); rows[-1][3] = min(rows[-1][3], tvq["close"])
        elif abs(tvq["close"] - rows[-1][4]) > 1e-9 and tvq.get("open"):
            rows.append([today, tvq["open"], tvq["high"], tvq["low"], tvq["close"]])
        src = "tradingview"
    closes = [r[4] for r in rows]
    last, prev = rows[-1], rows[-2] if len(rows) > 1 else rows[-1]
    year = rows[-252:]
    out["stocks"][t] = {
        "source": src, "tv_symbol": TV.get(t), "currency": ccy, "date": last[0], "close": last[4], "prev_close": prev[4],
        "chg_pct": round(last[4] / prev[4] - 1, 5) if prev[4] else None,
        "high_52w": max(r[2] for r in year), "low_52w": min(r[3] for r in year),
        "live_price": live, "market_open": bool(live_ts and (time.time() - live_ts) < 1200), "live_time": datetime.datetime.utcfromtimestamp(live_ts).isoformat() + "Z" if live_ts else None,
        "ohlc": rows[-130:],  # ca. 6 Monate Tageskerzen: [Datum, Open, High, Low, Close]
    }
os.makedirs("data", exist_ok=True)
json.dump(out, open("data/prices.json", "w"), separators=(",", ":"))
print(f"{len(out['stocks'])}/{len(TICKERS)} Werte geladen, davon {len(TVQ)} mit TradingView-Kurs, Fehler: {len(out['errors'])}")
if len(TVQ) < len(TICKERS):
    out["errors"]["tradingview_missing"] = sorted(set(TICKERS) - set(TVQ))
    json.dump(out, open("data/prices.json", "w"), separators=(",", ":"))
