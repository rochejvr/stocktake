import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { assignTier } from '@/lib/constants';

export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const body = await request.json();
  const { reference, name, month, quarter, year, counting_deadline, recount_deadline, inventory } = body;

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
      .insert({ reference, name, quarter: month || quarter, year, counting_deadline, recount_deadline, created_by: 'admin', status: 'setup' })
      .select()
      .single();
    if (stErr) return NextResponse.json({ error: stErr.message }, { status: 400 });
    st = created;
  }

  // Insert pastel inventory
  const rows001 = (inventory?.store001 || []).map((r: { partNumber: string; description: string; qty: number; unitCost?: number | null }) => ({
    stock_take_id: st.id, store_code: '001',
    part_number: r.partNumber, description: r.description, pastel_qty: r.qty,
    unit_cost: r.unitCost ?? null,
    tier: assignTier(r.unitCost ?? null),
  }));
  const rows002 = (inventory?.store002 || []).map((r: { partNumber: string; description: string; qty: number; unitCost?: number | null }) => ({
    stock_take_id: st.id, store_code: '002',
    part_number: r.partNumber, description: r.description, pastel_qty: r.qty,
    unit_cost: r.unitCost ?? null,
    tier: assignTier(r.unitCost ?? null),
  }));

  const allInventoryRows = [...rows001, ...rows002];
  if (allInventoryRows.length > 0) {
    await supabase.from('pastel_inventory').insert(allInventoryRows);
  }

  // Upsert component catalog + validate BOM mapping
  await syncComponentCatalog(inventory?.store001 || [], inventory?.store002 || []);

  // Seed checklist only for new stock takes (uses DB function from migration 004)
  if (!isUpdate) {
    await supabase.rpc('seed_checklist_items', { p_stock_take_id: st.id });
  }

  return NextResponse.json({ stockTake: st, updated: isUpdate });
}

export async function GET() {
  if (!supabase) return NextResponse.json([]);
  const { data } = await supabase.from('stock_takes').select('*').order('created_at', { ascending: false });
  return NextResponse.json(data || []);
}

/**
 * Upsert component descriptions into the permanent catalog,
 * then call sync_bom_descriptions() RPC to update bom_mappings in one shot.
 */
async function syncComponentCatalog(
  store001: { partNumber: string; description: string }[],
  store002: { partNumber: string; description: string }[],
) {
  if (!supabase) return;

  // Build part → description map (prefer store001 over store002)
  const descMap = new Map<string, string>();
  for (const r of [...store002, ...store001]) {
    if (r.partNumber && r.description) descMap.set(r.partNumber, r.description);
  }

  if (descMap.size === 0) return;

  const now = new Date().toISOString();

  // Upsert active parts into component_catalog
  const catalogRows = Array.from(descMap.entries()).map(([part_number, description]) => ({
    part_number,
    description,
    active: true,
    last_seen_at: now,
    last_updated_at: now,
  }));

  const BATCH = 500;
  for (let i = 0; i < catalogRows.length; i += BATCH) {
    const { error } = await supabase
      .from('component_catalog')
      .upsert(catalogRows.slice(i, i + BATCH), { onConflict: 'part_number' });
    if (error) {
      console.error('[syncComponentCatalog] catalog upsert error:', error.message);
      return; // migration likely not run yet
    }
  }

  // Mark parts NOT in this import as inactive (removed from Pastel)
  const activeCodes = Array.from(descMap.keys());
  if (activeCodes.length > 0) {
    await supabase
      .from('component_catalog')
      .update({ active: false })
      .not('part_number', 'in', `(${activeCodes.map(c => `"${c}"`).join(',')})`)
      .eq('active', true);
  }

  // Single RPC call updates all bom_mappings descriptions + missing flags server-side
  const { error: rpcErr } = await supabase.rpc('sync_bom_descriptions');
  if (rpcErr) {
    console.error('[syncComponentCatalog] sync_bom_descriptions RPC error:', rpcErr.message);
  }
}
