import { NextRequest, NextResponse } from 'next/server';
import { supabase, fetchAll } from '@/lib/supabase';

// GET /api/count-results/recount-list?stockTakeId=xxx
// Returns { parts, wips } — only items that were ACTUALLY scanned in the original count.
// If a flagged part was counted via a WIP scan, only that specific WIP is listed.
// If it was counted via a chain parent, only that parent is listed.
// We don't list every possible WIP/parent from the BOM — only what contributed.
export async function GET(request: NextRequest) {
  if (!supabase) return NextResponse.json({ parts: [], wips: [] });

  const stockTakeId = request.nextUrl.searchParams.get('stockTakeId');
  if (!stockTakeId) return NextResponse.json({ error: 'stockTakeId required' }, { status: 400 });

  // 1. Get flagged count results (paginate for safety)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let flagged: any[];
  try {
    flagged = await fetchAll(
      supabase.from('count_results').select('*').eq('stock_take_id', stockTakeId).eq('recount_flagged', true).order('part_number')
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
  if (flagged.length === 0) return NextResponse.json({ parts: [], wips: [] });

  const partNumbers = flagged.map(r => r.part_number);

  // 2. Get ALL scan_records for this stock take that relate to flagged parts.
  //    This tells us exactly what was scanned to produce each flagged part's count.

  // 2a. Direct scans + chain credits of flagged parts
  //     (barcode = flagged part, chained_from tells us if it came from a chain parent)
  const { data: directRecords } = await supabase
    .from('scan_records')
    .select('barcode, store_code, chained_from, source')
    .eq('stock_take_id', stockTakeId)
    .in('barcode', partNumbers);

  // 2b. Find WIP codes that contain flagged parts (from BOM)
  const { data: bomMappings } = await supabase
    .from('bom_mappings')
    .select('wip_code, component_code')
    .in('component_code', partNumbers);

  // Build a set of all possible WIP codes for these flagged parts
  const possibleWipCodes = new Set<string>();
  if (bomMappings) {
    for (const bom of bomMappings) {
      if (!bom.wip_code.startsWith('XM')) possibleWipCodes.add(bom.wip_code);
    }
  }

  // 2c. Check which of those WIPs were ACTUALLY scanned
  const actuallyScannedWips = new Set<string>();
  const wipStores = new Map<string, Set<string>>(); // WIP code → set of store codes where it was scanned

  if (possibleWipCodes.size > 0) {
    const { data: wipScans } = await supabase
      .from('scan_records')
      .select('barcode, store_code')
      .eq('stock_take_id', stockTakeId)
      .in('barcode', [...possibleWipCodes])
      .is('chained_from', null);

    if (wipScans) {
      for (const r of wipScans) {
        actuallyScannedWips.add(r.barcode);
        if (!wipStores.has(r.barcode)) wipStores.set(r.barcode, new Set());
        wipStores.get(r.barcode)!.add(r.store_code || '001');
      }
    }
  }

  // 2d. Find chain parents that were ACTUALLY scanned, with the store they were scanned in
  const chainParentStores = new Map<string, Set<string>>(); // parent_code → set of store_codes
  if (directRecords) {
    for (const r of directRecords) {
      if (r.chained_from) {
        if (!chainParentStores.has(r.chained_from)) chainParentStores.set(r.chained_from, new Set());
        chainParentStores.get(r.chained_from)!.add(r.store_code || '001');
      }
    }
  }

  // 3. Get count_results for actual chain parents, filtered to the stores where they were scanned
  let chainParentRows: typeof flagged = [];
  if (chainParentStores.size > 0) {
    const { data: parentResults } = await supabase
      .from('count_results')
      .select('*')
      .eq('stock_take_id', stockTakeId)
      .in('part_number', [...chainParentStores.keys()]);
    // Only include rows where the store matches where the parent was actually scanned
    chainParentRows = (parentResults || []).filter(r => {
      const stores = chainParentStores.get(r.part_number);
      return stores && stores.has(r.store_code);
    });
  }

  // 4. Get descriptions for actually-scanned WIPs
  const actualWipCodes = [...actuallyScannedWips];
  const wipDescriptions: Record<string, string> = {};
  if (actualWipCodes.length > 0) {
    const { data: catalogEntries } = await supabase
      .from('component_catalog')
      .select('item_code, description')
      .in('item_code', actualWipCodes);
    if (catalogEntries) {
      for (const e of catalogEntries) {
        wipDescriptions[e.item_code] = e.description || '';
      }
    }
    // Fallback to bom_mappings description
    const { data: bomDescs } = await supabase
      .from('bom_mappings')
      .select('wip_code, description')
      .in('wip_code', actualWipCodes);
    if (bomDescs) {
      for (const b of bomDescs) {
        if (b.description && !wipDescriptions[b.wip_code]) {
          wipDescriptions[b.wip_code] = b.description;
        }
      }
    }
  }

  // Helper: is item zero across all counts?
  const isAllZero = (r: { pastel_qty: number; count1_qty: number | null; count2_qty: number | null }) =>
    r.pastel_qty === 0 && (r.count1_qty ?? 0) === 0 && (r.count2_qty ?? 0) === 0;

  // 5. Build parts list: flagged parts + actually-scanned chain parents (deduplicated)
  const flaggedIds = new Set(flagged.map(r => r.id));
  const parts = [
    ...flagged.map(r => ({ ...r, is_chain_parent: false })),
    ...chainParentRows
      .filter(r => !isAllZero(r) && !flaggedIds.has(r.id))
      .map(r => ({ ...r, is_chain_parent: true })),
  ];

  // 6. Build WIPs list: only WIPs that were actually scanned
  const wipMap = new Map<string, { part_number: string; description: string; store_code: string; pastel_qty: number; count1_qty: number | null; count2_qty: number | null }>();
  for (const wipCode of actualWipCodes) {
    const stores = wipStores.get(wipCode) || new Set(['001']);
    for (const store of stores) {
      const key = `${wipCode}|${store}`;
      if (!wipMap.has(key)) {
        wipMap.set(key, {
          part_number: wipCode,
          description: wipDescriptions[wipCode] || '',
          store_code: store,
          pastel_qty: 0,
          count1_qty: null,
          count2_qty: null,
        });
      }
    }
  }
  const wips = [...wipMap.values()].sort((a, b) => a.part_number.localeCompare(b.part_number));

  return NextResponse.json({ parts, wips });
}
