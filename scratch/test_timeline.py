import sys

sys.stdout.reconfigure(encoding='utf-8')

class Task:
    def __init__(self, sku, name, period, target_quantity, deadline_time, seq):
        self.sku = sku
        self.sku_name = name
        self.period = period
        self.target_quantity = target_quantity
        self.deadline_time = deadline_time
        self.seq = seq

raw_tasks = [
    Task("23074626", "สันคอหมูตัดชิ้น (M)", "เช้า", 15, "08:30:00", 0),
    Task("23086963", "เนื้อแดงแต่งตัดชิ้น SIS กก.ละ", "เช้า", 3, "08:46:00", 1),
    Task("23086967", "สันคอแต่งตัดชิ้น SIS กก.ละ", "เช้า", 3, "08:53:00", 2),
    Task("23074624", "เนื้อไหล่หมูตัดชิ้น (M)", "เช้า", 5, "08:57:00", 3),
    Task("23074626", "สันคอหมูตัดชิ้น (M)", "เช้า", 10, "09:14:00", 4),
    Task("23086963", "เนื้อแดงแต่งตัดชิ้น SIS กก.ละ", "เช้า", 96, "09:27:00", 5)
]

def merge_tasks(tasks):
    merged = {}
    for t in tasks:
        key = f"{t.sku}_{t.period}"
        if key in merged:
            existing = merged[key]
            existing.target_quantity += t.target_quantity
            if t.seq is not None and (existing.seq is None or t.seq < existing.seq):
                existing.seq = t.seq
            if t.deadline_time and (not existing.deadline_time or t.deadline_time < existing.deadline_time):
                existing.deadline_time = t.deadline_time
        else:
            import copy
            merged[key] = copy.copy(t)
    
    val_list = list(merged.values())
    def sort_key(t):
        period_order = {"เช้า": 1, "บ่าย": 2, "ค่ำ": 3}
        p = period_order.get(t.period, 99)
        time = t.deadline_time or ""
        seq = t.seq if t.seq is not None else 999999
        return (p, time, seq)
    
    val_list.sort(key=sort_key)
    return val_list

merged = merge_tasks(raw_tasks)

rate_map = {
    "23074626": 45,
    "23086962": 60,
    "23074624": 27,
    "23086963": 27,
    "23097784": 27,
    "23097792": 45,
    "23086967": 45
}

def task_dur_mins(task):
    rate = rate_map.get(task.sku, 0)
    if rate > 0:
        return round((task.target_quantity / rate) * 60)
    return 0

def wall_clock_finish(start, dur):
    cur = start
    rem = dur
    # Breaks: 12:00 to 13:00 (720 to 780)
    break_start = 720
    break_end = 780
    if cur < break_start:
        avail = break_start - cur
        if rem <= avail:
            return cur + rem
        cur = break_end
        rem -= avail
    return cur + rem

cur_mins = 510
for t in merged:
    dur = task_dur_mins(t)
    start_min = cur_mins
    if t.deadline_time:
        parts = list(map(int, t.deadline_time.split(":")))
        if len(parts) >= 2:
            start_min = max(start_min, parts[0] * 60 + parts[1])
    
    end_min = wall_clock_finish(start_min, dur)
    cur_mins = end_min
    
    sh, sm = divmod(start_min, 60)
    eh, em = divmod(end_min, 60)
    print(f"Task SKU: {t.sku} ({t.sku_name:30}) | Start: {sh:02d}:{sm:02d} | End: {eh:02d}:{em:02d} | Dur: {dur} mins")
