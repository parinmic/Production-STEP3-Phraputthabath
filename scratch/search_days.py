import zipfile
import xml.etree.ElementTree as ET
import sys

sys.stdout.reconfigure(encoding='utf-8')

days = ["จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์", "อาทิตย์", "วันหยุด", "หยุด"]

def search_in_file(path):
    print(f"\n=== Searching in {path} ===")
    with zipfile.ZipFile(path) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            tree = ET.parse(z.open('xl/sharedStrings.xml'))
            for si in tree.getroot().iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t'):
                strings.append(si.text or '')
        
        sheet_xmls = [name for name in z.namelist() if name.startswith('xl/worksheets/sheet')]
        for sheet_xml in sheet_xmls:
            tree = ET.parse(z.open(sheet_xml))
            ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
            r_idx = 0
            for row in tree.getroot().iter(ns+'row'):
                c_idx = 0
                for c in row.iter(ns+'c'):
                    t = c.get('t','')
                    v = c.find(ns+'v')
                    val = v.text if v is not None else ''
                    if t == 's': 
                        val = strings[int(val)] if val and int(val) < len(strings) else ''
                    
                    val_str = str(val)
                    for day in days:
                        if day in val_str:
                            print(f"Match '{day}' at Row {r_idx}, Col {c_idx}: {val_str}")
                    c_idx += 1
                r_idx += 1

for name in ['Mas Job Assign สะโพกพิเศษ.xlsx', 'Mas Job Assign สามชั้นพิเศษ.xlsx', 'Mas Job Assign ไหล่พิเศษ.xlsx']:
    search_in_file(name)
