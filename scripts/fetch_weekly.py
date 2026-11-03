"""Wochenkerzen der letzten 5 Jahre je Wert (Yahoo Finance, Ersatz Stooq) -> data/weekly.json.
Grundlage für das langfristige 18-Monats-Ziel. Einmal pro Tag neu, sonst bleibt die Datei."""
import json, os, time, datetime, csv, io, urllib.request

src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch_prices.py"), encoding="utf-8").read()
ns = {}
exec(src.split("def tradingview")[0], ns)
TICKERS = ns["TICKERS"]
TODAY = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
UA = {"User-Agent": "Mozilla/5.0 (portfolio-radar; GitHub Actions)"}

try:
    old = json.load(open("data/weekly.json"))
except Exception:  # noqa
    old = {}
if old.get("date") == TODAY and set(TICKERS) <= set(old.get("stocks", {})):
    print("Wochenkerzen von heute schon da"); raise SystemExit(0)

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("utf-8")

def yahoo(sym):
    d = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=5y&interval=1wk"))["chart"]["result"][0]
    q = d["indicators"]["quote"][0]; rows = []
    for i, t in enumerate(d["timestamp"]):
        c = q["close"][i]
        if c is None: continue
        rows.append([datetime.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d"), round(q["open"][i] or c, 4), round(q["high"][i] or c, 4), round(q["low"][i] or c, 4), round(c, 4)])
    return rows

def stooq(sym):
    rows = []
    for r in csv.DictReader(io.StringIO(get(f"https://stooq.com/q/d/l/?s={sym}&i=w"))):
        try: rows.append([r["Date"], float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"])])
        except (KeyError, ValueError): pass
    return rows[-262:]

out = {"date": TODAY, "stocks": {}, "errors": {}}
for t, (ysym, ssym, ccy) in TICKERS.items():
    for name, fn, sym in (("yahoo", yahoo, ysym), ("stooq", stooq, ssym)):
        try:
            rows = fn(sym)
            if rows:
                out["stocks"][t] = rows; break
        except Exception as e:  # noqa
            out["errors"][f"{t}:{name}"] = str(e)[:120]
        time.sleep(0.3)
    if t not in out["stocks"] and t in old.get("stocks", {}):
        out["stocks"][t] = old["stocks"][t]
json.dump(out, open("data/weekly.json", "w"), separators=(",", ":"))
print(len(out["stocks"]), "Werte mit Wochenkerzen")
