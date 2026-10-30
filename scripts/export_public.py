"""Copy dashboard data into the public site, removing private amounts.
Usage: python3 scripts/export_public.py <dir with stocks.json news.json events.json alerts.json run.json>"""
import json, sys, os
src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(out, exist_ok=True)
PRIVATE = {"position_eur"}
for name in ["stocks", "news", "events", "alerts", "run"]:
    rows = json.load(open(os.path.join(src, name + ".json"), encoding="utf-8"))
    if name == "stocks":
        rows = [{k: v for k, v in r.items() if k not in PRIVATE} for r in rows]
    json.dump(rows, open(os.path.join(out, name + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("exported to", os.path.abspath(out))
