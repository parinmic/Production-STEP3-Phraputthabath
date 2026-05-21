import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = "https://jtjironqszdfsflvdvld.supabase.co/rest/v1/workforce_weekly"
headers = {
    "apikey": "sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Authorization": "Bearer sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Accept-Profile": "dev"
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        html = response.read().decode('utf-8')
        data = json.loads(html)
        print(f"Total rows in DB: {len(data)}")
        
        types_keys = {}
        for d in data:
            wtype = d.get("weekly_type")
            row_data = d.get("row_data", {})
            if wtype not in types_keys:
                types_keys[wtype] = set()
            types_keys[wtype].update(row_data.keys())
            
            # Print row if it has any day-off-like columns or if we want to scan values
            for k, v in row_data.items():
                if "หยุด" in str(k) or "หยุด" in str(v):
                    print(f"Match in type {wtype}: {k} = {v}")
                    
        for wtype, keys in types_keys.items():
            print(f"\nKeys for {wtype}:")
            for k in sorted(keys):
                print(f"  - {k}")
except Exception as e:
    print("Error:", e)
