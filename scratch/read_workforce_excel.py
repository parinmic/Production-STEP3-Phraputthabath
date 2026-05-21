import sys, zipfile, xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')

def check_file(path):
    print(f"\n=== Checking {path} ===")
    with zipfile.ZipFile(path) as z:
        sheet_xmls = [name for name in z.namelist() if name.startswith('xl/worksheets/sheet')]
        print(f"Sheets found: {sheet_xmls}")
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            tree = ET.parse(z.open('xl/sharedStrings.xml'))
            for si in tree.getroot().iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t'):
                strings.append(si.text or '')
        
        for sheet_xml in sheet_xmls:
            print(f"--- Sheet: {sheet_xml} ---")
            tree = ET.parse(z.open(sheet_xml))
            ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
            rows = []
            for row in tree.getroot().iter(ns+'row'):
                cells = []
                for c in row.iter(ns+'c'):
                    t = c.get('t','')
                    v = c.find(ns+'v')
                    val = v.text if v is not None else ''
                    if t == 's': 
                        val = strings[int(val)] if val and int(val) < len(strings) else ''
                    cells.append(val)
                rows.append(cells)

            if len(rows) > 0:
                headers = rows[0]
                print(f'Total rows: {len(rows)}, Columns: {len(headers)}')
                print('All headers in row 0:')
                for i, h in enumerate(headers):
                    print(f'  [{i}] {h}')
                
                # Print row 1 if headers are on row 1 or 2
                if len(rows) > 1:
                    print('Row 1 data:')
                    for i, v in enumerate(rows[1]):
                        print(f'  [{i}] {v}')
            else:
                print("No rows found")

for name in ['Mas Job Assign สะโพกพิเศษ.xlsx', 'Mas Job Assign สามชั้นพิเศษ.xlsx', 'Mas Job Assign ไหล่พิเศษ.xlsx']:
    check_file(name)

