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

assignments = fetch_data("production_assignments", "sku=eq.23015177&production_date=eq.2026-05-20")
print(f"Assignments for 23015177 today:")
for a in sorted(assignments, key=lambda x: x.get('worker_name')):
    print(f"Worker: {a.get('worker_name'):20} | Time: {a.get('deadline_time')} | Channel: {a.get('channel')} | Period: {a.get('period')} | Table: {a.get('table_name')}")
