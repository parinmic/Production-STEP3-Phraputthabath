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

makro = fetch_data("makro_orders", "sku=eq.23015177&delivery_date=eq.2026-05-20")
lotus = fetch_data("lotus_orders", "sku=eq.23015177&delivery_date=eq.2026-05-20")
wm = fetch_data("wet_market_orders", "sku=eq.23015177&delivery_date=eq.2026-05-20")

print(f"Makro qty: {sum(float(r.get('quantity') or 0) for r in makro)}")
print(f"Lotus qty: {sum(float(r.get('quantity') or 0) for r in lotus)}")
print(f"WM qty: {sum(float(r.get('quantity') or 0) for r in wm)}")
