"""Heatmap: Wie viel Börsenwert ist heute je Sektor dazugekommen oder verschwunden?
Quelle: TradingView-Scanner (wie fetch_prices.py). Läuft in jeder Kurs-Action; die Seite zeigt so morgens den letzten vollen
Handelstag und abends den heutigen.

Märkte
- usa:    US-Aktien (NYSE/NASDAQ, Hauptnotierung) ab 10 Mrd. $ Börsenwert ≈ S&P-500-Größe. Werte in USD.
- europa: Aktien aus DE, FR, NL, CH, UK, IT, ES, DK, SE, BE, FI ab 10 Mrd. € Börsenwert, in EUR umgerechnet.

Je Aktie: Börsenwert (Mrd.), Veränderung heute und 1 Woche, Sektor (auf 11 deutsche Gruppen zusammengefasst).
„Geldfluss“ = Änderung des Börsenwerts: Börsenwert × Änderung / (1 + Änderung). Das ist KEIN echter Zu-/Abfluss von Geld
(jeder Käufer hat einen Verkäufer), sondern wie viel die Aktien eines Sektors zusammen an Wert gewonnen oder verloren haben.
Ausgabe: data/heat.json (aktueller Stand) und data/heat_hist.json (Sektor-Werte je Handelstag, 60 Tage)."""
import json, urllib.request, datetime, time
from zoneinfo import ZoneInfo

UA = {"User-Agent": "Mozilla/5.0 (portfolio-radar)", "Content-Type": "application/json"}
COLS = ["name", "description", "sector", "market_cap_basic", "change", "Perf.W", "close", "currency", "logoid", "fundamental_currency_code"]
GROUP = {
    "Electronic Technology": "Technologie", "Technology Services": "Technologie",
    "Finance": "Finanzen",
    "Health Technology": "Gesundheit", "Health Services": "Gesundheit",
    "Retail Trade": "Konsum", "Consumer Durables": "Konsum", "Consumer Services": "Konsum",
    "Consumer Non-Durables": "Basiskonsum",
    "Producer Manufacturing": "Industrie", "Industrial Services": "Industrie", "Transportation": "Industrie",
    "Commercial Services": "Industrie", "Distribution Services": "Industrie",
    "Energy Minerals": "Energie", "Utilities": "Versorger", "Communications": "Kommunikation",
    "Process Industries": "Rohstoffe & Chemie", "Non-Energy Minerals": "Rohstoffe & Chemie",
}
EU = ["germany", "france", "netherlands", "switzerland", "uk", "italy", "spain", "denmark", "sweden", "belgium", "finland"]
errors = {}


def scan(market, body):
    req = urllib.request.Request(f"https://scanner.tradingview.com/{market}/scan", data=json.dumps(body).encode(), headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode()).get("data", [])


def rows(market, min_cap, extra_filter=None):
    body = {"filter": [{"left": "type", "operation": "equal", "right": "stock"},
                       {"left": "is_primary", "operation": "equal", "right": True},
                       {"left": "market_cap_basic", "operation": "greater", "right": min_cap}] + (extra_filter or []),
            "options": {"lang": "en"}, "columns": COLS,
            "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"}, "range": [0, 1200]}
    out = []
    for x in scan(market, body):
        d = dict(zip(COLS, x["d"]))
        d["sym"] = x["s"]
        out.append(d)
    return out


def fx_to_eur():
    """Kurs 1 Einheit Fremdwährung → EUR (für Börsenwerte außerhalb des Euro)."""
    pairs = {"USD": "FX_IDC:EURUSD", "GBP": "FX_IDC:EURGBP", "CHF": "FX_IDC:EURCHF", "DKK": "FX_IDC:EURDKK", "SEK": "FX_IDC:EURSEK", "NOK": "FX_IDC:EURNOK"}
    try:
        data = scan("global", {"symbols": {"tickers": list(pairs.values())}, "columns": ["close"]})
        by = {x["s"]: x["d"][0] for x in data}
        fx = {c: 1 / by[s] for c, s in pairs.items() if by.get(s)}
    except Exception as e:  # noqa
        errors["fx"] = str(e)[:150]
        fx = {"USD": 0.92, "GBP": 1.18, "CHF": 1.06, "DKK": 0.134, "SEK": 0.087, "NOK": 0.085}
    fx["EUR"] = 1.0
    fx["GBX"] = fx.get("GBP", 1.18) / 100  # Pence
    return fx


def session_date(tz, open_h, open_m):
    """Handelstag, zu dem die Tagesveränderung gehört: vor Börsenbeginn → voriger Werktag."""
    now = datetime.datetime.now(ZoneInfo(tz))
    d = now.date()
    if (now.hour, now.minute) < (open_h, open_m):
        d -= datetime.timedelta(days=1)
    while d.weekday() >= 5:
        d -= datetime.timedelta(days=1)
    return d.isoformat()


def build(items, cur):
    stocks, sectors = [], {}
    for d in items:
        mc, ch, wk = d.get("market_cap_basic"), d.get("change"), d.get("Perf.W")
        if not mc or ch is None:
            continue
        g = GROUP.get(d.get("sector") or "", "Sonstige")
        c, w = ch / 100, (wk / 100 if wk is not None else None)
        flow = mc * c / (1 + c)
        wflow = mc * w / (1 + w) if w is not None else 0.0
        stocks.append({"t": d["name"], "n": (d.get("description") or d["name"])[:40], "g": g, "mc": round(mc / 1e9, 2),
                       "c": round(c, 4), "w": None if w is None else round(w, 4), "f": round(flow / 1e9, 2), "l": d.get("logoid"), "s": d["sym"]})
        s = sectors.setdefault(g, {"g": g, "mc": 0.0, "f": 0.0, "wf": 0.0, "n": 0, "up": 0})
        s["mc"] += mc / 1e9; s["f"] += flow / 1e9; s["wf"] += wflow / 1e9; s["n"] += 1; s["up"] += c > 0
    for s in sectors.values():
        s["c"] = round(s["f"] / (s["mc"] - s["f"]), 4) if s["mc"] - s["f"] else 0
        s["wc"] = round(s["wf"] / (s["mc"] - s["wf"]), 4) if s["mc"] - s["wf"] else 0
        for k in ("mc", "f", "wf"):
            s[k] = round(s[k], 1)
    tot_mc = sum(s["mc"] for s in sectors.values()); tot_f = sum(s["f"] for s in sectors.values()); tot_wf = sum(s["wf"] for s in sectors.values())
    total = {"mc": round(tot_mc, 1), "f": round(tot_f, 1), "c": round(tot_f / (tot_mc - tot_f), 4) if tot_mc else 0,
             "wf": round(tot_wf, 1), "wc": round(tot_wf / (tot_mc - tot_wf), 4) if tot_mc else 0,
             "n": len(stocks), "up": sum(s["up"] for s in sectors.values())}
    return {"cur": cur, "total": total, "sectors": sorted(sectors.values(), key=lambda s: -s["mc"]), "stocks": stocks}


def main():
    out = {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "markets": {}}
    # USA
    try:
        us = rows("america", 10e9, [{"left": "exchange", "operation": "in_range", "right": ["NYSE", "NASDAQ"]}])
        m = build(us, "USD")
        m["date"] = session_date("America/New_York", 9, 30)
        m["label"] = "USA (S&P-500-Größe, ab 10 Mrd. $)"
        out["markets"]["usa"] = m
    except Exception as e:  # noqa
        errors["usa"] = str(e)[:200]
    # Europa
    try:
        fx = fx_to_eur()
        eu = []
        for c in EU:
            try:
                for d in rows(c, 2e9):
                    k = fx.get(d.get("fundamental_currency_code") or d.get("currency") or "EUR")
                    if k and d.get("market_cap_basic"):
                        d["market_cap_basic"] *= k
                        if d["market_cap_basic"] >= 10e9:
                            eu.append(d)
                time.sleep(0.3)
            except Exception as e:  # noqa
                errors[f"europa:{c}"] = str(e)[:150]
        seen, uniq = set(), []
        for d in sorted(eu, key=lambda d: -d["market_cap_basic"]):
            key = (d.get("description") or d["name"]).lower()[:18]
            if key not in seen:
                seen.add(key); uniq.append(d)
        if uniq:
            m = build(uniq, "EUR")
            m["date"] = session_date("Europe/Berlin", 9, 0)
            m["label"] = "Europa (ab 10 Mrd. € Börsenwert)"
            out["markets"]["europa"] = m
    except Exception as e:  # noqa
        errors["europa"] = str(e)[:200]
    out["errors"] = errors
    if not out["markets"]:
        print("Heatmap: keine Daten", errors)
        return
    try:
        old = json.load(open("data/heat.json"))
        for k, v in old.get("markets", {}).items():   # Markt fehlt heute → letzten Stand behalten
            out["markets"].setdefault(k, v)
    except Exception:  # noqa
        pass
    json.dump(out, open("data/heat.json", "w"), ensure_ascii=False, separators=(",", ":"))
    # Verlauf je Handelstag (letzter Stand des Tages gewinnt)
    try:
        hist = json.load(open("data/heat_hist.json"))
    except Exception:  # noqa
        hist = {}
    for k, m in out["markets"].items():
        h = hist.setdefault(k, {})
        h[m["date"]] = {"total": {x: m["total"][x] for x in ("f", "c", "mc")}, "sectors": {s["g"]: [s["f"], s["c"]] for s in m["sectors"]}}
        for d in sorted(h)[:-60]:
            del h[d]
    json.dump(hist, open("data/heat_hist.json", "w"), ensure_ascii=False, separators=(",", ":"))
    for k, m in out["markets"].items():
        print(f"Heatmap {k} ({m['date']}): {m['total']['n']} Aktien, {m['total']['f']:+.0f} Mrd. {m['cur']} ({m['total']['c']:+.2%})")
    if errors:
        print("Fehler:", errors)


if __name__ == "__main__":
    main()
