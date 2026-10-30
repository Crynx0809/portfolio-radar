"""Schätzt, in welchem Zeitraum Einstiegszone und Ziel erreicht werden könnten.
Methode: Weg (Kurs → ggf. Einstiegszone → Ziel) geteilt durch das typische Tempo,
mit dem sich die Aktie in Trendphasen bewegt (≈ 20 % der durchschnittlichen Tagesspanne, ATR14).
Spanne: 0,65× bis 1,5× der Schätzung, begrenzt auf 1 Woche bis 6 Monate."""
import datetime, math

MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."]

def atr(ohlc, n=14):
    trs = []
    for i in range(1, len(ohlc)):
        h, l, pc = ohlc[i][2], ohlc[i][3], ohlc[i - 1][4]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    return sum(trs[-n:]) / min(n, len(trs))

def when(d):
    part = "Anfang" if d.day <= 10 else ("Mitte" if d.day <= 20 else "Ende")
    return f"{part} {MONTHS[d.month - 1]}"

def weeks(days):
    w = days / 5
    return max(1, round(w))

def estimate(r, ohlc, today):
    a = atr(ohlc); speed = 0.2 * a
    p = r["price"]; mid = (r["entry_low"] + r["entry_high"]) / 2; tl = r["target_low"]
    to_entry = 0.0
    if r["status"] in ("annaeherung",) or (r["status"] == "boden" and r.get("entry_type") == "Rücksetzer" and p > r["entry_high"]):
        to_entry = max(0.0, p - mid)
    if r.get("entry_type") == "Ausbruch" or r["status"] in ("trend", "zone", "meiden"):
        dist = abs(tl - p)
    else:
        dist = to_entry + abs(tl - mid)
    days = dist / speed
    lo, hi = max(10, days * 0.65), min(130, max(days * 1.5, 20))
    if lo > hi: lo = hi * 0.6
    end = today + datetime.timedelta(days=math.ceil(hi * 7 / 5))
    out = {"horizon_weeks_low": weeks(lo), "horizon_weeks_high": weeks(hi), "horizon_end": end.isoformat(),
           "horizon_text": f"Ziel in ca. {weeks(lo)}–{weeks(hi)} Wochen (bis ca. {when(end)})"}
    if to_entry > 0:
        e_days = to_entry / speed
        e_end = today + datetime.timedelta(days=math.ceil(max(5, e_days * 1.5) * 7 / 5))
        a_, b_ = weeks(max(3, e_days * 0.65)), weeks(max(5, e_days * 1.5))
        span = f"{a_}–{b_} Wochen" if a_ != b_ else (f"{a_} Woche" if a_ == 1 else f"{a_} Wochen")
        out["entry_eta_text"] = f"Einstiegszone in ca. {span} (bis ca. {when(e_end)})"
    else:
        out["entry_eta_text"] = ""
    if out["horizon_weeks_low"] == out["horizon_weeks_high"]:
        out["horizon_text"] = f"Ziel in ca. {out['horizon_weeks_low']} Wochen (bis ca. {when(end)})"
    return out
