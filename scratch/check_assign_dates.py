import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

headers = {
    "apikey": "sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Authorization": "Bearer sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui"
}

url = "https://jtjironqszdfsflvdvld.supabase.co/rest/v1/production_assignments?select=production_date&order=production_date.desc&limit=100"
req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as res:
        data = json.loads(res.read().decode('utf-8'))
        dates = set(r['production_date'] for r in data)
        print("Unique dates in production_assignments recently:")
        print(sorted(list(dates)))
except Exception as e:
    print("Error:", e)
