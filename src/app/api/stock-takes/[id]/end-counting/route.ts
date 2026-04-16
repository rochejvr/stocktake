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

  // 2. Get scan sessions for this count number.
  // For recounts: use sessions from the LATEST round that actually has sessions.
  // This handles both workflows:
  //  - Proper: counters submit + re-login after reopen → new sessions at current_round
  //  - Resumed: counters log back into old sessions → sessions stay at their original round
  // Either way, we pick the highest round_number that has scan activity.
  let sessionQuery = supabase
    .from('scan_sessions')
    .select('id')
    .eq('stock_take_id', id)
    .eq('count_number', countNumber);

  if (isRecount) {
    const { data: latestRoundRow } = await supabase
      .from('scan_sessions')
      .select('round_number')
      .eq('stock_take_id', id)
      .eq('count_number', countNumber)
      .order('round_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const targetRound = latestRoundRow?.round_number ?? (st.current_round || 1);
    sessionQuery = sessionQuery.eq('round_number', targetRound);
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
  // allowedKeys: when provided (count 2 mode), only accumulate contributions to keys
  // in this set. This prevents WIP-scan explosions in count 2 from overriding count1
  // for XM components that weren't flagged for recount.
  function aggregateRecords(
    records: Array<{ barcode: string; quantity: number; store_code: string; chained_from: string | null; source: string }>,
    direct: Record<string, number>,
    wip: Record<string, number>,
    external: Record<string, number>,
    totals: Record<string, number>,
    allowedKeys?: Set<string>,
  ) {
    const isAllowed = (key: string) => !allowedKeys || allowedKeys.has(key);

    for (const r of records) {
      const store = r.store_code || '001';
      const qty = r.quantity;

      if (r.source === 'external') {
        const key = `${r.barcode}|${store}`;
        if (!isAllowed(key)) continue;
        external[key] = (external[key] || 0) + qty;
        totals[key] = (totals[key] || 0) + qty;
      } else if (r.chained_from) {
        const key = `${r.barcode}|${store}`;
        if (!isAllowed(key)) continue;
        wip[key] = (wip[key] || 0) + qty;
        totals[key] = (totals[key] || 0) + qty;
      } else if (bomLookup[r.barcode.toLowerCase()]) {
        for (const comp of bomLookup[r.barcode.toLowerCase()]) {
          const compKey = `${comp.component_code}|${store}`;
          if (!isAllowed(compKey)) continue;
          const compQty = qty * comp.qty_per_wip;
          wip[compKey] = (wip[compKey] || 0) + compQty;
          totals[compKey] = (totals[compKey] || 0) + compQty;
        }
      } else {
        const key = `${r.barcode}|${store}`;
        if (!isAllowed(key)) continue;
        direct[key] = (direct[key] || 0) + qty;
        totals[key] = (totals[key] || 0) + qty;
      }
    }
  }

  // For recount mode: fetch set of items flagged in count 1, expanded to include
  // chain descendants. Count 2 aggregation is filtered to ONLY update these items —
  // prevents WIP-scan explosions in count 2 from overwriting count1 for unflagged XMs,
  // while still allowing chain children of flagged parents to be updated when the
  // parent is re-scanned.
  // Also: clear ALL count2_* columns at the start of recount aggregation so stale
  // data from previous runs doesn't stick around for items that are no longer in scope.
  let flaggedKeys: Set<string> | undefined;
  if (isRecount) {
    await supabase
      .from('count_results')
      .update({
        count2_qty: null,
        count2_direct_qty: null,
        count2_wip_qty: null,
        count2_external_qty: null,
      })
      .eq('stock_take_id', id);

    const { data: flaggedRows } = await supabase
      .from('count_results')
      .select('part_number, store_code')
      .eq('stock_take_id', id)
      .eq('recount_flagged', true);
    const rows = flaggedRows || [];
    flaggedKeys = new Set(rows.map(r => `${r.part_number}|${r.store_code}`));

    // Expand to include chain descendants of any flagged parent (same store).
    // When parent P is flagged and re-scanned in count 2, its chain credits for
    // children C1/C2 must be in scope — otherwise the recount is incomplete.
    const flaggedParts = [...new Set(rows.map(r => r.part_number))];
    if (flaggedParts.length > 0) {
      const { data: chains } = await supabase
        .from('component_chains')
        .select('scanned_code, also_credit_code')
        .in('scanned_code', flaggedParts);
      if (chains) {
        // Map parent → stores where it's flagged
        const parentStores = new Map<string, Set<string>>();
        for (const r of rows) {
          if (!parentStores.has(r.part_number)) parentStores.set(r.part_number, new Set());
          parentStores.get(r.part_number)!.add(r.store_code);
        }
        for (const ch of chains) {
          const stores = parentStores.get(ch.scanned_code);
          if (stores) {
            for (const store of stores) {
              flaggedKeys.add(`${ch.also_credit_code}|${store}`);
            }
          }
        }
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
    const allRecords = records || [];

    // Expand flaggedKeys: any XM that was directly scanned (or imported as external)
    // in count 2 is an intentional recount action, regardless of its flag status.
    // This prevents the filter from hiding legitimate counter-initiated scans while
    // still blocking WIP-explosion collateral on truly untouched items.
    if (isRecount && flaggedKeys) {
      for (const r of allRecords) {
        const store = r.store_code || '001';
        const key = `${r.barcode}|${store}`;
        // Skip WIP-code scans — those are handled by the filter (only credit flagged
        // components via BOM explosion). Only direct scans / external / chain-credits
        // on the XM itself indicate intent for this specific item.
        const isWipCode = !r.chained_from && !!bomLookup[r.barcode.toLowerCase()];
        if (!isWipCode) {
          flaggedKeys.add(key);
        }
      }
    }

    // In recount mode, filter contributions to flagged items (incl. direct-scan expansion)
    aggregateRecords(allRecords, scanDirect, scanWip, scanExternal, scanTotals, flaggedKeys);
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

    // External supplier stock is offsite and easily forgotten during recount.
    // If a flagged item was physically recounted in count 2 but external was NOT
    // re-imported, carry over the count 1 external value as the default.
    // Counters can still explicitly override by re-importing external in count 2.
    if (flaggedKeys) {
      for (const key of flaggedKeys) {
        const hasPhysicalC2 = (scanDirect[key] || 0) > 0 || (scanWip[key] || 0) > 0;
        const c2External = scanExternal[key] || 0;
        const c1Ext = c1External[key] || 0;
        if (hasPhysicalC2 && c2External === 0 && c1Ext > 0) {
          scanExternal[key] = c1Ext;
          scanTotals[key] = (scanTotals[key] || 0) + c1Ext;
        }
      }
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
  // Flag updates handled separately to avoid mixed-column batch upsert (NOT NULL violation)
  const flagUpdates: Array<{ part_number: string; store_code: string; reason: string }> = [];

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
      // If item was never counted but Pastel has stock, flag for recount (separate update)
      const isUncountedWithStock = c1Total === null && pastelQty > 0;
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
      if (isUncountedWithStock) {
        flagUpdates.push({ part_number: inv.part_number, store_code: inv.store_code, reason: 'uncounted_pastel_balance' });
        flaggedCount++;
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
    } else if (pastelQty > 0) {
      // Item not scanned at all, but Pastel shows stock — flag for recount
      // (variance left as null because the actual quantity is unknown)
      recountReasons.push('uncounted_pastel_balance');
      recountFlagged = true;
      flaggedCount++;
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

  // Apply flag updates separately (avoids mixing schemas in batched upsert)
  for (const fu of flagUpdates) {
    await supabase
      .from('count_results')
      .update({ recount_flagged: true, recount_reasons: [fu.reason] })
      .eq('stock_take_id', id)
      .eq('part_number', fu.part_number)
      .eq('store_code', fu.store_code);
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
