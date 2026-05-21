import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = "https://jtjironqszdfsflvdvld.supabase.co/rest/v1/master_logic_calculation?calculation_type=eq.Mas%20Special&order=uploaded_at.desc"
headers = {
    "apikey": "sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Authorization": "Bearer sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui"
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
        # Row 2 (SAP 23029401) and Row 3 (SAP 23026394)
        for sap_target in ['23029401', '23026394']:
            for idx, r in enumerate(data):
                rd = r.get('row_data', {})
                sap = str(rd.get('SAP', '')).strip()
                if sap == sap_target:
                    print(f"Found SAP {sap_target} in row {idx}:")
                    print("  ช่วงเวลาเริ่มผลิต:", repr(rd.get('ช่วงเวลาเริ่มผลิต')))
                    print("  ช่วงเวลาหยุดผลิต:", repr(rd.get('ช่วงเวลาหยุดผลิต')))
except Exception as e:
    print("Error:", e)
