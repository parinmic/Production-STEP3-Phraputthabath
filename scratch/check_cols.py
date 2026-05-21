import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

headers = {
    "apikey": "sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Authorization": "Bearer sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui"
}

url = "https://jtjironqszdfsflvdvld.supabase.co/rest/v1/production_assignments?limit=1"
req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as res:
        data = json.loads(res.read().decode('utf-8'))
        if data:
            print("Columns in production_assignments:")
            for k, v in data[0].items():
                print(f"  {k}: {type(v).__name__} = {repr(v)}")
except Exception as e:
    print("Error:", e)
