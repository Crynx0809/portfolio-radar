"""Vorschlag für das übergeordnete 18-Monats-Ziel aus Wochenkerzen (5 Jahre).

Methode (Elliott auf Wochenbasis, bewusst einfach und nachvollziehbar):
1. Große Wendepunkte per ZigZag (Schwelle je nach Schwankung der Aktie, mind. 20 %).
2. Letzte große Aufwärtsbewegung = Impuls (Tief L0 -> Hoch H). Danach ggf. Korrektur bis L1.
3. Trend über 40-Wochen-Linie.
   - Aufwärtstrend, Kurs nahe/über H: nächste Welle = L1 + 1,0…1,618 × (H − L0)   (klassische Wellen-Projektion)
   - Korrektur/Erholung unter H:     Rückkehr zum Hoch bis 1,272-Extension: H … L0 + 1,272 × (H − L0)
   - Abwärtstrend (Kurs < fallender 40-W-Linie, deutlich unter H): Erholung 38,2…61,8 % des großen Rückgangs
4. Langfristige Absicherung = letztes großes Wochentief unter dem Kurs.
Das Ergebnis ist ein Vorschlag; die Abendanalyse prüft ihn und darf ihn begründet anpassen.
"""
import datetime

MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."]


def zigzag(rows, thr):
    piv, trend = [], 0
    hi = lo = rows[0]
    for r in rows[1:]:
        if trend >= 0:
            if r[2] > hi[2]: hi = r
            if r[3] < hi[2] * (1 - thr):
                piv.append(("H", hi[0], hi[2])); trend = -1; lo = r
        if trend <= 0:
            if r[3] < lo[3]: lo = r
            if r[2] > lo[3] * (1 + thr):
                if trend == -1 or not piv: piv.append(("L", lo[0], lo[3]))
                trend = 1; hi = r
        if trend == 0 and r[3] < lo[3]: lo = r
    last = rows[-1]
    piv.append(("H", hi[0], hi[2]) if trend == 1 else ("L", lo[0], lo[3]))
    out = []
    for p in piv:  # gleiche Typen hintereinander zusammenfassen
        if out and out[-1][0] == p[0]:
            if (p[0] == "H" and p[2] >= out[-1][2]) or (p[0] == "L" and p[2] <= out[-1][2]): out[-1] = p
        else: out.append(p)
    return out


def vol(rows):
    ch = [abs(rows[i][4] / rows[i - 1][4] - 1) for i in range(1, len(rows))][-104:]
    return sum(ch) / len(ch)


def until(today, months=18):
    m = today.month - 1 + months
    return f"{MONTHS[m % 12]} {today.year + m // 12}"


def dd(s):
    return s[8:10] + "." + s[5:7] + "." + s[2:4]


def propose(ticker, weekly, price, today, cur="$"):
    rows = weekly
    thr = max(0.20, min(0.45, vol(rows) * 6))
    piv = zigzag(rows, thr)
    closes = [r[4] for r in rows]
    sma = sum(closes[-40:]) / 40; sma_old = sum(closes[-48:-8]) / 40
    up = price > sma and sma >= sma_old
    hiP = max((p for p in piv if p[0] == "H"), key=lambda p: p[2])
    highs = [p for p in piv if p[0] == "H"]; lows = [p for p in piv if p[0] == "L"]
    H = highs[-1] if highs else hiP
    L0 = next((p for p in reversed(lows) if p[1] < H[1]), min(lows, key=lambda p: p[2]) if lows else ("L", rows[0][0], min(r[3] for r in rows)))
    after = [r for r in rows if r[0] > H[1]]
    L1 = ("L", min(after, key=lambda r: r[3])[0], min(r[3] for r in after)) if after else L0
    M = H[2] - L0[2]
    fmt = lambda v: (f"{v:,.0f}" if v >= 100 else f"{v:,.2f}").replace(",", "X").replace(".", ",").replace("X", ".") + " " + cur
    if price >= H[2] * 0.93 and up:
        kind = "trend"
        lo_t, hi_t = L1[2] + 1.0 * M, L1[2] + 1.618 * M
        if L1 == L0 or L1[2] > price * 0.97:  # noch kein Rücksetzer nach dem Hoch: 1,272–1,618-Extension
            lo_t, hi_t = L0[2] + 1.272 * M, L0[2] + 1.618 * M
        stop = L1[2] if L1[2] < price * 0.97 else L0[2] + 0.5 * M
        text = (f"Großer Aufwärtstrend im Wochenchart: Impuls von {fmt(L0[2])} ({dd(L0[1])}) bis {fmt(H[2])} ({dd(H[1])}). "
                f"Die nächste große Welle zielt auf {fmt(lo_t)}–{fmt(hi_t)} (Projektion 1,0–1,618 der letzten Welle).")
    elif up or price > L1[2] * 1.15 or price > sma:
        kind = "erholung"
        lo_t, hi_t = H[2] * 0.97, max(H[2] * 1.05, L0[2] + 1.272 * M)
        stop = L1[2]
        text = (f"Großes Bild: Hoch {fmt(H[2])} ({dd(H[1])}), danach Korrektur bis {fmt(L1[2])} ({dd(L1[1])}). "
                f"Hält das Tief, ist die Rückkehr zum Hoch und etwas darüber ({fmt(lo_t)}–{fmt(hi_t)}) das übergeordnete Ziel.")
    else:
        kind = "abwaerts"
        top = H[2]; bot = min(L1[2], price)
        lo_t, hi_t = bot + 0.382 * (top - bot), bot + 0.618 * (top - bot)
        stop = bot * 0.9
        text = (f"Übergeordnet im Abwärtstrend (Kurs unter der fallenden 40-Wochen-Linie). Vom Hoch {fmt(top)} ({dd(H[1])}) "
                f"wäre eine große Erholung um 38,2–61,8 % ({fmt(lo_t)}–{fmt(hi_t)}) möglich – erst nach einem bestätigten Boden.")
    if hi_t > price * 3:  # Obergrenze: höchstens Verdreifachung in 18 Monaten
        hi_t = price * 3; lo_t = min(lo_t, hi_t * 0.8)
    return {
        "lt_kind": kind, "lt_target_low": round(lo_t, 2), "lt_target_high": round(hi_t, 2), "lt_stop": round(stop, 2),
        "lt_until": until(today), "lt_text": text,
        "lt_pivots": [{"d": p[1], "p": round(p[2], 2), "t": p[0]} for p in piv[-6:]],
    }
