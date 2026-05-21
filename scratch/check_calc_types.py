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
    rows = fetch_data("master_logic_calculation", "select=calculation_type")
    types = set(r['calculation_type'] for r in rows)
    print("Distinct calculation types in master_logic_calculation:")
    for t in sorted(types):
        print(f" - {t}")

if __name__ == "__main__":
    main()
