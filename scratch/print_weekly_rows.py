import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = "https://jtjironqszdfsflvdvld.supabase.co/rest/v1/workforce_weekly?limit=5"
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
        print(f"Total rows fetched: {len(data)}")
        if data:
            for i, d in enumerate(data):
                print(f"\nRow {i}:")
                print("  Type:", d.get("weekly_type"))
                print("  Source File:", d.get("source_file"))
                print("  Row Data:", json.dumps(d.get("row_data"), ensure_ascii=False))
        else:
            print("No data found")
except Exception as e:
    print("Error:", e)
