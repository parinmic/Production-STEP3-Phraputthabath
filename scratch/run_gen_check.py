import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

today = "2026-05-20"
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
        print(f"Error fetching from {table}: {e}")
        return []

# Search for any orders of 23015177 on today
print("Searching wet_market_orders for 23015177 on today:")
wm_all = fetch_data("wet_market_orders", f"delivery_date=eq.{today}")
for o in wm_all:
    if "23015177" in str(o.values()) or "สะโพกแต่ง" in str(o.values()):
        print(o)

print("\nSearching lotus_orders for 23015177 on today:")
lotus_all = fetch_data("lotus_orders", f"delivery_date=eq.{today}")
for o in lotus_all:
    if "23015177" in str(o.values()) or "สะโพกแต่ง" in str(o.values()):
        print(o)

print("\nSearching makro_orders for 23015177 on today:")
makro_all = fetch_data("makro_orders", f"delivery_date=eq.{today}")
for o in makro_all:
    if "23015177" in str(o.values()) or "สะโพกแต่ง" in str(o.values()):
        print(o)
