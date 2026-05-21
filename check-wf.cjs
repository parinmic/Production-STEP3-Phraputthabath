const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(
  'https://jtjironqszdfsflvdvld.supabase.co',
  'sb_publishable_5poaDQcuzIBuWUw2eKuxJw_VFHT-iui'
)

async function main() {
  const today = new Date().toISOString().split('T')[0]
  console.log('Today:', today)
  
  const { data: wf0800 } = await supabase
    .from('daily_workforce')
    .select('emp_id, name, work_station, shift')
    .eq('work_date', today)
    .eq('upload_round', '0800')

  const { data: wf1300 } = await supabase
    .from('daily_workforce')
    .select('emp_id, name, work_station, shift')
    .eq('work_date', today)
    .eq('upload_round', '1300')
    
  console.log(`0800 count: ${wf0800?.length}`)
  console.log(`1300 count: ${wf1300?.length}`)
  
  if (wf1300?.length) {
    console.log('First few 1300:', wf1300.slice(0, 5))
  }
}

main().catch(console.error)
