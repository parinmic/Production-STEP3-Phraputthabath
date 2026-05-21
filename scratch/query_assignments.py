import urllib.request
import json
import sys
from datetime import datetime

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

assignments = fetch_data("production_assignments", f"production_date=eq.{today}&table_name=eq.sa_phok")
print(f"Fetched {len(assignments)} assignments:")
for a in sorted(assignments, key=lambda x: (x.get('worker_name'), x.get('deadline_time') or '')):
    print(f"Worker: {a.get('worker_name'):20} | SKU: {a.get('sku')} | Time: {a.get('deadline_time')} | Channel: {a.get('channel')} | Period: {a.get('period')}")
