import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const body = await request.json();
  const { reference, name, quarter, year, counting_deadline, recount_deadline, inventory } = body;

  // Create stock take
  const { data: st, error: stErr } = await supabase
    .from('stock_takes')
    .insert({ reference, name, quarter, year, counting_deadline, recount_deadline, created_by: 'admin', status: 'setup' })
    .select()
    .single();

  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 400 });

  // Insert pastel inventory
  const rows001 = (inventory?.store001 || []).map((r: { partNumber: string; description: string; qty: number }) => ({
    stock_take_id: st.id, store_code: '001',
    part_number: r.partNumber, description: r.description, pastel_qty: r.qty,
  }));
  const rows002 = (inventory?.store002 || []).map((r: { partNumber: string; description: string; qty: number }) => ({
    stock_take_id: st.id, store_code: '002',
    part_number: r.partNumber, description: r.description, pastel_qty: r.qty,
  }));

  if (rows001.length + rows002.length > 0) {
    await supabase.from('pastel_inventory').insert([...rows001, ...rows002]);
  }

  // Seed checklist items
  await seedChecklist(st.id);

  return NextResponse.json({ stockTake: st });
}

export async function GET() {
  if (!supabase) return NextResponse.json([]);
  const { data } = await supabase.from('stock_takes').select('*').order('created_at', { ascending: false });
  return NextResponse.json(data || []);
}

async function seedChecklist(stockTakeId: string) {
  if (!supabase) return;
  const items = [
    // 48h before
    { phase: '48h', sort_order: 1,  item_text: 'All outstanding GRNs posted to Pastel' },
    { phase: '48h', sort_order: 2,  item_text: 'All goods issues and picking slips posted' },
    { phase: '48h', sort_order: 3,  item_text: 'All WIP job cards updated with materials issued' },
    { phase: '48h', sort_order: 4,  item_text: 'All completed production batches received into finished goods' },
    { phase: '48h', sort_order: 5,  item_text: 'All customer shipments and delivery notes posted' },
    { phase: '48h', sort_order: 6,  item_text: 'All rejected/scrap quantities written off and moved to quarantine' },
    { phase: '48h', sort_order: 7,  item_text: 'Incoming goods during count window identified and held separately' },
    { phase: '48h', sort_order: 8,  item_text: 'Count teams assigned to zones — no overlaps' },
    // 24h before
    { phase: '24h', sort_order: 1,  item_text: 'All stock returned to correct bins — no stock on benches or production floor' },
    { phase: '24h', sort_order: 2,  item_text: 'All WIP gathered to staging area with job cards attached' },
    { phase: '24h', sort_order: 3,  item_text: 'Quarantine area (Store 002) physically segregated and labeled' },
    { phase: '24h', sort_order: 4,  item_text: 'All bins correctly labeled with part numbers and bin codes' },
    { phase: '24h', sort_order: 5,  item_text: 'BOM mapping reviewed and verified against physical WIP bins' },
    { phase: '24h', sort_order: 6,  item_text: 'Mobile devices charged and barcode scanning tested' },
    { phase: '24h', sort_order: 7,  item_text: 'All counting personnel briefed on process' },
    // Day of
    { phase: 'day_of', sort_order: 1, item_text: 'Supervisor walkthrough complete — no unposted overnight movements' },
    { phase: 'day_of', sort_order: 2, item_text: 'All personnel confirmed and zones assigned' },
    { phase: 'day_of', sort_order: 3, item_text: 'Production frozen — no material movements during count window' },
    { phase: 'day_of', sort_order: 4, item_text: 'Clock started and count deadline confirmed with team' },
  ];

  await supabase.from('checklist_items').insert(
    items.map(i => ({ ...i, stock_take_id: stockTakeId }))
  );
}
