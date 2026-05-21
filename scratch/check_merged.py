import zipfile, xml.etree.ElementTree as ET

path = r'c:\Users\parinya.the\Production-STEP3-Phraputthabath\Mas Special SKU.xlsx'
with zipfile.ZipFile(path) as z:
    # Let's inspect the sheets and merged cells in sheet1.xml
    tree = ET.parse(z.open('xl/worksheets/sheet1.xml'))
    root = tree.getroot()
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    
    merged_cells = []
    for mc in root.iter(ns+'mergeCell'):
        merged_cells.append(mc.get('ref'))
    
    print("Merged cells in sheet1:")
    for mc in merged_cells:
        print(f"  - {mc}")
