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

# Fetch master special
master_special_rows = fetch_data("master_logic_calculation", "calculation_type=eq.Mas%20Special&order=uploaded_at.desc")
if not master_special_rows:
    print("No master special records found!")
else:
    print(f"Loaded {len(master_special_rows)} rows of Mas Special from DB.")
    # Print the row data for anything related to "สะโพกแต่ง"
    for r in master_special_rows:
        row_data = r.get("row_data", {})
        if "สะโพกแต่ง" in str(row_data.values()):
            print("Found row_data in Mas Special:", row_data)

# Let's check what is in master_channel
master_channel = fetch_data("master_logic_calculation", "calculation_type=eq.Mas%20Channel&order=uploaded_at.desc")
print(f"Loaded {len(master_channel)} rows of Mas Channel from DB.")
