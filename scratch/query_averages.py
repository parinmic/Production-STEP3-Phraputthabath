import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

headers = {
    "apikey": "sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Authorization": "Bearer sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui"
}

def fetch_data(table, query_params=""):
    url = f"https://jtjironqszdfsflvdvld.supabase.co/rest/v1/{table}?{query_params}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching: {e}")
        return []

hist_dates = ["2026-05-19", "2026-05-18", "2026-05-17"]
wm_hist = fetch_data("wet_market_orders", f"delivery_date=in.({','.join(hist_dates)})&upload_round=eq.1600")
lotus_hist = fetch_data("lotus_orders", f"delivery_date=in.({','.join(hist_dates)})&upload_round=eq.1600")

def build_avg_map(rows):
    m = {}
    for r in rows:
        sku = str(r.get("sku", "")).lstrip('0')
        m[sku] = m.get(sku, 0) + float(r.get("quantity") or 0)
    for k in m:
        m[k] = m[k] / 3.0
    return m

avg_wm = build_avg_map(wm_hist)
avg_lotus = build_avg_map(lotus_hist)

print(f"avg_wm for 23015177: {avg_wm.get('23015177')}")
print(f"avg_lotus for 23015177: {avg_lotus.get('23015177')}")
