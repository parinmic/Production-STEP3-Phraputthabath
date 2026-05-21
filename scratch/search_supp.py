with open(r'c:\Users\parinya.the\Production-STEP3-Phraputthabath\app\api\production\generate-supplementary\route.ts', 'r', encoding='utf-8') as f:
    for idx, line in enumerate(f):
        if 'assign' in line or 'worker' in line:
            print(f"Line {idx+1}: {line.strip()}")
