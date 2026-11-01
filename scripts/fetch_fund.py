"""Analysten, Gewinnschätzungen und Fundamentaldaten je Wert (Yahoo Finance quoteSummary) -> data/fund.json.
Einmal pro Tag neu (sonst Cache), läuft in GitHub Actions nach fetch_prices.py."""
import json, os, time, datetime, http.cookiejar, urllib.request

NOW = datetime.datetime.now(datetime.timezone.utc)
TODAY = NOW.strftime("%Y-%m-%d")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fetch_prices.py"), encoding="utf-8").read()
ns = {}
exec(src.split("def tradingview")[0], ns)
TICKERS = ns["TICKERS"]

old = {}
try:
    old = json.load(open("data/fund.json")).get("stocks", {})
except Exception:  # noqa
    pass

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opener.addheaders = [("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36")]


def get(url):
    with opener.open(url, timeout=30) as r:
        return r.read().decode("utf-8")


crumb, errors = None, {}
try:
    try:
        get("https://fc.yahoo.com")
    except Exception:  # noqa – liefert 404, setzt aber das Cookie
        pass
    crumb = get("https://query2.finance.yahoo.com/v1/test/getcrumb").strip()
except Exception as e:  # noqa
    errors["crumb"] = str(e)[:160]

MODS = "financialData,recommendationTrend,earningsHistory,earningsTrend,upgradeDowngradeHistory,defaultKeyStatistics,calendarEvents"


def raw(x):
    return x.get("raw") if isinstance(x, dict) else x


def summary(sym):
    d = json.loads(get(f"https://query2.finance.yahoo.com/v10/finance/quoteSummary/{urllib.request.quote(sym)}?modules={MODS}&crumb={urllib.request.quote(crumb or '')}"))
    res = d["quoteSummary"]["result"][0]
    fd = res.get("financialData", {}) or {}
    ks = res.get("defaultKeyStatistics", {}) or {}
    out = {k: raw(fd.get(k)) for k in ("targetMeanPrice", "targetHighPrice", "targetLowPrice", "targetMedianPrice", "numberOfAnalystOpinions",
                                       "recommendationMean", "recommendationKey", "totalDebt", "totalCash", "debtToEquity", "freeCashflow",
                                       "operatingCashflow", "revenueGrowth", "earningsGrowth", "profitMargins", "grossMargins",
                                       "operatingMargins", "returnOnEquity", "currentRatio", "financialCurrency")}
    out.update({k: raw(ks.get(k)) for k in ("forwardPE", "pegRatio", "shortPercentOfFloat", "heldPercentInsiders", "heldPercentInstitutions")})
    rt = (res.get("recommendationTrend", {}) or {}).get("trend", [])
    out["rec_trend"] = [{"period": t.get("period"), "strongBuy": t.get("strongBuy"), "buy": t.get("buy"), "hold": t.get("hold"),
                         "sell": t.get("sell"), "strongSell": t.get("strongSell")} for t in rt]
    eh = (res.get("earningsHistory", {}) or {}).get("history", [])
    out["eps_hist"] = [{"q": raw(h.get("quarter")), "actual": raw(h.get("epsActual")), "est": raw(h.get("epsEstimate")),
                        "surprise": raw(h.get("surprisePercent"))} for h in eh]
    tr = []
    for t in (res.get("earningsTrend", {}) or {}).get("trend", []):
        et, rv = t.get("epsTrend", {}) or {}, t.get("epsRevisions", {}) or {}
        tr.append({"period": t.get("period"), "growth": raw(t.get("growth")), "eps_now": raw(et.get("current")),
                   "eps_30d": raw(et.get("30daysAgo")), "eps_90d": raw(et.get("90daysAgo")),
                   "up_30d": raw(rv.get("upLast30days")), "down_30d": raw(rv.get("downLast30days"))})
    out["eps_trend"] = tr
    ud = (res.get("upgradeDowngradeHistory", {}) or {}).get("history", [])[:6]
    out["rating_changes"] = [{"date": datetime.datetime.utcfromtimestamp(u.get("epochGradeDate", 0)).strftime("%Y-%m-%d"), "firm": u.get("firm"),
                              "to": u.get("toGrade"), "from": u.get("fromGrade"), "action": u.get("action")} for u in ud]
    ce = ((res.get("calendarEvents", {}) or {}).get("earnings", {}) or {}).get("earningsDate", [])
    out["next_earnings"] = datetime.datetime.utcfromtimestamp(raw(ce[0])).strftime("%Y-%m-%d") if ce and raw(ce[0]) else None
    return out


fund = {"generated_at": NOW.isoformat(timespec="seconds"), "stocks": {}, "errors": errors}
for t, (ysym, _, _) in TICKERS.items():
    if old.get(t, {}).get("date") == TODAY:
        fund["stocks"][t] = old[t]
        continue
    try:
        d = summary(ysym)
        d["date"] = TODAY
        fund["stocks"][t] = d
    except Exception as e:  # noqa
        errors[t] = str(e)[:120]
        if t in old:
            fund["stocks"][t] = old[t]
    time.sleep(0.5)
json.dump(fund, open("data/fund.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(f"{len(fund['stocks'])} Werte, Fehler: {errors}")
