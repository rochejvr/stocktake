import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const body = await request.json();
  const { reference, name, quarter, year, counting_deadline, recount_deadline, inventory } = body;

  // Check if this reference already exists
  const { data: existing } = await supabase
    .from('stock_takes')
    .select('id, status')
    .eq('reference', reference)
    .maybeSingle();

  let st: { id: string; status: string };
  let isUpdate = false;

  if (existing) {
    // Re-import: replace inventory data for this stock take
    st = existing;
    isUpdate = true;
    await supabase.from('pastel_inventory').delete().eq('stock_take_id', st.id);
  } else {
    // Create new stock take
    const { data: created, error: stErr } = await supabase
      .from('stock_takes')
      .insert({ reference, name, quarter, year, counting_deadline, recount_deadline, created_by: 'admin', status: 'setup' })
      .select()
      .single();
    if (stErr) return NextResponse.json({ error: stErr.message }, { status: 400 });
    st = created;
  }

  // Insert pastel inventory
  const rows001 = (inventory?.store001 || []).map((r: { partNumber: string; description: string; qty: number }) => ({
    stock_take_id: st.id, store_code: '001',
    part_number: r.partNumber, description: r.description, pastel_qty: r.qty,
  }));
  const rows002 = (inventory?.store002 || []).map((r: { partNumber: string; description: string; qty: number }) => ({
    stock_take_id: st.id, store_code: '002',
    part_number: r.partNumber, description: r.description, pastel_qty: r.qty,
  }));

  const allInventoryRows = [...rows001, ...rows002];
  if (allInventoryRows.length > 0) {
    await supabase.from('pastel_inventory').insert(allInventoryRows);
  }

  // Upsert component catalog + validate BOM mapping
  await syncComponentCatalog(inventory?.store001 || [], inventory?.store002 || []);

  // Seed checklist only for new stock takes
  if (!isUpdate) await seedChecklist(st.id);

  return NextResponse.json({ stockTake: st, updated: isUpdate });
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

/**
 * Upsert component descriptions into the permanent catalog,
 * then cross-check bom_mappings — flag any component not in the inventory.
 * Also updates bom_mappings.component_description if changed.
 */
async function syncComponentCatalog(
  store001: { partNumber: string; description: string }[],
  store002: { partNumber: string; description: string }[],
) {
  if (!supabase) return;

  // Build a map of partNumber → description from inventory (prefer 001 over 002)
  const descMap = new Map<string, string>();
  for (const r of [...store002, ...store001]) {
    if (r.partNumber && r.description) descMap.set(r.partNumber, r.description);
  }

  if (descMap.size === 0) return;

  // Upsert into component_catalog
  const catalogRows = Array.from(descMap.entries()).map(([part_number, description]) => ({
    part_number,
    description,
    last_updated_at: new Date().toISOString(),
  }));

  const BATCH = 500;
  for (let i = 0; i < catalogRows.length; i += BATCH) {
    await supabase
      .from('component_catalog')
      .upsert(catalogRows.slice(i, i + BATCH), { onConflict: 'part_number' });
  }

  // Fetch all bom_mappings component codes
  const { data: bomRows } = await supabase
    .from('bom_mappings')
    .select('id, component_code, component_description');

  if (!bomRows?.length) return;

  // For each mapping: update description if changed, flag if missing from inventory
  const updates: { id: string; component_description: string | null; missing_from_inventory: boolean }[] = [];

  for (const row of bomRows) {
    const catalogDesc = descMap.get(row.component_code) ?? null;
    const isMissing = !descMap.has(row.component_code);
    const descChanged = catalogDesc !== row.component_description;

    if (descChanged || isMissing !== false) {
      updates.push({
        id: row.id,
        component_description: catalogDesc,
        missing_from_inventory: isMissing,
      });
    }
  }

  // Batch update
  for (const u of updates) {
    await supabase
      .from('bom_mappings')
      .update({
        component_description: u.component_description,
        missing_from_inventory: u.missing_from_inventory,
      })
      .eq('id', u.id);
  }
}
