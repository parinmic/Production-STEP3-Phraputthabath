const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

let supabase_url = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabase_key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabase_url || !supabase_key) {
  const env = fs.readFileSync('.env.local', 'utf-8');
  for (const line of env.split('\n')) {
    if (line.includes('=')) {
      const [k, v] = line.trim().split('=');
      const cleanVal = v.replace(/['"]/g, '').trim();
      if (k === 'NEXT_PUBLIC_SUPABASE_URL') supabase_url = cleanVal;
      if (k === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') supabase_key = cleanVal;
    }
  }
}

const supabase = createClient(supabase_url, supabase_key);

async function check() {
  const { data, error } = await supabase.from('production_plan_supplementary').select('*').limit(1);
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Data sample:", data);
  }
}

check();
