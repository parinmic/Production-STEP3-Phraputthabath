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

# Fetch active channels
active_channels = ['Wet Market', 'Makro', 'LOTUS']

# 1. Parse Special SKU time mapping
master_special = fetch_data("master_logic_calculation", "calculation_type=eq.Mas%20Special&order=uploaded_at.desc")
special_time_map = {}

def parse_excel_time(val):
    if not val:
        return None
    if isinstance(val, str):
        val = val.strip()
        if 'T' in val:
            # Manually parse ISO and apply 1899 LMT offset (+06:42:04)
            dt = datetime.fromisoformat(val.replace('Z', '+00:00'))
            offset_ms = (6 * 3600 + 42 * 60 + 4) * 1000
            dt_ms = int(dt.timestamp() * 1000)
            local_ms = dt_ms + offset_ms
            day_ms = 24 * 3600 * 1000
            time_of_day_ms = (local_ms + 10 * day_ms) % day_ms
            return round(time_of_day_ms / 1000 / 60)
        if ':' in val:
            parts = val.split(':')
            if len(parts) >= 2:
                return int(parts[0]) * 60 + int(parts[1])
    try:
        num = float(val)
        return round(num * 24 * 60)
    except:
        return None

if master_special:
    for row in master_special:
        r = row.get("row_data", {})
        sap = str(r.get("SAP", "")).strip()
        if not sap:
            continue
        start_val = r.get("ช่วงเวลาเริ่มผลิต")
        stop_val = r.get("ช่วงเวลาหยุดผลิต")
        start_mins = parse_excel_time(start_val)
        stop_mins = parse_excel_time(stop_val)
        if start_mins is not None or stop_mins is not None:
            special_time_map[sap] = {"startMins": start_mins, "stopMins": stop_mins}
            special_time_map[sap.lstrip('0')] = {"startMins": start_mins, "stopMins": stop_mins}

# Let's inspect "สะโพกแต่ง" (SAP 23015177)
print("สะโพกแต่ง time constraint in map:", special_time_map.get("23015177"))
