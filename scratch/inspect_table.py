import urllib.request
import json

url = "https://jtjironqszdfsflvdvld.supabase.co/rest/v1/production_plan_supplementary"
headers = {
    "apikey": "sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Authorization": "Bearer sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui",
    "Accept-Profile": "dev",
    "Content-Profile": "dev",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

test_record = {
    "slot": "1",
    "sku": "MOCK_SKU",
    "sku_name": "Mock Product",
    "quantity": 100,
    "order_date": "2026-05-20",
    "delivery_date": "2026-05-20",
    "loading_time": "10:00",
    "deadline_time": "09:30",
    "source_file": "MOCK_FILE_TEST"
}

req = urllib.request.Request(url, data=json.dumps([test_record]).encode('utf-8'), headers=headers, method="POST")
try:
    with urllib.request.urlopen(req) as response:
        print("Success! Record inserted.")
        # Delete it right after
        del_url = "https://jtjironqszdfsflvdvld.supabase.co/rest/v1/production_plan_supplementary?source_file=eq.MOCK_FILE_TEST"
        del_req = urllib.request.Request(del_url, headers=headers, method="DELETE")
        urllib.request.urlopen(del_req)
        print("Cleanup successful.")
except urllib.error.HTTPError as e:
    print("HTTP Error Code:", e.code)
    print("Response:", e.read().decode('utf-8'))
except Exception as e:
    print("Error:", e)
