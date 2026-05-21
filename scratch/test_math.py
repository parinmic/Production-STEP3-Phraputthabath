import urllib.request
import json
import sys
from datetime import datetime, timezone

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
        print(f"Loaded {len(data)} rows.")
        for idx, r in enumerate(data):
            rd = r.get('row_data', {})
            sap = rd.get('SAP')
            name = rd.get('ชื่อสินค้า')
            start = rd.get('ช่วงเวลาเริ่มผลิต')
            stop = rd.get('ช่วงเวลาหยุดผลิต')
            
            # Parse start time
            start_mins = None
            if start and 'T' in start:
                # e.g. 1899-12-30T06:17:56.000Z
                # In Python:
                dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
                ts = dt.timestamp() # seconds from epoch
                # Let's do the exact MS conversion:
                # 6 hours 42 mins 4 seconds offset
                offset_ms = (6 * 3600 + 42 * 60 + 4) * 1000
                dt_ms = int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)
                local_ms = dt_ms + offset_ms
                
                # Convert back to hours and minutes from midnight of that day
                # Since it's 1899-12-30, let's just use modulo of one day in ms
                day_ms = 24 * 3600 * 1000
                time_of_day_ms = (local_ms + 10 * day_ms) % day_ms # add 10 days to keep positive
                start_mins = round(time_of_day_ms / 1000 / 60)
            
            # Print if they have start time
            if start:
                hours = start_mins // 60
                mins = start_mins % 60
                print(f"SAP: {sap} | {name:30} | Raw Start: {start} | Parsed: {hours:02d}:{mins:02d} ({start_mins} mins)")
except Exception as e:
    print("Error:", e)
