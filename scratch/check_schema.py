import os
from supabase import create_client

supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
supabase_key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")

if not supabase_url or not supabase_key:
    # Read from .env.local
    with open(".env.local", "r") as f:
        for line in f:
            if "=" in line:
                k, v = line.strip().split("=", 1)
                if k == "NEXT_PUBLIC_SUPABASE_URL":
                    supabase_url = v.strip('"').strip("'")
                elif k == "NEXT_PUBLIC_SUPABASE_ANON_KEY":
                    supabase_key = v.strip('"').strip("'")

client = create_client(supabase_url, supabase_key)
# Let's get one row to inspect fields
res = client.table("production_plan_supplementary").select("*").limit(1).execute()
print("Data sample:", res.data)
