import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

# Let's query recent records from production_assignments
url = "https://jtjironqszdfsflvdvld.supabase.co/rest/v1/production_assignments?order=production_date.desc,start_time.asc&limit=50"
headers = {
    "apikey": "sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Authorization": "Bearer sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui"
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
        print("Recent production assignments:")
        for r in data[:20]:
            print(f"Date: {r.get('production_date')} | SKU: {r.get('sku')} | Name: {r.get('sku_name')} | Time: {r.get('start_time')} - {r.get('end_time')} | Worker: {r.get('worker_name')}")
except Exception as e:
    print("Error:", e)
