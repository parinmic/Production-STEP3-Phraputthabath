import os

search_dir = r'c:\Users\parinya.the\Production-STEP3-Phraputthabath'
for root, dirs, files in os.walk(search_dir):
    for f in files:
        if f.endswith('.ts') or f.endswith('.tsx'):
            path = os.path.join(root, f)
            with open(path, 'r', encoding='utf-8', errors='ignore') as file:
                content = file.read()
                if 'production_plan_supplementary' in content:
                    print(f"File: {path}")
                    for idx, line in enumerate(content.split('\n')):
                        if 'production_plan_supplementary' in line or 'select(' in line or 'insert(' in line:
                            print(f"  Line {idx+1}: {line.strip()}")
