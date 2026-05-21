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

special = fetch_data("master_logic_calculation", "calculation_type=eq.Mas%20Special&order=uploaded_at.desc")
print(f"Fetched {len(special)} special rows:")
for r in special[:10]:
    row_data = r.get("row_data", {})
    print(f"Uploaded At: {r.get('uploaded_at')} | SAP: {row_data.get('SAP')} | Start: {row_data.get('ช่วงเวลาเริ่มผลิต')} | Stop: {row_data.get('ช่วงเวลาหยุดผลิต')}")
