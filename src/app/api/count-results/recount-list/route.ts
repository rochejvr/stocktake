import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/count-results/recount-list?stockTakeId=xxx
// Returns { parts, wips } — two deduplicated lists for the recount
export async function GET(request: NextRequest) {
  if (!supabase) return NextResponse.json({ parts: [], wips: [] });

  const stockTakeId = request.nextUrl.searchParams.get('stockTakeId');
  if (!stockTakeId) return NextResponse.json({ error: 'stockTakeId required' }, { status: 400 });

  // 1. Get flagged count results
  const { data: flagged, error } = await supabase
    .from('count_results')
    .select('*')
    .eq('stock_take_id', stockTakeId)
    .eq('recount_flagged', true)
    .order('part_number');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!flagged || flagged.length === 0) return NextResponse.json({ parts: [], wips: [] });

  // 2. Get BOM mappings for flagged parts → find WIP codes
  const partNumbers = flagged.map(r => r.part_number);
  const { data: bomMappings } = await supabase
    .from('bom_mappings')
    .select('wip_code, component_code')
    .in('component_code', partNumbers);

  // Collect unique WIP codes (exclude XM-to-XM mappings)
  const wipCodeSet = new Set<string>();
  if (bomMappings) {
    for (const bom of bomMappings) {
      if (!bom.wip_code.startsWith('XM')) wipCodeSet.add(bom.wip_code);
    }
  }

  // 3. Get component chains → find chain parent codes
  const { data: chains } = await supabase
    .from('component_chains')
    .select('scanned_code, also_credit_code')
    .in('also_credit_code', partNumbers);

  const chainParentCodes = new Set<string>();
  if (chains) {
    for (const ch of chains) {
      if (!partNumbers.includes(ch.scanned_code)) {
        chainParentCodes.add(ch.scanned_code);
      }
    }
  }

  // 4. Get BOM mappings for chain parents too → more WIPs
  if (chainParentCodes.size > 0) {
    const { data: parentBom } = await supabase
      .from('bom_mappings')
      .select('wip_code, component_code')
      .in('component_code', [...chainParentCodes]);
    if (parentBom) {
      for (const bom of parentBom) {
        if (!bom.wip_code.startsWith('XM')) wipCodeSet.add(bom.wip_code);
      }
    }
  }

  // 5. Get count_results for chain parents
  let chainParentRows: typeof flagged = [];
  if (chainParentCodes.size > 0) {
    const { data: parentResults } = await supabase
      .from('count_results')
      .select('*')
      .eq('stock_take_id', stockTakeId)
      .in('part_number', [...chainParentCodes]);
    chainParentRows = parentResults || [];
  }

  // 6. Get count_results for all WIP codes
  const allWipCodes = [...wipCodeSet];
  let wipResults: Array<{ part_number: string; description: string; store_code: string; pastel_qty: number; count1_qty: number | null; count2_qty: number | null }> = [];
  if (allWipCodes.length > 0) {
    const { data } = await supabase
      .from('count_results')
      .select('part_number, description, store_code, pastel_qty, count1_qty, count2_qty')
      .eq('stock_take_id', stockTakeId)
      .in('part_number', allWipCodes);
    wipResults = data || [];
  }

  // Helper: is item zero across all counts?
  const isAllZero = (r: { pastel_qty: number; count1_qty: number | null; count2_qty: number | null }) =>
    r.pastel_qty === 0 && (r.count1_qty ?? 0) === 0 && (r.count2_qty ?? 0) === 0;

  // 7. Build parts list: flagged + chain parents (exclude zero/zero/zero chain parents)
  const parts = [
    ...flagged.map(r => ({ ...r, is_chain_parent: false })),
    ...chainParentRows
      .filter(r => !isAllZero(r))
      .map(r => ({ ...r, is_chain_parent: true })),
  ];

  // 8. Build deduplicated WIPs list (exclude zero/zero/zero)
  // Group by wip_code+store to deduplicate
  const wipMap = new Map<string, typeof wipResults[0]>();
  for (const wr of wipResults) {
    const key = `${wr.part_number}|${wr.store_code}`;
    if (!wipMap.has(key) && !isAllZero(wr)) {
      wipMap.set(key, wr);
    }
  }
  const wips = [...wipMap.values()].sort((a, b) => a.part_number.localeCompare(b.part_number));

  return NextResponse.json({ parts, wips });
}
