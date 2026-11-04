"""Hilfe für die Wellenzählung: druckt die großen Wendepunkte (Datum, Preis) je Aktie.
  python scripts/ew_pivots.py AMD GOOGL      -> lang (Wochenkerzen, 5 Jahre) und kurz (Tageskerzen)
Die Abendanalyse beschriftet daraus ew.lang.count / ew.kurz.count (siehe ROUTINE.md)."""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from longterm import zigzag, vol


def load(n):
    try:
        return json.load(open(f"data/{n}.json"))["stocks"]
    except Exception:  # noqa
        return {}


def show(rows, thr):
    return " ".join(f"{t}{d}:{p:.2f}" for t, d, p in zigzag(rows, thr))


W, D, P = load("weekly"), load("daily"), load("prices")
for t in sys.argv[1:]:
    print(f"== {t}")
    if t in W:
        print("lang :", show(W[t], max(0.15, min(0.4, vol(W[t]) * 4))))
    rows = D.get(t) or (P.get(t) or {}).get("ohlc")
    if rows:
        rows = [r for r in rows if None not in r][-260:]
        print("kurz :", show(rows, max(0.06, min(0.2, vol(rows) * 3.5))))
