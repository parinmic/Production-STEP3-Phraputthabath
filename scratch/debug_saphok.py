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

assignments = fetch_data("production_assignments", f"production_date=eq.{today}")
saphok_taeng = [a for a in assignments if a.get("sku") in ["23015177", "000000000023015177"]]

print("=== SAP 23015177 (สะโพกแต่ง) Assignments in DB ===")
for a in saphok_taeng:
    print(f"Worker: {a.get('worker_name'):20} | Deadline Time (Start time from backend): {a.get('deadline_time')} | Qty: {a.get('target_quantity')} | Channel: {a.get('channel')} | Note: {a.get('note')}")
