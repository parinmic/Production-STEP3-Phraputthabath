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
        print("Total master_logic_calculation rows:", len(data))
        if len(data) > 0:
            row0 = data[0]
            print("First row data keys:", row0.keys())
            
            # Find row with SAP 23015177 or print first 10 row_data
            found = False
            for idx, r in enumerate(data):
                rd = r.get('row_data', {})
                sap = str(rd.get('SAP', '')).strip()
                if sap == '23015177':
                    print(f"Found SAP 23015177 in row {idx}:", rd)
                    found = True
                    break
            if not found:
                print("Could not find SAP 23015177 in the rows. Printing first 5 rows:")
                for i in range(min(5, len(data))):
                    print(f"Row {i}:", data[i].get('row_data'))
except Exception as e:
    print("Error:", e)
