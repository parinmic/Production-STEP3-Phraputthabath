const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseSchema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || 'dev';

const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: { schema: supabaseSchema },
});

async function main() {
  const date = '2026-05-19';
  console.log(`Checking data for date: ${date} on schema: ${supabaseSchema}`);

  // Fetch plan 100%
  const { data: plans, error: err1 } = await supabase
    .from('production_plan_100')
    .select('sap, product_name, weight_total')
    .eq('plan_date', date);

  if (err1) {
    console.error('Error fetching plan 100:', err1);
    return;
  }

  // Fetch picking units (bag sizes)
  const { data: pickingUnits } = await supabase
    .from('picking_unit_master')
    .select('sap, weight_per_bag');

  const wpbMap = new Map();
  pickingUnits.forEach(u => {
    wpbMap.set(String(u.sap).trim().replace(/^0+/, ''), u.weight_per_bag);
  });

  // Fetch production assignments
  const { data: assigns, error: err2 } = await supabase
    .from('production_assignments')
    .select('*')
    .eq('production_date', date);

  if (err2) {
    console.error('Error fetching assignments:', err2);
    return;
  }

  console.log('\n--- Plans 100% ---');
  plans.forEach(p => {
    const sap = String(p.sap).replace(/^0+/, '');
    const wpb = wpbMap.get(sap) || 0;
    const bags = wpb > 0 ? p.weight_total / wpb : 0;
    console.log(`SKU: ${sap} | ${p.product_name} | Qty: ${p.weight_total} kg (${bags} bags, bagSize: ${wpb})`);
  });

  console.log('\n--- Production Assignments ---');
  assigns.forEach(a => {
    const sap = String(a.sku).replace(/^0+/, '');
    const wpb = wpbMap.get(sap) || 0;
    const bags = wpb > 0 ? a.target_quantity / wpb : 0;
    console.log(`SKU: ${sap} | ${a.sku_name} | Period: ${a.period} | Qty: ${a.target_quantity} kg (${bags} bags) | Seq: ${a.seq} | Channel: ${a.channel}`);
  });
}

main();
