import sys, zipfile, xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')

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
    for row in tree.getroot().iter(ns+'row'):
        cells = []
        for c in row.iter(ns+'c'):
            t = c.get('t','')
            v = c.find(ns+'v')
            val = v.text if v is not None else ''
            if t == 's': val = strings[int(val)] if val and int(val) < len(strings) else ''
            cells.append(val)
        rows.append(cells)

    with open("scratch/special_sku_dump.txt", "w", encoding="utf-8") as f:
        f.write(f"Total rows: {len(rows)}\n")
        if len(rows) > 0:
            headers = rows[0]
            f.write(f"Headers: {headers}\n")
            for r_idx, r in enumerate(rows):
                f.write(f"Row {r_idx}: {r}\n")
