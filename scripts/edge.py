"""Realitäts-Check „Ziel vor Stop?“ – historische Basisrate je Setup.

Für jede Aktie und Ebene (kurz/lang):
- Start: Zonenmitte, solange der Einstieg nicht ausgelöst ist; aktueller Kurs, wenn der Trade läuft (laut track.json)
  bzw. wenn es keine Zone gibt.
- Stop- und Ziel-Abstand in % ab Start. CRV = Ziel-% / Stop-%.
- Ab JEDER historischen Kerze (Schlusskurs = Einstieg) prüfen, was innerhalb des Horizonts zuerst kommt:
  +Ziel-% (Hoch) oder −Stop-% (Tief). Beides in einer Kerze → Stop. Weder noch → zum Schlusskurs am Horizont in R.
- Zwei Varianten: roh und mit herausgerechnetem Trend (mittlere Log-Rendite je Kerze). Ausgegeben wird die vorsichtigere
  (kleinerer Erwartungswert). Pauschal −0,05 R für Gebühren/Schlupf.
- EV in R = Mittel aller Einzelergebnisse (Ziel = +CRV, Stop = −1, keins = Schluss in R) − 0,05.
  Nötige Trefferquote be = 1 / (1 + CRV).
- n_eff ≈ n / Horizont (überlappende Fenster sind nicht unabhängig); n_eff < 20 → few = true („wenig Daten“).
- stop_atr: Stop-Abstand / typische Schwankung (kurz: atr_pct aus kpis.json = Tages-ATR; lang: Wochen-ATR aus weekly.json).
  < 1 heißt: der Stop liegt innerhalb einer normalen Kerze („Stop im Rauschen“).
- orig: wurde der Stop nach einem Stop-Bruch gesenkt, zusätzlich die Rechnung für den ursprünglichen Plan (damaliger Einstieg,
  Stop und Ziel in % – so, wie das Setup gemeint war).
Daten: kurz = data/daily3y.json (3 Jahre Tageskerzen, sonst daily.json) + neueste Kerzen aus prices.json, Horizont horizon_weeks_high;
       lang = data/weekly.json (5 Jahre) + laufende Woche, Horizont bis lt_until.
Ausgabe: data/edge.json
Aufruf: python scripts/edge.py            (in GitHub Actions vor track.py)
        python scripts/edge.py --check CAT HOOD   (Gegenprobe: Wochenkerzen, Start ab Kurs, kurze Marken)"""
import json, math, sys, datetime

FEE = 0.05
TODAY = datetime.date.today()
MON = {"jan": 1, "feb": 2, "mär": 3, "märz": 3, "apr": 4, "mai": 5, "jun": 6, "juni": 6, "jul": 7, "juli": 7, "aug": 8,
       "sep": 9, "sept": 9, "okt": 10, "nov": 11, "dez": 12}


def load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:  # noqa
        return default


def num(x):
    try:
        return None if x is None else float(x)
    except (TypeError, ValueError):
        return None


def until_weeks(txt):
    """„Dez. 2027“ → Wochen ab heute (Monatsmitte), mindestens 4."""
    try:
        m, y = str(txt).replace(".", "").split()[-2:]
        mo = MON[m.lower()[:4]] if m.lower()[:4] in MON else MON[m.lower()[:3]]
        d = datetime.date(int(y), mo, 15)
        return max(4, round((d - TODAY).days / 7))
    except Exception:  # noqa
        return None


def merge(base, extra):
    """Kerzen zusammenführen (neuere aus extra ersetzen/ergänzen)."""
    rows = {k[0]: k for k in base if None not in k}
    for k in extra or []:
        if None not in k:
            rows[k[0]] = k
    return [rows[d] for d in sorted(rows)]


def live_weekly(w, d):
    w = [list(k) for k in w]
    if w and d and d[-1][0] >= w[-1][0]:
        wk = [k for k in d if k[0] >= w[-1][0]]
        w[-1] = [w[-1][0], w[-1][1], max(k[2] for k in wk + [w[-1]]), min(k[3] for k in wk + [w[-1]]), d[-1][4]]
    return w


def atr_pct(rows, n=14):
    trs = [max(rows[i][2], rows[i - 1][4]) - min(rows[i][3], rows[i - 1][4]) for i in range(1, len(rows))][-n:]
    return sum(trs) / len(trs) / rows[-1][4] if trs else None


def simulate(rows, stop_pct, tgt_pct, H, detrend):
    """Ab jeder Kerze s (Einstieg zum Schluss) die nächsten H Kerzen prüfen. Rückgabe: win, loss, none, R-Liste."""
    closes = [k[4] for k in rows]
    mu = 0.0
    if detrend and len(closes) > 2:
        lr = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes)) if closes[i - 1] > 0 and closes[i] > 0]
        mu = sum(lr) / len(lr) if lr else 0.0
    crv = tgt_pct / stop_pct
    win = loss = none = 0
    rs = []
    for s in range(len(rows) - H):
        c0 = closes[s]
        if not c0:
            continue
        up, dn = c0 * (1 + tgt_pct), c0 * (1 - stop_pct)
        res = None
        for k in range(1, H + 1):
            f = math.exp(-mu * k) if detrend else 1.0
            _, _, h, l, c = rows[s + k]
            h, l = h * f, l * f
            if l <= dn:
                res = -1.0; loss += 1; break
            if h >= up:
                res = crv; win += 1; break
        if res is None:
            c = rows[s + H][4] * (math.exp(-mu * H) if detrend else 1.0)
            res = max(-1.0, min(crv, (c / c0 - 1) / stop_pct)); none += 1
        rs.append(res)
    return win, loss, none, rs


def edge(rows, start, stop, tgt, H, noise):
    if not rows or start is None or stop is None or tgt is None or not H:
        return None
    if start <= stop:
        return {"invalid": "Start liegt unter dem Stop"}
    if tgt <= start:
        return {"invalid": "Ziel liegt unter dem Start"}
    stop_pct, tgt_pct = (start - stop) / start, (tgt - start) / start
    crv = tgt_pct / stop_pct
    best = None
    for det in (False, True):
        w, l, nn, rs = simulate(rows, stop_pct, tgt_pct, H, det)
        n = len(rs)
        if n < 10:
            return {"invalid": "zu wenig Kerzen", "n": n}
        ev = sum(rs) / n - FEE
        v = {"p_win": round(w / n, 3), "p_loss": round(l / n, 3), "p_none": round(nn / n, 3), "ev_r": round(ev, 3), "variant": "trend" if det else "roh"}
        if best is None:
            best = v; ev_raw = ev
        else:
            ev_det = ev
            if ev < best["ev_r"]:
                best = v
    n_eff = round(n / H, 1)
    return {**best, "n": n, "n_eff": n_eff, "few": n_eff < 20, "be": round(1 / (1 + crv), 3), "crv": round(crv, 2),
            "stop_pct": round(stop_pct, 4), "tgt_pct": round(tgt_pct, 4), "stop_atr": round(stop_pct / noise, 2) if noise else None,
            "ev_raw": round(ev_raw, 3), "ev_trend": round(ev_det, 3), "H": H}


def running(track, t, lv):
    rows = (track.get("lang", {}) if lv == "lang" else track).get("signals", []) if track else []
    cur = [r for r in rows if r.get("ticker") == t and not r.get("replaced")]
    return bool(cur and cur[0].get("outcome") == "laeuft")


def history(track, t):
    """kurz-Signale einer Aktie, ältestes zuerst."""
    return sorted([r for r in (track or {}).get("signals", []) if r.get("ticker") == t], key=lambda r: r["issued_day"])


def lt_zone(r):
    lo, hi = num(r.get("lt_entry_low")), num(r.get("lt_entry_high"))
    if lo and hi:
        return lo, hi
    path = ((r.get("ew") or {}).get("lang") or {}).get("path") or []
    p, px = (num(path[0].get("p")) if path else None), num(r.get("price"))
    if p and px and p < px * 0.97:
        return round(p * 0.97, 2), round(p * 1.03, 2)
    return None


def main():
    stocks = load("data/stocks.json", [])
    prices = load("data/prices.json", {}).get("stocks", {})
    d3 = load("data/daily3y.json", {}).get("stocks", {})
    d1 = load("data/daily.json", {}).get("stocks", {})
    weekly = load("data/weekly.json", {}).get("stocks", {})
    kpis = load("data/kpis.json", {}).get("stocks", {})
    track = load("data/track.json", {})

    if "--check" in sys.argv:  # Gegenprobe: Wochenkerzen, Start ab aktuellem Kurs, kurze Marken
        for t in sys.argv[sys.argv.index("--check") + 1:]:
            r = next(x for x in stocks if x["ticker"] == t)
            px = (prices.get(t) or {}).get("live_price") or (prices.get(t) or {}).get("close") or r["price"]
            w = live_weekly(weekly.get(t, []), (prices.get(t) or {}).get("ohlc", []))
            e = edge(w, px, num(r["stop"]), num(r["target_low"]), int(r.get("horizon_weeks_high") or 8), atr_pct(w))
            print(t, f"Kurs {px}  Stop {r['stop']}  Ziel {r['target_low']}  H {r.get('horizon_weeks_high')} W  ->",
                  f"Ziel zuerst {e['p_win']:.0%}  Stop zuerst {e['p_loss']:.0%}  keins {e['p_none']:.0%}  EV {e['ev_r']:+.2f} R",
                  f"(roh {e['ev_raw']:+.2f}, trendbereinigt {e['ev_trend']:+.2f}, CRV {e['crv']}, n_eff {e['n_eff']})")
        return

    out = {"generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "fee_r": FEE, "stocks": {}}
    for r in stocks:
        t = r["ticker"]
        p = prices.get(t) or {}
        px = num(p.get("live_price") or p.get("close") or r.get("price"))
        res = {}
        # kurz: Tageskerzen
        days = merge(d3.get(t) or d1.get(t) or [], p.get("ohlc"))
        lo, hi, stop, tgt = (num(r.get(k)) for k in ("entry_low", "entry_high", "stop", "target_low"))
        if None not in (lo, hi, stop, tgt, px):
            run = running(track, t, "kurz") or lo <= px <= hi
            start = px if run else (lo + hi) / 2
            H = int(round((num(r.get("horizon_weeks_high")) or 8) * 5))
            noise = num((kpis.get(t) or {}).get("atr_pct")) or (atr_pct(days) if days else None)
            e = edge(days, start, stop, tgt, H, noise)
            if e:
                e["start"] = round(start, 4); e["start_kind"] = "kurs" if run else "zone"; e["unit"] = "Tage"
                if px < stop:
                    e["below_stop"] = True
                # ursprünglicher Stop, falls nach einem Stop-Bruch gesenkt
                hs = history(track, t)
                stopped = [x for x in hs[:-1] if x.get("outcome") == "stop"]
                if stopped:
                    prev = stopped[-1]  # letzter ausgestoppter Plan (nicht unbedingt die direkt vorige Fassung)
                    if num(prev.get("stop")) and num(prev["stop"]) > stop:
                        # ursprünglicher Plan in Prozent: damaliger Einstieg (Fill bzw. Zonenmitte), Stop und Ziel
                        ps = num(prev.get("fill")) or (num(prev["entry_low"]) + num(prev["entry_high"])) / 2
                        o = edge(days, ps, num(prev["stop"]), num(prev.get("target_low")), H, noise)
                        e["orig"] = {"stop": prev["stop"], "since": prev.get("issued_day"), "start": ps, **(o or {})}
                res["kurz"] = e
        # lang: Wochenkerzen
        w = live_weekly(weekly.get(t, []), p.get("ohlc", []))
        lstop, ltgt = num(r.get("lt_stop")), num(r.get("lt_target_low"))
        H = until_weeks(r.get("lt_until"))
        if w and None not in (lstop, ltgt, px) and H:
            z = lt_zone(r)
            run = running(track, t, "lang") or not z or z[0] <= px <= z[1] * 1.02
            start = px if run else (z[0] + z[1]) / 2
            e = edge(w, start, lstop, ltgt, H, atr_pct(w))
            if e:
                e["start"] = round(start, 4); e["start_kind"] = "kurs" if run else "zone"; e["unit"] = "Wochen"
                res["lang"] = e
        out["stocks"][t] = res
    json.dump(out, open("data/edge.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    ok = [v["kurz"] for v in out["stocks"].values() if v.get("kurz") and "ev_r" in v["kurz"]]
    print(f"edge.json: {len(out['stocks'])} Werte, kurz Ø EV {sum(e['ev_r'] for e in ok) / max(1, len(ok)):+.2f} R, "
          f"{sum(e['ev_r'] < 0 for e in ok)} mit EV < 0, {sum((e.get('stop_atr') or 9) < 1 for e in ok)} mit Stop im Rauschen")


if __name__ == "__main__":
    main()
