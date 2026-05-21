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

assignments = fetch_data("production_assignments", "order=created_at.desc&limit=20")
print(f"Latest assignments in DB:")
for a in assignments:
    print(f"Date: {a.get('production_date')} | Table: {a.get('table_name')} | SKU: {a.get('sku')} | Time: {a.get('deadline_time')} | Worker: {a.get('worker_name')}")
