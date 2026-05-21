import sys, zipfile, xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')

path = r'c:\Users\parinya.the\Downloads\Wet 5.16.2026.xlsx'
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

    headers = rows[1]
    print(f'Total rows: {len(rows)}, Columns: {len(headers)}')
    print('All columns:')
    for i, h in enumerate(headers):
        print(f'  [{i}] {h}')
    print()
    print('Sample data (row 2):')
    for i, v in enumerate(rows[2]):
        label = headers[i] if i < len(headers) else '?'
        if v:
            print(f'  [{i}] {label} = {v}')
