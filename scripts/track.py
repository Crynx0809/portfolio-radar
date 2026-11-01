"""Trefferquote der Analysen.
1. Signal-Log (data/signals.json): Jede neue Einschätzung (Status, Einstiegszone, Stop, Ziel …) einer Aktie wird als Signal
   mit Zeitpunkt und Kurs gespeichert. Ändern sich die Marken, entsteht ein neues Signal, das alte gilt als „ersetzt“.
2. Auswertung (data/track.json): Jedes Signal wird mit den echten Tageskerzen nachgespielt (nur Long, ohne Gebühren):
   Einstieg, sobald der Kurs die Einstiegszone berührt; danach Stop oder Ziel – was zuerst kommt (am selben Tag zählt der Stop).
Aufruf: python scripts/track.py            (normal, in GitHub Actions nach dem Kursabruf)
        python scripts/track.py --seed     (einmalig: Signale aus der Git-Historie von data/stocks.json nachtragen)"""
import json, sys, os, subprocess, datetime, statistics

KEYS = ["status", "bias", "entry_type", "entry_low", "entry_high", "stop", "target_low", "target_high"]
NOW = datetime.datetime.now(datetime.timezone.utc)
TODAY = NOW.strftime("%Y-%m-%d")


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


def issue_day(r):
    u = str(r.get("updated_at") or "")
    if len(u) >= 10:
        try:  # in Europe/Berlin-ähnliche lokale Zeit wie angegeben
            return datetime.datetime.fromisoformat(u).strftime("%Y-%m-%d"), u
        except ValueError:
            return u[:10], u
    return TODAY, NOW.isoformat(timespec="seconds")


def add_signals(signals, stocks):
    latest = {}
    for s in signals:
        if not s.get("replaced"):
            latest[s["ticker"]] = s
    added = 0
    for r in stocks:
        t = r.get("ticker")
        if not t or num(r.get("entry_low")) is None or num(r.get("stop")) is None:
            continue
        cur = {k: (num(r.get(k)) if k not in ("status", "bias", "entry_type") else r.get(k)) for k in KEYS}
        prev = latest.get(t)
        if prev and all(prev.get(k) == cur[k] for k in KEYS):
            continue
        day, at = issue_day(r)
        if prev:
            if at <= prev["issued_at"]:
                continue
            if prev["issued_day"] == day:  # Überarbeitung am selben Tag ersetzt das Signal ganz (zählt nicht doppelt)
                signals.remove(prev)
            else:
                prev["replaced"] = day
        sig = {"id": f"{t}-{at[:16].replace(':', '').replace('-', '')}", "ticker": t, "name": r.get("name"),
               "group": r.get("group"), "sector": r.get("sector"), "currency": r.get("currency"),
               "issued_at": at, "issued_day": day, "issued_price": num(r.get("price")),
               "trigger": num(r.get("trigger")), "invalidation": num(r.get("invalidation")),
               "horizon_weeks_low": num(r.get("horizon_weeks_low")), "horizon_weeks_high": num(r.get("horizon_weeks_high")),
               "horizon_end": r.get("horizon_end"), "replaced": None, **cur}
        signals.append(sig)
        latest[t] = sig
        added += 1
    return added


def days_between(a, b):
    return (datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days


def evaluate(s, ohlc):
    lo, hi, stop, tgt = s["entry_low"], s["entry_high"], s["stop"], s["target_low"]
    p0 = s["issued_price"]
    out = {k: s.get(k) for k in ("id", "ticker", "name", "group", "sector", "currency", "issued_day", "issued_price", "status", "bias",
                                 "entry_type", "entry_low", "entry_high", "stop", "target_low", "target_high", "trigger", "invalidation",
                                 "horizon_weeks_low", "horizon_weeks_high", "replaced")}
    mid = (lo + hi) / 2
    out["crv_plan"] = round((tgt - mid) / (mid - stop), 2) if tgt is not None and mid > stop else None
    end = s.get("replaced") or None
    expire = s.get("horizon_end") or (datetime.date.fromisoformat(s["issued_day"]) + datetime.timedelta(weeks=26)).isoformat()
    candles = [k for k in ohlc if k[0] > s["issued_day"]]
    # Richtung: Kursentwicklung nach 5 und 20 Handelstagen
    for n in (5, 20):
        out[f"ret_{n}d"] = round(candles[n - 1][4] / p0 - 1, 4) if p0 and len(candles) >= n else None
    # Szenario: Bestätigung (Schluss über trigger) oder Invalidierung (Schluss unter invalidation) – was zuerst?
    out["scenario"] = None
    if p0 and s.get("trigger") and s.get("invalidation") and s["invalidation"] < p0 < s["trigger"]:
        for k in candles:
            if end and k[0] > end:
                break
            if k[4] >= s["trigger"]:
                out["scenario"] = "bestaetigt"; out["scenario_day"] = k[0]; break
            if k[4] < s["invalidation"]:
                out["scenario"] = "widerlegt"; out["scenario_day"] = k[0]; break
    # Trade nachspielen
    fill = fill_day = None
    if p0 and lo <= p0 <= hi:
        fill, fill_day = p0, s["issued_day"]
    outcome, exit_p, exit_day, mfe, mae = None, None, None, 0.0, 0.0
    for k in candles:
        d, o, h, l, c = k
        if end and d > end:
            break
        if fill is None:
            if d > expire:
                break
            if l <= hi and h >= lo:
                fill = min(max(o, lo), hi); fill_day = d
                risk = fill - stop
                if risk <= 0:
                    outcome, exit_p, exit_day = "stop", min(o, stop), d; break
                if l <= stop:  # Einstieg und Stop am selben Tag
                    outcome, exit_p, exit_day = "stop", stop, d
                    mae = -1.0; break
            continue
        risk = fill - stop
        mfe = max(mfe, (h - fill) / risk); mae = min(mae, (l - fill) / risk)
        if l <= stop:
            outcome, exit_p, exit_day = "stop", min(o, stop), d; break
        if tgt is not None and h >= tgt:
            outcome, exit_p, exit_day = "ziel", max(o, tgt), d; break
        if d > expire:
            outcome, exit_p, exit_day = "abgelaufen", c, d; break
    last = [k for k in candles if not end or k[0] <= end]
    if fill is not None and outcome is None:
        if end:
            outcome = "ersetzt"; exit_p = last[-1][4] if last else fill; exit_day = last[-1][0] if last else end
        else:
            outcome = "laeuft"; exit_p = candles[-1][4] if candles else fill; exit_day = None
    if fill is None:
        outcome = "ersetzt_ohne_einstieg" if end else ("nicht_ausgeloest" if candles and candles[-1][0] > expire else "wartet")
    out.update({"fill": round(fill, 4) if fill else None, "fill_day": fill_day, "outcome": outcome,
                "exit": round(exit_p, 4) if exit_p is not None else None, "exit_day": exit_day})
    if fill is not None and fill > stop:
        out["r"] = round((exit_p - fill) / (fill - stop), 2)
        out["mfe_r"] = round(mfe, 2); out["mae_r"] = round(mae, 2)
        out["ret"] = round(exit_p / fill - 1, 4)
        out["days_to_fill"] = days_between(s["issued_day"], fill_day)
        if exit_day:
            out["days_in_trade"] = days_between(fill_day, exit_day)
        if outcome == "ziel" and s.get("horizon_weeks_high"):
            dd = days_between(s["issued_day"], exit_day)
            out["in_horizon"] = dd <= s["horizon_weeks_high"] * 7
            out["days_to_target"] = dd
    return out


def stats(rows):
    closed = [r for r in rows if r["outcome"] in ("ziel", "stop", "abgelaufen", "ersetzt")]
    wins = [r for r in closed if r["outcome"] == "ziel"]
    losses = [r for r in closed if r["outcome"] == "stop"]
    rs = [r["r"] for r in closed if r.get("r") is not None]
    pos, neg = sum(x for x in rs if x > 0), -sum(x for x in rs if x < 0)
    filled = [r for r in rows if r.get("fill") is not None]
    eligible = rows
    mean = lambda v: round(statistics.mean(v), 3) if v else None  # noqa
    dirs = [r for r in rows if r.get("ret_20d") is not None and r.get("bias") in ("bullisch", "bärisch")]
    dirs5 = [r for r in rows if r.get("ret_5d") is not None and r.get("bias") in ("bullisch", "bärisch")]
    ok = lambda r, k: (r[k] > 0) if r["bias"] == "bullisch" else (r[k] < 0)  # noqa
    sc = [r for r in rows if r.get("scenario")]
    hz = [r for r in wins if r.get("in_horizon") is not None]
    return {
        "signals": len(rows), "filled": len(filled), "fill_rate": round(len(filled) / len(eligible), 3) if eligible else None,
        "open": sum(r["outcome"] == "laeuft" for r in rows), "waiting": sum(r["outcome"] == "wartet" for r in rows),
        "closed": len(closed), "wins": len(wins), "losses": len(losses),
        "hit_rate": round(len(wins) / (len(wins) + len(losses)), 3) if wins or losses else None,
        "avg_r": mean(rs), "sum_r": round(sum(rs), 2) if rs else None,
        "profit_factor": round(pos / neg, 2) if neg else (None if not pos else 99),
        "best_r": max(rs) if rs else None, "worst_r": min(rs) if rs else None,
        "avg_win_r": mean([r["r"] for r in wins]), "avg_loss_r": mean([r["r"] for r in losses]),
        "avg_crv_plan": mean([r["crv_plan"] for r in rows if r.get("crv_plan") is not None]),
        "avg_mfe_r": mean([r["mfe_r"] for r in filled if r.get("mfe_r") is not None]),
        "avg_mae_r": mean([r["mae_r"] for r in filled if r.get("mae_r") is not None]),
        "avg_days_fill": mean([r["days_to_fill"] for r in filled if r.get("days_to_fill") is not None]),
        "avg_days_trade": mean([r["days_in_trade"] for r in closed if r.get("days_in_trade") is not None]),
        "horizon_ok": round(sum(r["in_horizon"] for r in hz) / len(hz), 3) if hz else None,
        "dir_hit_20d": round(sum(ok(r, "ret_20d") for r in dirs) / len(dirs), 3) if dirs else None, "dir_n_20d": len(dirs),
        "dir_hit_5d": round(sum(ok(r, "ret_5d") for r in dirs5) / len(dirs5), 3) if dirs5 else None, "dir_n_5d": len(dirs5),
        "scenario_ok": round(sum(r["scenario"] == "bestaetigt" for r in sc) / len(sc), 3) if sc else None, "scenario_n": len(sc),
        "zone_respected": round(sum((r.get("mae_r") or 0) > -0.5 for r in filled) / len(filled), 3) if filled else None,
    }


def crv_bucket(x):
    if x is None:
        return "?"
    return "unter 1,5" if x < 1.5 else "1,5–2,5" if x < 2.5 else "2,5–4" if x < 4 else "über 4"


def main():
    signals = load("data/signals.json", [])
    if "--seed" in sys.argv:
        revs = subprocess.run(["git", "log", "--reverse", "--format=%H", "--", "data/stocks.json"], capture_output=True, text=True).stdout.split()
        for h in revs:
            try:
                st = json.loads(subprocess.run(["git", "show", f"{h}:data/stocks.json"], capture_output=True, text=True).stdout)
                add_signals(signals, st)
            except Exception as e:  # noqa
                print("übersprungen", h[:7], e)
    added = add_signals(signals, load("data/stocks.json", []))
    prices = load("data/prices.json", {}).get("stocks", {})
    rows = [evaluate(s, prices.get(s["ticker"], {}).get("ohlc", [])) for s in signals]
    groups = {}
    for name, key in (("status", lambda r: r["status"]), ("group", lambda r: r["group"]), ("sector", lambda r: r["sector"]),
                      ("bias", lambda r: r["bias"]), ("entry_type", lambda r: r["entry_type"]), ("crv", lambda r: crv_bucket(r.get("crv_plan")))):
        g = {}
        for r in rows:
            g.setdefault(key(r) or "?", []).append(r)
        groups[name] = [{"key": k, **stats(v)} for k, v in sorted(g.items(), key=lambda kv: -len(kv[1]))]
    curve, cum = [], 0.0
    for r in sorted([r for r in rows if r.get("r") is not None and r["outcome"] in ("ziel", "stop", "abgelaufen", "ersetzt")], key=lambda r: r["exit_day"]):
        cum += r["r"]; curve.append([r["exit_day"], round(cum, 2), r["ticker"], r["r"]])
    first = min((s["issued_day"] for s in signals), default=TODAY)
    track = {"generated_at": NOW.isoformat(timespec="seconds"), "since": first, "summary": stats(rows), "groups": groups,
             "curve": curve, "signals": sorted(rows, key=lambda r: r["issued_day"], reverse=True)}
    json.dump(signals, open("data/signals.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    json.dump(track, open("data/track.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"{len(signals)} Signale ({added} neu), {track['summary']['closed']} abgeschlossen")


if __name__ == "__main__":
    main()
