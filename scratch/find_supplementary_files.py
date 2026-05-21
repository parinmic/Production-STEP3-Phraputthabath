import os

search_dir = r'c:\Users\parinya.the\Production-STEP3-Phraputthabath'
for root, dirs, files in os.walk(search_dir):
    for f in files:
        if 'supplementary' in f.lower() or 'slot' in f.lower():
            print(os.path.join(root, f))
