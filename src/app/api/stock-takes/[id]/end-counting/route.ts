import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { RECOUNT_THRESHOLDS, RECOUNT_ZAR_THRESHOLD, ROUND_NUMBER_MULTIPLES } from '@/lib/constants';

// POST /api/stock-takes/[id]/end-counting
// Aggregates scan records into count_results, flags variances, advances status
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const { id } = await params;

  // 1. Verify stock take is in counting or recount status
  const { data: st, error: stErr } = await supabase
    .from('stock_takes')
    .select('*')
    .eq('id', id)
    .single();

  if (stErr || !st) return NextResponse.json({ error: 'Stock take not found' }, { status: 404 });
  if (st.status !== 'counting' && st.status !== 'recount') {
    return NextResponse.json({ error: `Stock take is in '${st.status}' status, not counting/recount` }, { status: 400 });
  }

  const isRecount = st.status === 'recount';
  const countNumber = isRecount ? 2 : 1;
  const countCol = isRecount ? 'count2_qty' : 'count1_qty';

  // 2. Get scan sessions for this count number
  // For recounts: only use sessions from the current round
  const currentRound = st.current_round || 1;
  let sessionQuery = supabase
    .from('scan_sessions')
    .select('id')
    .eq('stock_take_id', id)
    .eq('count_number', countNumber);

  if (isRecount) {
    sessionQuery = sessionQuery.eq('round_number', currentRound);
  }

  const { data: sessions } = await sessionQuery;
  const sessionIds = (sessions || []).map(s => s.id);

  // Load ALL BOM mappings for WIP explosion (WIP → component parts)
  // Must paginate — Supabase defaults to 1000 row limit
  let bomMappings: Array<{ wip_code: string; component_code: string; qty_per_wip: number }> = [];
  let bomOffset = 0;
  const BOM_PAGE = 1000;
  while (true) {
    const { data: page } = await supabase
      .from('bom_mappings')
      .select('wip_code, component_code, qty_per_wip')
      .range(bomOffset, bomOffset + BOM_PAGE - 1);
    if (!page || page.length === 0) break;
    bomMappings = bomMappings.concat(page);
    if (page.length < BOM_PAGE) break;
    bomOffset += BOM_PAGE;
  }

  // Build bomLookup with lowercase keys for case-insensitive matching against scan_records
  const bomLookup: Record<string, Array<{ component_code: string; qty_per_wip: number }>> = {};
  if (bomMappings) {
    for (const bom of bomMappings) {
      const key = bom.wip_code.toLowerCase();
      if (!bomLookup[key]) bomLookup[key] = [];
      bomLookup[key].push({ component_code: bom.component_code, qty_per_wip: bom.qty_per_wip || 1 });
    }
  }

  // Helper: aggregate scan records into direct/wip/external/totals maps
  function aggregateRecords(
    records: Array<{ barcode: string; quantity: number; store_code: string; chained_from: string | null; source: string }>,
    direct: Record<string, number>,
    wip: Record<string, number>,
    external: Record<string, number>,
    totals: Record<string, number>,
  ) {
    for (const r of records) {
      const store = r.store_code || '001';
      const qty = r.quantity;

      if (r.source === 'external') {
        const key = `${r.barcode}|${store}`;
        external[key] = (external[key] || 0) + qty;
        totals[key] = (totals[key] || 0) + qty;
      } else if (r.chained_from) {
        const key = `${r.barcode}|${store}`;
        wip[key] = (wip[key] || 0) + qty;
        totals[key] = (totals[key] || 0) + qty;
      } else if (bomLookup[r.barcode.toLowerCase()]) {
        for (const comp of bomLookup[r.barcode.toLowerCase()]) {
          const compKey = `${comp.component_code}|${store}`;
          const compQty = qty * comp.qty_per_wip;
          wip[compKey] = (wip[compKey] || 0) + compQty;
          totals[compKey] = (totals[compKey] || 0) + compQty;
        }
      } else {
        const key = `${r.barcode}|${store}`;
        direct[key] = (direct[key] || 0) + qty;
        totals[key] = (totals[key] || 0) + qty;
      }
    }
  }

  // Aggregate scan records by barcode+store, split direct vs WIP vs external
  // Key format: "barcode|store_code"
  const scanDirect: Record<string, number> = {};
  const scanWip: Record<string, number> = {};
  const scanExternal: Record<string, number> = {};
  const scanTotals: Record<string, number> = {};
  if (sessionIds.length > 0) {
    const { data: records } = await supabase
      .from('scan_records')
      .select('barcode, quantity, store_code, chained_from, source')
      .in('session_id', sessionIds);
    aggregateRecords(records || [], scanDirect, scanWip, scanExternal, scanTotals);
  }

  // For recounts: also re-aggregate count1 from count_number=1 sessions
  // This ensures any scans added to count1 sessions after the first end-counting are captured
  const c1Direct: Record<string, number> = {};
  const c1Wip: Record<string, number> = {};
  const c1External: Record<string, number> = {};
  const c1Totals: Record<string, number> = {};
  if (isRecount) {
    const { data: c1Sessions } = await supabase
      .from('scan_sessions')
      .select('id')
      .eq('stock_take_id', id)
      .eq('count_number', 1);
    const c1SessionIds = (c1Sessions || []).map(s => s.id);
    if (c1SessionIds.length > 0) {
      const { data: c1Records } = await supabase
        .from('scan_records')
        .select('barcode, quantity, store_code, chained_from, source')
        .in('session_id', c1SessionIds);
      aggregateRecords(c1Records || [], c1Direct, c1Wip, c1External, c1Totals);
    }
  }

  // 3. Get all Pastel inventory for this stock take (paginate past 1000 row limit)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inventory: Array<any> = [];
  let invOffset = 0;
  const INV_PAGE = 1000;
  while (true) {
    const { data: page } = await supabase
      .from('pastel_inventory')
      .select('*')
      .eq('stock_take_id', id)
      .range(invOffset, invOffset + INV_PAGE - 1);
    if (!page || page.length === 0) break;
    inventory = inventory.concat(page);
    if (page.length < INV_PAGE) break;
    invOffset += INV_PAGE;
  }

  if (inventory.length === 0) {
    return NextResponse.json({ error: 'No inventory data found' }, { status: 400 });
  }

  // 4. Build or update count_results
  let flaggedCount = 0;
  const upserts = [];
  const matchedKeys = new Set<string>();

  for (const inv of inventory) {
    const key = `${inv.part_number}|${inv.store_code}`;
    matchedKeys.add(key);
    const counted = scanTotals[key] ?? null;
    const pastelQty = inv.pastel_qty;
    const tier = (inv.tier || 'C') as 'A' | 'B' | 'C';

    // For recount: items not rescanned in count2 still need count1 refreshed
    if (isRecount && counted === null) {
      // Only update count1 columns (don't touch count2)
      const c1Total = c1Totals[key] ?? null;
      if (c1Total !== null) {
        upserts.push({
          stock_take_id: id,
          part_number: inv.part_number,
          description: inv.description,
          store_code: inv.store_code,
          tier,
          unit_cost: inv.unit_cost,
          pastel_qty: pastelQty,
          count1_qty: c1Total,
          count1_direct_qty: c1Direct[key] ?? null,
          count1_wip_qty: c1Wip[key] ?? null,
          count1_external_qty: c1External[key] ?? null,
        });
        matchedKeys.add(key);
      }
      continue;
    }

    // Calculate variance (only if counted)
    let varianceQty: number | null = null;
    let variancePct: number | null = null;
    let recountFlagged = false;
    const recountReasons: string[] = [];

    if (counted !== null) {
      varianceQty = counted - pastelQty;
      variancePct = pastelQty !== 0 ? (varianceQty / pastelQty) * 100 : (counted !== 0 ? 100 : 0);

      // Flag checks (only on Count 1, or re-flag on Count 2 if still off)
      const absVariancePct = Math.abs(variancePct);
      const threshold = RECOUNT_THRESHOLDS[tier];

      // Variance exceeds tier threshold
      if (absVariancePct > threshold) {
        recountReasons.push('variance_exceeds_threshold');
      }

      // Zero count but Pastel has stock
      if (counted === 0 && pastelQty > 0) {
        recountReasons.push('zero_count_with_pastel_balance');
      }

      // Round number variance
      if (varianceQty !== 0) {
        const absVar = Math.abs(varianceQty);
        if (ROUND_NUMBER_MULTIPLES.some(m => absVar >= m && absVar % m === 0)) {
          recountReasons.push('round_number_variance');
        }
      }

      // Value threshold (if unit_cost available)
      if (inv.unit_cost && Math.abs(varianceQty) * inv.unit_cost > RECOUNT_ZAR_THRESHOLD) {
        if (!recountReasons.includes('variance_exceeds_threshold')) {
          recountReasons.push('variance_exceeds_threshold');
        }
      }

      recountFlagged = recountReasons.length > 0;
      if (recountFlagged) flaggedCount++;
    }

    const directCol = isRecount ? 'count2_direct_qty' : 'count1_direct_qty';
    const wipCol = isRecount ? 'count2_wip_qty' : 'count1_wip_qty';
    const externalCol = isRecount ? 'count2_external_qty' : 'count1_external_qty';

    const row: Record<string, unknown> = {
      stock_take_id: id,
      part_number: inv.part_number,
      description: inv.description,
      store_code: inv.store_code,
      tier,
      unit_cost: inv.unit_cost,
      pastel_qty: pastelQty,
      [countCol]: counted,
      [directCol]: scanDirect[key] ?? null,
      [wipCol]: scanWip[key] ?? null,
      [externalCol]: scanExternal[key] ?? null,
      variance_qty: varianceQty,
      variance_pct: variancePct,
    };
    if (!isRecount) {
      row.recount_flagged = recountFlagged;
      row.recount_reasons = recountReasons;
    }
    // During recount: also refresh count1 data from count_number=1 sessions
    // This captures any scans added to count1 sessions after the first end-counting
    if (isRecount) {
      const c1Total = c1Totals[key] ?? null;
      row.count1_qty = c1Total;
      row.count1_direct_qty = c1Direct[key] ?? null;
      row.count1_wip_qty = c1Wip[key] ?? null;
      row.count1_external_qty = c1External[key] ?? null;
    }
    upserts.push(row);
  }

  // Also add items that were scanned but NOT in Pastel inventory
  for (const [compositeKey, qty] of Object.entries(scanTotals)) {
    if (!matchedKeys.has(compositeKey)) {
      const [barcode, scanStore] = compositeKey.split('|');
      const directCol = isRecount ? 'count2_direct_qty' : 'count1_direct_qty';
      const wipCol = isRecount ? 'count2_wip_qty' : 'count1_wip_qty';
      const externalCol = isRecount ? 'count2_external_qty' : 'count1_external_qty';
      const extraRow: Record<string, unknown> = {
        stock_take_id: id,
        part_number: barcode,
        description: '',
        store_code: scanStore || '001',
        tier: 'C',
        unit_cost: null,
        pastel_qty: 0,
        [countCol]: qty,
        [directCol]: scanDirect[compositeKey] ?? null,
        [wipCol]: scanWip[compositeKey] ?? null,
        [externalCol]: scanExternal[compositeKey] ?? null,
        variance_qty: qty,
        variance_pct: 100,
      };
      if (!isRecount) {
        extraRow.recount_flagged = true;
        extraRow.recount_reasons = ['zero_count_with_pastel_balance'];
      }
      upserts.push(extraRow);
      if (!isRecount) flaggedCount++;
    }
  }

  // Upsert in batches
  const BATCH_SIZE = 200;
  for (let i = 0; i < upserts.length; i += BATCH_SIZE) {
    const batch = upserts.slice(i, i + BATCH_SIZE);
    const { error: upsertErr } = await supabase
      .from('count_results')
      .upsert(batch, { onConflict: 'stock_take_id,part_number,store_code' });

    if (upsertErr) {
      return NextResponse.json({ error: `Failed to save results: ${upsertErr.message}` }, { status: 500 });
    }
  }

  // 5. Advance status
  const newStatus = (!isRecount && flaggedCount > 0) ? 'recount' : 'reviewing';
  const update: Record<string, unknown> = { status: newStatus };

  const { error: statusErr } = await supabase
    .from('stock_takes')
    .update(update)
    .eq('id', id);

  if (statusErr) {
    return NextResponse.json({ error: `Failed to update status: ${statusErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    status: newStatus,
    totalParts: inventory.length,
    countedParts: Object.keys(scanTotals).length,
    flaggedForRecount: flaggedCount,
    uncounted: inventory.length - Object.keys(scanTotals).length,
  });
}
