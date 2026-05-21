import os
import json
import urllib.request
import urllib.parse

# Load env variables from .env.local
supabase_url = None
supabase_key = None

if os.path.exists('.env.local'):
    with open('.env.local', 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip().startswith('NEXT_PUBLIC_SUPABASE_URL='):
                supabase_url = line.strip().split('=', 1)[1]
            elif line.strip().startswith('NEXT_PUBLIC_SUPABASE_ANON_KEY='):
                supabase_key = line.strip().split('=', 1)[1]

if not supabase_url or not supabase_key:
    print("Failed to load Supabase env variables.")
    exit(1)

def http_get(url):
    req = urllib.request.Request(url)
    req.add_header('apikey', supabase_key)
    req.add_header('Authorization', f'Bearer {supabase_key}')
    req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error requesting {url}: {e}")
        return []

date = '2026-05-21'

# 1. Query assignments for sa-phok
url_assign = f"{supabase_url}/rest/v1/production_assignments?production_date=eq.{date}&table_name=eq.สะโพก"
assignments = http_get(url_assign)

print("--- ASSIGNMENTS IN DB FOR สะโพก ---")
if assignments:
    for a in assignments:
        print(f"{a.get('sku')} ({a.get('sku_name')}) -> Qty: {a.get('target_quantity')}, Worker: {a.get('worker_name')}, Period: {a.get('period')}, Channel: {a.get('channel')}")
else:
    print("none")

# 2. Query master productivity to find sa-phok SKUs
url_master = f"{supabase_url}/rest/v1/master_logic_calculation?calculation_type=eq.Mas Productivity&order=uploaded_at.desc&limit=500"
master_rows = http_get(url_master)

saphok_skus = set()
sku_info = {}
for row in master_rows:
    row_data = row.get('row_data', {})
    station = str(row_data.get('จุดงาน', '')).strip()
    sku = str(row_data.get('SAP', '')).strip().lstrip('0')
    name = str(row_data.get('ชื่อสินค้า', '')).strip()
    if 'สะโพก' in station:
        saphok_skus.add(sku)
        sku_info[sku] = {'name': name, 'station': station}

print("\n--- SAPHOK SKUS IN PRODUCTIVITY MASTER ---")
for sku in sorted(list(saphok_skus)):
    print(f"{sku}: {sku_info[sku]['name']} ({sku_info[sku]['station']})")

# 3. Query today's orders
channels = ['wet_market_orders', 'lotus_orders', 'makro_orders']
print("\n--- TODAY ORDERS FOR SAPHOK SKUS ---")
for table in channels:
    url_orders = f"{supabase_url}/rest/v1/{table}?delivery_date=eq.{date}"
    orders = http_get(url_orders)
    
    filtered = [o for o in orders if str(o.get('sku', '')).strip().lstrip('0') in saphok_skus]
    print(f"> {table}:")
    if filtered:
        for o in filtered:
            print(f"  {o.get('sku')} ({o.get('sku_name')}) -> Qty: {o.get('quantity')}, Round: {o.get('upload_round')}")
    else:
        print("  none")
