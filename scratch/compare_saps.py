import sys, zipfile, xml.etree.ElementTree as ET
sys.stdout.reconfigure(encoding='utf-8')

def get_xlsx_rows(path):
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
            
            row_data = [""] * 15
            for c in row_elem.iter(ns+'c'):
                ref = c.get('r')
                col = "".join(char for char in ref if char.isalpha())
                exp = 0
                col_idx = 0
                for char in reversed(col):
                    col_idx += (ord(char) - ord('A') + 1) * (26 ** exp)
                    exp += 1
                col_idx -= 1
                
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

        max_cols = max(len(r) for r in rows) if rows else 0
        for i in range(len(rows)):
            rows[i] = rows[i][:max_cols]
        return rows

prod_rows = get_xlsx_rows('Mas Productivity.xlsx')
special_rows = get_xlsx_rows('Mas Special SKU.xlsx')

prod_map = {}
for r in prod_rows[1:]:
    if len(r) > 2 and r[2]:
        prod_map[r[2].lstrip('0').strip()] = r

print("Checking empty station SAPs from Special SKU in Mas Productivity:")
for r in special_rows[1:]:
    if len(r) > 2 and r[2]:
        sap = r[2].strip()
        station = r[0].strip() if len(r) > 0 else ""
        if not station:
            match = prod_map.get(sap.lstrip('0'))
            if match:
                print(f"SAP {sap} ({r[3]}): Found in Productivity with station '{match[0]}', group '{match[1]}', rate {match[4]}")
            else:
                print(f"SAP {sap} ({r[3]}): NOT found in Mas Productivity!")
