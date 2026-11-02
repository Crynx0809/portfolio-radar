"""Wächter: prüft während der Handelszeit alle 15 Minuten die Kurse (TradingView) gegen die Marken der Analyse.

- Depotwerte: Stop unterschritten, Stop in Reichweite (≤ 3 %), Bestätigungsmarke überschritten, Tagesverlust ≥ 8 %.
- Watchlist: Kurs in die Einstiegszone gelaufen.
Schreibt data/watch.json (für das Pop-up auf der Seite) und meldet neue dringende Ereignisse bei Depotwerten
als GitHub-Issue (GitHub schickt dem Repo-Besitzer dazu eine Benachrichtigung). Läuft in GitHub Actions.
"""
import datetime, json, os, urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "Crynx0809/portfolio-radar")
TOKEN = os.environ.get("GITHUB_TOKEN")
OWNER = REPO.split("/")[0]
SITE = "https://crynx0809.github.io/portfolio-radar/"
UA = {"User-Agent": "Mozilla/5.0 (portfolio-radar-waechter)"}
NEAR_STOP = 0.03      # Stop in Reichweite
WATCH_STOP = 0.05     # "auf der Kippe": so nah am Stop wird ein Wert besonders beobachtet
NEAR_TRIGGER = 0.03
CRASH = -0.08

def fmt(v, cur):
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if abs(v) >= 1000:
        s = s[:-3]
    return s + (" €" if cur == "EUR" else " $")

def pct(x):
    return ("+" if x >= 0 else "−") + f"{abs(x) * 100:.1f}".replace(".", ",") + " %"

def tv_quotes(symbols):
    body = json.dumps({"symbols": {"tickers": symbols, "query": {"types": []}}, "columns": ["close", "change"]}).encode()
    req = urllib.request.Request("https://scanner.tradingview.com/global/scan", data=body, headers={**UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        res = json.loads(r.read().decode())
    return {row["s"]: row["d"] for row in res.get("data", [])}

def gh(method, path, payload=None):
    req = urllib.request.Request("https://api.github.com" + path, method=method,
                                 data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={**UA, "Authorization": f"Bearer {TOKEN}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "{}")

def main():
    stocks = json.load(open("data/stocks.json", encoding="utf-8"))
    try:
        old = json.load(open("data/watch.json", encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        old = {}
    now = datetime.datetime.now(datetime.timezone.utc)
    today = now.strftime("%Y-%m-%d")
    quotes = tv_quotes([r["tv_symbol"] for r in stocks if r.get("tv_symbol")])

    events, watched = [], []
    for r in stocks:
        q = quotes.get(r.get("tv_symbol"))
        if not q or q[0] is None:
            continue
        p, chg = float(q[0]), (q[1] or 0) / 100
        cur, t, name = r.get("currency"), r["ticker"], r.get("name", r["ticker"])
        stop, trig = r.get("stop"), r.get("trigger")
        el, eh = r.get("entry_low"), r.get("entry_high")
        base = {"ticker": t, "name": name, "group": r.get("group"), "price": p, "chg_pct": round(chg, 4), "at": now.isoformat(timespec="minutes")}
        if r.get("group") == "Portfolio":
            gap = (p / stop - 1) if stop else None
            if (gap is not None and gap <= WATCH_STOP) or (trig and p >= trig * (1 - NEAR_TRIGGER)) or r.get("alert") == "hoch":
                watched.append({"ticker": t, "name": name, "price": p, "stop": stop, "trigger": trig,
                                "gap_to_stop": round(gap, 4) if gap is not None else None})
            if stop and p < stop:
                events.append({**base, "id": f"{t}-stop-{today}", "type": "stop", "level": "hoch",
                               "title": f"{name} unter dem Stop {fmt(stop, cur)}",
                               "text": f"Kurs {fmt(p, cur)} ({pct(chg)} heute) liegt unter deinem Stop {fmt(stop, cur)}. Laut Regel zählt der Schlusskurs (Xetra 17:30 Uhr, USA 22 Uhr).",
                               "todo": r.get("if_down") or r.get("action") or ""})
            elif gap is not None and gap <= NEAR_STOP:
                events.append({**base, "id": f"{t}-stopnah-{today}", "type": "stop_nah", "level": "mittel",
                               "title": f"{name} nah am Stop",
                               "text": f"Kurs {fmt(p, cur)} nur noch {pct(gap).lstrip('+')} über dem Stop {fmt(stop, cur)}.",
                               "todo": "Schlusskurs beobachten. " + (r.get("if_down") or "")})
            if chg <= CRASH:
                events.append({**base, "id": f"{t}-absturz-{today}", "type": "absturz", "level": "hoch",
                               "title": f"{name} {pct(chg)} heute",
                               "text": f"Starker Tagesverlust auf {fmt(p, cur)}. Ursache in den News prüfen, nicht im Affekt handeln.",
                               "todo": r.get("action") or r.get("if_down") or ""})
            if trig and p > trig:
                events.append({**base, "id": f"{t}-ausbruch-{today}", "type": "ausbruch", "level": "mittel",
                               "title": f"{name} über der Bestätigungsmarke {fmt(trig, cur)}",
                               "text": f"Kurs {fmt(p, cur)} – das bullische Szenario greift, wenn der Schlusskurs darüber bleibt.",
                               "todo": r.get("if_up") or ""})
        else:
            if el and eh and el <= p <= eh and r.get("status") not in ("zone", "meiden"):
                events.append({**base, "id": f"{t}-zone-{today}", "type": "zone", "level": "mittel",
                               "title": f"{name} in der Einstiegszone",
                               "text": f"Kurs {fmt(p, cur)} ist in die Zone {fmt(el, cur)}–{fmt(eh, cur)} gelaufen.",
                               "todo": r.get("if_wait") or "Auf ein Umkehrsignal achten, Stop mitplanen."})

    notified = [i for i in old.get("notified", []) if i.endswith(today)]
    for e in events:
        if e["level"] != "hoch" or e["group"] != "Portfolio" or e["id"] in notified or not TOKEN:
            continue
        try:
            body = (f"**{e['title']}**\n\n{e['text']}\n\n**Was laut deinem Plan gilt:** {e['todo']}\n\n"
                    f"[Zur Aktie]({SITE}#aktien/{e['ticker']})\n\n@{OWNER} · Automatische Meldung des Wächters. Keine Anlageberatung.")
            iss = gh("POST", f"/repos/{REPO}/issues", {"title": f"⚠️ Wächter: {e['title']}", "body": body})
            gh("PATCH", f"/repos/{REPO}/issues/{iss['number']}", {"state": "closed", "state_reason": "completed"})
            notified.append(e["id"])
        except Exception as ex:  # noqa
            print("Issue fehlgeschlagen:", ex)

    out = {"generated_at": now.isoformat(timespec="seconds"), "watched": watched, "events": events, "notified": notified}
    comparable = lambda d: json.dumps({k: d.get(k) for k in ("watched", "events", "notified")}, sort_keys=True,
                                      default=str).replace('"at"', "")
    strip = lambda d: {**d, "watched": [{k: v for k, v in w.items() if k in ("ticker",)} for w in d.get("watched", [])],
                       "events": [{k: v for k, v in e.items() if k in ("id", "level")} for e in d.get("events", [])]}
    if comparable(strip(out)) != comparable(strip(old)) or not old:
        json.dump(out, open("data/watch.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("watch.json aktualisiert:", len(events), "Ereignisse,", len(watched), "Werte auf der Kippe")
    else:
        print("Keine Änderung")

if __name__ == "__main__":
    main()
