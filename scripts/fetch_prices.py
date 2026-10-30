"""Lädt Tageskurse (1 Jahr) für alle Werte und schreibt data/prices.json.
Quelle: Yahoo Finance Chart-API, Ersatz: Stooq. Läuft in GitHub Actions."""
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
    closes = [r[4] for r in rows]
    last, prev = rows[-1], rows[-2] if len(rows) > 1 else rows[-1]
    year = rows[-252:]
    out["stocks"][t] = {
        "source": src, "currency": ccy, "date": last[0], "close": last[4], "prev_close": prev[4],
        "chg_pct": round(last[4] / prev[4] - 1, 5) if prev[4] else None,
        "high_52w": max(r[2] for r in year), "low_52w": min(r[3] for r in year),
        "live_price": live, "market_open": bool(live_ts and (time.time() - live_ts) < 1200), "live_time": datetime.datetime.utcfromtimestamp(live_ts).isoformat() + "Z" if live_ts else None,
        "ohlc": rows[-130:],  # ca. 6 Monate Tageskerzen: [Datum, Open, High, Low, Close]
    }
os.makedirs("data", exist_ok=True)
json.dump(out, open("data/prices.json", "w"), separators=(",", ":"))
print(f"{len(out['stocks'])}/{len(TICKERS)} Werte geladen, Fehler: {len(out['errors'])}")
