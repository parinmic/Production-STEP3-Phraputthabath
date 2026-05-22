import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

url = "http://localhost:3000/api/production/generate"
payload = {
    "date": "2026-05-20",
    "phase": 1,
    "deductMode": "plan"
}

req = urllib.request.Request(
    url,
    data=json.dumps(payload).encode('utf-8'),
    headers={"Content-Type": "application/json"},
    method="POST"
)

try:
    with urllib.request.urlopen(req) as res:
        print(f"Status: {res.status}")
        print(res.read().decode('utf-8'))
except Exception as e:
    print(f"Error calling local API: {e}")
    if hasattr(e, 'read'):
        print(e.read().decode('utf-8'))
