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
    rows = fetch_data("master_logic_manpower", "select=product_type")
    types = set(r['product_type'] for r in rows)
    print("Distinct product_types in master_logic_manpower:")
    for t in sorted(types):
        print(f" - {t}")

if __name__ == "__main__":
    main()
