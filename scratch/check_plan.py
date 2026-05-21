import urllib.request
import json

url = "https://jtjironqszdfsflvdvld.supabase.co"
apikey = "sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui"
schema = "dev"

def fetch_data(table, params=""):
    req_url = f"{url}/rest/v1/{table}?{params}"
    req = urllib.request.Request(
        req_url,
        headers={
            "apikey": apikey,
            "Authorization": f"Bearer {apikey}",
            "Accept-Profile": schema
        }
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode('utf-8'))

def main():
    date = '2026-05-19'
    assigns = fetch_data("production_assignments", f"production_date=eq.{date}")
    
    with open("scratch/plan_output.txt", "w", encoding="utf-8") as f:
        f.write("--- Creation timestamps for SKU 23086964 & 23074625 ---\n")
        for a in assigns:
            sap = str(a['sku']).strip().lstrip('0')
            if sap in ["23086964", "23074625"]:
                f.write(f"SKU: {sap} | Period: {a['period']} | Qty: {a['target_quantity']} | Created At: {a.get('created_at')}\n")

if __name__ == "__main__":
    main()
