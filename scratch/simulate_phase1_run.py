import urllib.request
import json
import sys
from datetime import datetime

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

# Load Special Time
master_special = fetch_data("master_logic_calculation", "calculation_type=eq.Mas%20Special&order=uploaded_at.desc")
special_time_map = {}
def parse_excel_time(val):
    if val is None or val == "":
        return None
    if isinstance(val, str):
        val = val.strip()
        if 'T' in val:
            dt = datetime.fromisoformat(val.replace('Z', '+00:00'))
            offset_ms = (6 * 3600 + 42 * 60 + 4) * 1000
            dt_ms = int(dt.timestamp() * 1000)
            local_ms = dt_ms + offset_ms
            day_ms = 24 * 3600 * 1000
            time_of_day_ms = (local_ms + 10 * day_ms) % day_ms
            return round(time_of_day_ms / 1000 / 60)
        if ':' in val:
            parts = val.split(':')
            if len(parts) >= 2:
                return int(parts[0]) * 60 + int(parts[1])
    try:
        num = float(val)
        return round(num * 24 * 60)
    except:
        return None

if master_special:
    for row in master_special:
        r = row.get("row_data", {})
        sap = str(r.get("SAP", "")).strip()
        if not sap:
            continue
        start_val = r.get("ช่วงเวลาเริ่มผลิต")
        stop_val = r.get("ช่วงเวลาหยุดผลิต")
        start_mins = parse_excel_time(start_val)
        stop_mins = parse_excel_time(stop_val)
        if start_mins is not None or stop_mins is not None:
            entry = {"startMins": start_mins, "stopMins": stop_mins}
            special_time_map[sap] = entry
            special_time_map[sap.lstrip('0')] = entry

# Load workforce
workforce = fetch_data("daily_workforce", f"work_date=eq.{today}&upload_round=eq.0800")

# Filter workforce for 'สะโพก' station
saphok_workers = []
for w in workforce:
    ws = (w.get("work_station") or "").replace("(", "").replace(")", "").strip()
    if ws == "สะโพก" or ws == "สะโพกพิเศษ":
        saphok_workers.append(w)

print(f"Saphok workers: {[w.get('name') for w in saphok_workers]}")

# Load channel order (Phase 1, sorted by Priority)
master_channel = fetch_data("master_logic_calculation", "calculation_type=eq.Mas%20Channel&order=uploaded_at.desc")
channel_order = []
if master_channel:
    rows = [r.get("row_data", {}) for r in master_channel if r.get("row_data", {}).get("Phase") == 1]
    rows.sort(key=lambda x: int(x.get("Priority") or 999))
    channel_order = [r.get("Channel") for r in rows if r.get("Channel")]

# Load productivity
master_prod = fetch_data("master_logic_calculation", "calculation_type=eq.Mas%20Productivity&order=uploaded_at.desc")
sku_map = {}
if master_prod:
    for row in master_prod:
        r = row.get("row_data", {})
        sku = str(r.get("SAP", "")).strip()
        if not sku:
            continue
        prod_row = {
            "sku": sku,
            "sku_name": r.get("ชื่อสินค้า"),
            "station": r.get("จุดงาน"),
            "product_group": r.get("กลุ่มสินค้า"),
            "rate": float(r.get("กำลังการผลิต (กก./ชม./คน)") or 0)
        }
        sku_map[sku] = prod_row
        sku_map[sku.lstrip('0')] = prod_row

# Fetch orders for table = สะโพก
hist_dates = ["2026-05-19", "2026-05-18", "2026-05-17"]
wm_hist = fetch_data("wet_market_orders", f"delivery_date=in.({','.join(hist_dates)})&upload_round=eq.1600")
lotus_hist = fetch_data("lotus_orders", f"delivery_date=in.({','.join(hist_dates)})&upload_round=eq.1600")
makro_hist = fetch_data("makro_orders", f"delivery_date=in.({','.join(hist_dates)})&upload_round=eq.1400")

wm_today = []
lotus_today = []
makro_today = fetch_data("makro_orders", f"delivery_date=eq.{today}&upload_round=eq.0800")

def build_avg_map(rows):
    m = {}
    for r in rows:
        sku = str(r.get("sku", "")).lstrip('0')
        m[sku] = m.get(sku, 0) + float(r.get("quantity") or 0)
    for k in m:
        m[k] = m[k] / 3.0
    return m

avg_wm = build_avg_map(wm_hist)
avg_lotus = build_avg_map(lotus_hist)

def aggregate_today(rows):
    m = {}
    for r in rows:
        sku = str(r.get("sku", "")).lstrip('0')
        m[sku] = {
            "qty": m.get(sku, {}).get("qty", 0) + float(r.get("quantity") or 0),
            "name": r.get("sku_name")
        }
    return m

makro_map = aggregate_today(makro_today)

# Build targets
wm_targets = []
wm_hist_names = {str(r.get("sku")).lstrip('0'): r.get("sku_name") for r in wm_hist}
for sku, avg in avg_wm.items():
    wm_targets.append({
        "sku": sku,
        "skuName": wm_hist_names.get(sku),
        "targetQty": avg,
        "channel": "Wet Market"
    })
wm_targets = [t for t in wm_targets if t["targetQty"] > 0]

makro_targets = []
for sku, o in makro_map.items():
    makro_targets.append({
        "sku": sku,
        "skuName": o["name"],
        "targetQty": o["qty"],
        "channel": "Makro"
    })
makro_targets = [t for t in makro_targets if t["targetQty"] > 0]

lotus_targets = []
lotus_hist_names = {str(r.get("sku")).lstrip('0'): r.get("sku_name") for r in lotus_hist}
for sku, avg in avg_lotus.items():
    lotus_targets.append({
        "sku": sku,
        "skuName": lotus_hist_names.get(sku),
        "targetQty": avg,
        "channel": "LOTUS"
    })
lotus_targets = [t for t in lotus_targets if t["targetQty"] > 0]

channel_targets = {
    "Wet Market": wm_targets,
    "Makro": makro_targets,
    "LOTUS": lotus_targets
}

targets = []
for ch in channel_order:
    targets.extend(channel_targets.get(ch, []))

# Filter targets that belong to 'สะโพก' station
saphok_targets = []
for t in targets:
    prod = sku_map.get(t["sku"]) or sku_map.get(t["sku"].lstrip('0'))
    if prod and (prod["station"] == "สะโพก" or prod["station"] == "สะโพกพิเศษ"):
        saphok_targets.append(t)

# Build assignList: special first, then normal
special_list = []
normal_list = []
for t in saphok_targets:
    clean_sku = t["sku"].lstrip('0')
    if clean_sku in special_time_map:
        special_list.append(t)
    else:
        normal_list.append(t)

# Sort special by startMins
special_list.sort(key=lambda x: (special_time_map.get(x["sku"].lstrip('0'), {}).get("startMins") or 0, -x["targetQty"]))
# Sort normal by channel sequence and targetQty
# (Here just keep their order in saphok_targets)
assign_list = special_list + normal_list

print("Assign list order (SKUs):", [t["sku"] for t in assign_list])

# Initialize worker times
phaseStartMins = 8.5 * 60 # 510
phaseEndMins = 14 * 60 # 840
BREAKS = [(720, 780)]

workerFreeAtMins = {}
workerBusySegments = {}
workerHours = {}
for w in saphok_workers:
    name_key = w["name"].strip()
    workerFreeAtMins[name_key] = phaseStartMins
    workerBusySegments[name_key] = []
    workerHours[name_key] = 5.5 # 5.5 hours

def get_worker_free_at(name_key):
    free_at = workerFreeAtMins.get(name_key, phaseStartMins)
    segments = workerBusySegments.get(name_key, [])
    segments.sort(key=lambda x: x[0])
    advanced = True
    while advanced:
        advanced = False
        for start, end in segments:
            if free_at >= start - 0.01 and free_at < end:
                free_at = end
                advanced = True
    return free_at

def get_next_busy_start(name_key, after_mins):
    segments = workerBusySegments.get(name_key, [])
    next_start = float('inf')
    for start, end in segments:
        if start >= after_mins - 0.01:
            next_start = min(next_start, start)
    return next_start

def available_work_mins(from_mins, to_mins):
    total = max(0, to_mins - from_mins)
    overlap = 0
    for bs, be in BREAKS:
        overlap += max(0, min(be, to_mins) - max(bs, from_mins))
    return total - overlap

def wall_clock_finish(from_mins, work_mins):
    if work_mins <= 0:
        return from_mins
    pos = from_mins
    remaining = work_mins
    for bs, be in BREAKS:
        if pos >= bs and pos < be:
            pos = be
        if pos >= be:
            continue
        if remaining <= 0:
            break
        before_break = bs - pos
        if remaining <= before_break:
            return pos + remaining
        remaining -= before_break
        pos = be
    return pos + remaining

# Let's run assignment
assignments = []
for t in assign_list:
    sku = t["sku"]
    target_qty = t["targetQty"]
    prod = sku_map.get(sku)
    rate = prod["rate"]
    channel = t["channel"]
    
    clean_sku = sku.lstrip('0')
    special = special_time_map.get(clean_sku)
    special_start = special.get("startMins") if special else None
    special_stop = special.get("stopMins") if special else None
    
    # Simple assignment logic mimicking route.ts
    # 1. Map eligible workers to entries
    entries = []
    for w in saphok_workers:
        name_key = w["name"].strip()
        current_free = get_worker_free_at(name_key)
        
        # Determine free_at for this SKU
        free_at = max(current_free, special_start) if special_start is not None else current_free
        
        # Capped by next busy segment
        limit_end = min(phaseEndMins, get_next_busy_start(name_key, free_at))
        target_end = min(limit_end, special_stop) if special_stop is not None else limit_end
        
        rem_hours = workerHours[name_key]
        avail_mins = min(rem_hours * 60, max(0, available_work_mins(free_at, target_end)))
        exhaust_at = wall_clock_finish(free_at, avail_mins)
        
        if exhaust_at > free_at + 0.1:
            entries.append({
                "name_key": name_key,
                "free_at": free_at,
                "exhaust_at": exhaust_at,
                "rem_hours": rem_hours
            })
            
    if not entries:
        continue
        
    entries.sort(key=lambda x: x["free_at"])
    
    # 2. Distribute qty
    # Simple distribution: each worker gets a portion
    assigned_qty = min(target_qty, len(entries) * 200) # Mock maximum capacity limit
    qty_per_worker = assigned_qty / len(entries)
    
    for entry in entries:
        nk = entry["name_key"]
        dur_mins = (qty_per_worker / rate) * 60
        finish_at = wall_clock_finish(entry["free_at"], dur_mins)
        
        # Record assignment
        assignments.append({
            "worker": nk,
            "sku": sku,
            "qty": qty_per_worker,
            "start": entry["free_at"],
            "end": finish_at,
            "channel": channel
        })
        
        # Update worker state
        workerBusySegments[nk].append((entry["free_at"], finish_at))
        curr_free = workerFreeAtMins[nk]
        if entry["free_at"] <= curr_free + 0.01:
            workerFreeAtMins[nk] = finish_at
        
        # Advance if overlaps with busy
        workerFreeAtMins[nk] = get_worker_free_at(nk)
        workerHours[nk] = max(0, workerHours[nk] - qty_per_worker / rate)

print(f"\nGenerated {len(assignments)} assignments:")
for a in assignments:
    print(f"Worker: {a['worker']:20} | SKU: {a['sku']} | Time: {wall_clock_finish(a['start'], 0)} -> {wall_clock_finish(a['end'], 0)} | Qty: {a['qty']:.1f} | Channel: {a['channel']}")
