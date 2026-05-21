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

assignments = fetch_data("production_assignments", "production_date=eq.2026-05-20&table_name=eq.ไหล่")
for a in sorted(assignments, key=lambda x: (x.get('worker_name'), x.get('deadline_time'))):
    print(f"Worker: {a.get('worker_name'):20} | SKU: {a.get('sku')} | Name: {a.get('sku_name'):30} | Time: {a.get('deadline_time')} | Qty: {a.get('target_quantity')}")
