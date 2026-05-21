import urllib.request
import urllib.parse
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

headers = {
    "apikey": "sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Authorization": "Bearer sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui"
}

def fetch_data(table, query_params=""):
    encoded_params = urllib.parse.quote(query_params, safe="=&")
    url = f"https://jtjironqszdfsflvdvld.supabase.co/rest/v1/{table}?{encoded_params}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode('utf-8'))
    except Exception as e:
        print(f"Error fetching: {e}")
        return []

skus = ["23074626", "23086962", "23074624", "23086963", "23097784", "23097792", "23086967"]
prod = fetch_data("master_logic_calculation", "calculation_type=eq.Mas Productivity")
for p in prod:
    r = p.get("row_data", {})
    sku = str(r.get("SAP", "")).strip().lstrip('0')
    if sku in skus:
        print(f"SKU: {sku:10} | Name: {r.get('ชื่อสินค้า'):35} | Rate: {r.get('กำลังการผลิต (กก./ชม./คน)')}")
