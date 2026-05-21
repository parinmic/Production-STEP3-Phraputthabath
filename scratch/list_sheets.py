import zipfile, xml.etree.ElementTree as ET

path = r'c:\Users\parinya.the\Production-STEP3-Phraputthabath\Mas Special SKU.xlsx'
with zipfile.ZipFile(path) as z:
    # Read workbook.xml to get sheet names
    wb_tree = ET.parse(z.open('xl/workbook.xml'))
    wb_root = wb_tree.getroot()
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    
    sheets = []
    for sheet in wb_root.iter(ns+'sheet'):
        sheets.append((sheet.get('name'), sheet.get('sheetId'), sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')))
    
    print("Worksheets in workbook:")
    for name, s_id, r_id in sheets:
        print(f"  - Name: {name}, SheetId: {s_id}, RelId: {r_id}")
