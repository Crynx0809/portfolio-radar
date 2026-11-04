"""Lange Kursreihen je Wert (Yahoo Finance, Ersatz Stooq), einmal pro Tag:
- data/weekly.json: Wochenkerzen der letzten 5 Jahre (Chart „Monate/Jahre“)
- data/daily.json:  Tageskerzen des letzten Jahres (Chart „Wochen/Monate“)"""
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
try:
    oldd = json.load(open("data/daily.json"))
except Exception:  # noqa
    oldd = {}
if all(o.get("date") == TODAY and set(TICKERS) <= set(o.get("stocks", {})) for o in (old, oldd)):
    print("Wochenkerzen von heute schon da"); raise SystemExit(0)

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        return r.read().decode("utf-8")

def yahoo(sym, rng="5y", iv="1wk"):
    d = json.loads(get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval={iv}"))["chart"]["result"][0]
    q = d["indicators"]["quote"][0]; rows = []
    for i, t in enumerate(d["timestamp"]):
        c = q["close"][i]
        if c is None: continue
        rows.append([datetime.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d"), round(q["open"][i] or c, 4), round(q["high"][i] or c, 4), round(q["low"][i] or c, 4), round(c, 4)])
    return rows

def stooq(sym, iv="w", keep=262):
    rows = []
    for r in csv.DictReader(io.StringIO(get(f"https://stooq.com/q/d/l/?s={sym}&i={iv}"))):
        try: rows.append([r["Date"], float(r["Open"]), float(r["High"]), float(r["Low"]), float(r["Close"])])
        except (KeyError, ValueError): pass
    return rows[-keep:]

def build(fn_y, fn_s, prev, path, label):
    out = {"date": TODAY, "stocks": {}, "errors": {}}
    for t, (ysym, ssym, ccy) in TICKERS.items():
        for name, fn, sym in (("yahoo", fn_y, ysym), ("stooq", fn_s, ssym)):
            try:
                rows = fn(sym)
                if rows:
                    out["stocks"][t] = rows; break
            except Exception as e:  # noqa
                out["errors"][f"{t}:{name}"] = str(e)[:120]
            time.sleep(0.3)
        if t not in out["stocks"] and t in prev.get("stocks", {}):
            out["stocks"][t] = prev["stocks"][t]
    json.dump(out, open(path, "w"), separators=(",", ":"))
    print(len(out["stocks"]), "Werte mit", label)

if not (old.get("date") == TODAY and set(TICKERS) <= set(old.get("stocks", {}))):
    build(lambda s: yahoo(s), lambda s: stooq(s), old, "data/weekly.json", "Wochenkerzen")
if not (oldd.get("date") == TODAY and set(TICKERS) <= set(oldd.get("stocks", {}))):
    build(lambda s: yahoo(s, "1y", "1d"), lambda s: stooq(s, "d", 255), oldd, "data/daily.json", "Tageskerzen")
