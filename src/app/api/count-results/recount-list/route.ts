import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/count-results/recount-list?stockTakeId=xxx
// Returns flagged items with related WIP codes from bom_mappings
export async function GET(request: NextRequest) {
  if (!supabase) return NextResponse.json([]);

  const stockTakeId = request.nextUrl.searchParams.get('stockTakeId');
  if (!stockTakeId) return NextResponse.json({ error: 'stockTakeId required' }, { status: 400 });

  // Get flagged count results
  const { data: flagged, error } = await supabase
    .from('count_results')
    .select('*')
    .eq('stock_take_id', stockTakeId)
    .eq('recount_flagged', true)
    .order('part_number');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!flagged || flagged.length === 0) return NextResponse.json([]);

  // Get all BOM mappings to find related WIP codes
  const partNumbers = flagged.map(r => r.part_number);
  const { data: bomMappings } = await supabase
    .from('bom_mappings')
    .select('wip_code, component_code, notes')
    .in('component_code', partNumbers);

  // Build WIP lookup: component_code → Set of WIP codes (only actual WIPs, not XM parts)
  const wipLookup: Record<string, Array<{ wip_code: string; notes: string | null }>> = {};
  if (bomMappings) {
    for (const bom of bomMappings) {
      // Only include actual WIP codes — XM parts that contain other XMs are handled as chain parents
      if (bom.wip_code.startsWith('XM')) continue;
      if (!wipLookup[bom.component_code]) wipLookup[bom.component_code] = [];
      if (!wipLookup[bom.component_code].some(w => w.wip_code === bom.wip_code)) {
        wipLookup[bom.component_code].push({ wip_code: bom.wip_code, notes: bom.notes });
      }
    }
  }

  // Also get component chains (scanned_code → also_credit_code)
  const { data: chains } = await supabase
    .from('component_chains')
    .select('scanned_code, also_credit_code')
    .in('also_credit_code', partNumbers);

  const chainLookup: Record<string, string[]> = {};
  if (chains) {
    for (const ch of chains) {
      if (!chainLookup[ch.also_credit_code]) chainLookup[ch.also_credit_code] = [];
      if (!chainLookup[ch.also_credit_code].includes(ch.scanned_code)) {
        chainLookup[ch.also_credit_code].push(ch.scanned_code);
      }
    }
  }

  // Collect chain parent codes that need their own rows
  const chainParentCodes = [...new Set(Object.values(chainLookup).flat())];
  const flaggedPartSet = new Set(partNumbers);
  // Only add parents that aren't already flagged
  const newParentCodes = chainParentCodes.filter(c => !flaggedPartSet.has(c));

  // Get count_results for chain parents so they appear as full rows
  let chainParentRows: typeof flagged = [];
  if (newParentCodes.length > 0) {
    const { data: parentResults } = await supabase
      .from('count_results')
      .select('*')
      .eq('stock_take_id', stockTakeId)
      .in('part_number', newParentCodes);
    chainParentRows = parentResults || [];
  }

  // Get BOM mappings for chain parents too (they have their own WIPs)
  if (newParentCodes.length > 0) {
    const { data: parentBom } = await supabase
      .from('bom_mappings')
      .select('wip_code, component_code, notes')
      .in('component_code', newParentCodes);
    if (parentBom) {
      for (const bom of parentBom) {
        if (bom.wip_code.startsWith('XM')) continue;
        if (!wipLookup[bom.component_code]) wipLookup[bom.component_code] = [];
        if (!wipLookup[bom.component_code].some(w => w.wip_code === bom.wip_code)) {
          wipLookup[bom.component_code].push({ wip_code: bom.wip_code, notes: bom.notes });
        }
      }
    }
  }

  // Collect ALL WIP codes (from flagged + chain parents) for activity lookup
  const allItems = [...flagged, ...chainParentRows];
  const allWipCodes = [...new Set(
    allItems.flatMap(r => (wipLookup[r.part_number] || []).map(w => w.wip_code))
  )];
  const wipCounts: Record<string, number> = {};
  if (allWipCodes.length > 0) {
    const { data: wipResults } = await supabase
      .from('count_results')
      .select('part_number, count1_qty, count2_qty')
      .eq('stock_take_id', stockTakeId)
      .in('part_number', allWipCodes);
    if (wipResults) {
      for (const wr of wipResults) {
        const counted = Math.max(wr.count1_qty ?? 0, wr.count2_qty ?? 0);
        wipCounts[wr.part_number] = (wipCounts[wr.part_number] || 0) + counted;
      }
    }
  }

  // Build enriched list: flagged items + chain parent items
  const enrich = (r: typeof flagged[0], isChainParent = false) => ({
    ...r,
    related_wip_codes: (wipLookup[r.part_number] || []).map(w => ({
      ...w,
      count1_qty: wipCounts[w.wip_code] ?? 0,
    })),
    related_chain_codes: chainLookup[r.part_number] || [],
    is_chain_parent: isChainParent,
  });

  const enriched = [
    ...flagged.map(r => enrich(r, false)),
    ...chainParentRows.map(r => enrich(r, true)),
  ];

  return NextResponse.json(enriched);
}
