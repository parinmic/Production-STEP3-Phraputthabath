import sys, zipfile, xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')

def col_to_idx(col_str):
    exp = 0
    idx = 0
    for char in reversed(col_str):
        idx += (ord(char) - ord('A') + 1) * (26 ** exp)
        exp += 1
    return idx - 1

def parse_ref(ref):
    # Splits A1 into 'A', 1
    col = ""
    row = ""
    for c in ref:
        if c.isalpha():
            col += c
        else:
            row += c
    return col_to_idx(col), int(row) - 1

path = r'c:\Users\parinya.the\Production-STEP3-Phraputthabath\Mas Special SKU.xlsx'
with zipfile.ZipFile(path) as z:
    strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        tree = ET.parse(z.open('xl/sharedStrings.xml'))
        for si in tree.getroot().iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t'):
            strings.append(si.text or '')
    tree = ET.parse(z.open('xl/worksheets/sheet1.xml'))
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    
    rows = []
    for row_elem in tree.getroot().iter(ns+'row'):
        row_idx = int(row_elem.get('r')) - 1
        while len(rows) <= row_idx:
            rows.append([])
        
        # We need a list of strings of maximum column size. Let's make it 10 for safety first.
        row_data = [""] * 15
        for c in row_elem.iter(ns+'c'):
            ref = c.get('r')
            col_idx, _ = parse_ref(ref)
            
            t = c.get('t','')
            v = c.find(ns+'v')
            val = v.text if v is not None else ''
            if t == 's': 
                val = strings[int(val)] if val and int(val) < len(strings) else ''
            
            if col_idx < len(row_data):
                row_data[col_idx] = val
            else:
                row_data.extend([""] * (col_idx - len(row_data) + 1))
                row_data[col_idx] = val
        rows[row_idx] = row_data

    # Trim row columns to max column used
    max_cols = max(len(r) for r in rows) if rows else 0
    # Clean trailing empty strings
    for i in range(len(rows)):
        rows[i] = rows[i][:max_cols]

    with open("scratch/special_sku_parsed.txt", "w", encoding="utf-8") as f:
        f.write(f"Total rows: {len(rows)}\n")
        headers = rows[0]
        f.write(f"Headers: {headers}\n")
        for r_idx, r in enumerate(rows[1:]):
            row_str = " | ".join(f"[{c_idx}] {headers[c_idx]}: {val}" for c_idx, val in enumerate(r) if val)
            f.write(f"Row {r_idx + 1}: {row_str}\n")
