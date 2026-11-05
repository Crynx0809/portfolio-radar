"""Prüfskript vor dem Schreiben von stocks.json (Abendanalyse / News-Checks, siehe ROUTINE.md).
python3 scripts/check.py [pfad/zu/stocks.json]      (Standard: data/stocks.json)
FEHLER (Exit-Code 1) müssen behoben werden. HINWEISE müssen in der Abendanalyse begründet oder angepasst werden.
Fehler:   NaN/fehlende Marken, entry_low > entry_high, target_low > target_high, stop ≥ entry_low, Kurs ≠ prices.json-Kurs.
Hinweise: status passt nicht zum Kurs, Ziel fast erreicht bei Zone weit darunter (Ziel gehört zur laufenden Bewegung), Kurs schon unter dem Stop, CRV unter 1:2, Realitäts-Check EV < 0 oder Stop im Rauschen
          (stop_atr < 1, aus data/edge.json), Stop nach einem Stop-Bruch gesenkt ohne stop_reset_reason."""
import json, math, sys

path = sys.argv[1] if len(sys.argv) > 1 else "data/stocks.json"


def load(p, d):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:  # noqa
        return d


S = load(path, [])
P = load("data/prices.json", {}).get("stocks", {})
E = load("data/edge.json", {}).get("stocks", {})
T = load("data/track.json", {})
err, warn = [], []
bad = lambda v: v is None or (isinstance(v, float) and math.isnan(v))  # noqa

for r in S:
    t = r.get("ticker", "?")
    for k in ("price", "entry_low", "entry_high", "stop", "target_low", "target_high"):
        if bad(r.get(k)):
            err.append(f"{t}: {k} fehlt/NaN")
    if any(bad(r.get(k)) for k in ("price", "entry_low", "entry_high", "stop", "target_low")):
        continue
    px, lo, hi, st, tl, th = (r[k] for k in ("price", "entry_low", "entry_high", "stop", "target_low", "target_high"))
    if lo > hi: err.append(f"{t}: entry_low {lo} > entry_high {hi}")
    if th is not None and tl > th: err.append(f"{t}: target_low {tl} > target_high {th}")
    if st >= lo: err.append(f"{t}: stop {st} nicht unter entry_low {lo}")
    q = P.get(t) or {}
    ref = q.get("close")
    if ref and abs(px / ref - 1) > 0.02 and abs(px / (q.get("live_price") or ref) - 1) > 0.02:
        err.append(f"{t}: Kurs {px} weicht vom prices.json-Kurs {ref} ab")
    # Hinweise
    if r.get("status") == "zone" and not (lo * 0.98 <= px <= hi * 1.02):
        warn.append(f"{t}: status „zone“, aber Kurs {px} liegt außerhalb der Zone {lo}–{hi}")
    if px < st:
        warn.append(f"{t}: Kurs {px} liegt schon unter dem Stop {st}" + (" (Ausbruchs-Einstieg darüber – Plan prüfen)" if r.get("entry_type") == "Ausbruch" else " – Plan anpassen oder begründen"))
    mid = (lo + hi) / 2
    crv = (tl - mid) / (mid - st) if mid > st else None
    if crv is not None and crv < 2:
        warn.append(f"{t}: CRV nur 1:{crv:.1f} (unter 1:2)")
    if r.get("entry_type") != "Ausbruch" and px > hi * 1.02 and px >= tl * 0.97:
        warn.append(f"{t}: Ziel {tl} fast erreicht (Kurs {px}), Zone {lo}–{hi} liegt darunter – für einen Kauf in der Zone neues Ziel (nächste Welle) setzen")
    e = (E.get(t) or {}).get("kurz") or {}
    if e.get("ev_r") is not None and e["ev_r"] < 0:
        warn.append(f"{t}: Realitäts-Check EV {e['ev_r']:+.2f} R (Ziel zuerst {e['p_win']:.0%}, nötig {e['be']:.0%}) – begründen oder anpassen")
    if e.get("stop_atr") is not None and e["stop_atr"] < 1:
        warn.append(f"{t}: Stop im Rauschen (stop_atr {e['stop_atr']:.2f} < 1) – Stop weiter weg oder begründen")
    hs = sorted([x for x in T.get("signals", []) if x.get("ticker") == t], key=lambda x: x["issued_day"])
    stopped = [x for x in hs if x.get("outcome") == "stop"]
    if stopped and (stopped[-1].get("stop") or 0) > st and not r.get("stop_reset_reason"):
        warn.append(f"{t}: Stop nach dem Bruch vom {stopped[-1]['issued_day']} von {stopped[-1]['stop']} auf {st} gesenkt – stop_reset_reason fehlt")

print(f"Prüfung {path}: {len(S)} Werte, {len(err)} Fehler, {len(warn)} Hinweise")
for x in err:
    print("FEHLER  ", x)
for x in warn:
    print("HINWEIS ", x)
sys.exit(1 if err else 0)
