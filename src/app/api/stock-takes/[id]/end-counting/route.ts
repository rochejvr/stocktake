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

  // 2. Get all scan sessions for this count number
  const { data: sessions } = await supabase
    .from('scan_sessions')
    .select('id')
    .eq('stock_take_id', id)
    .eq('count_number', countNumber);

  const sessionIds = (sessions || []).map(s => s.id);

  // Aggregate scan records by barcode+store, split direct vs chain
  // Key format: "barcode|store_code"
  const scanDirect: Record<string, number> = {};
  const scanWip: Record<string, number> = {};
  const scanTotals: Record<string, number> = {};
  if (sessionIds.length > 0) {
    const { data: records } = await supabase
      .from('scan_records')
      .select('barcode, quantity, store_code, chained_from')
      .in('session_id', sessionIds);

    for (const r of (records || [])) {
      const key = `${r.barcode}|${r.store_code || '001'}`;
      const qty = r.quantity;
      scanTotals[key] = (scanTotals[key] || 0) + qty;
      if (r.chained_from) {
        scanWip[key] = (scanWip[key] || 0) + qty;
      } else {
        scanDirect[key] = (scanDirect[key] || 0) + qty;
      }
    }
  }

  // 3. Get all Pastel inventory for this stock take
  const { data: inventory } = await supabase
    .from('pastel_inventory')
    .select('*')
    .eq('stock_take_id', id);

  if (!inventory || inventory.length === 0) {
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

    // For recount: skip items that weren't rescanned — preserve their existing Count 2 data
    if (isRecount && counted === null) continue;

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
      variance_qty: varianceQty,
      variance_pct: variancePct,
    };
    if (!isRecount) {
      row.recount_flagged = recountFlagged;
      row.recount_reasons = recountReasons;
    }
    upserts.push(row);
  }

  // Also add items that were scanned but NOT in Pastel inventory
  for (const [compositeKey, qty] of Object.entries(scanTotals)) {
    if (!matchedKeys.has(compositeKey)) {
      const [barcode, scanStore] = compositeKey.split('|');
      const directCol = isRecount ? 'count2_direct_qty' : 'count1_direct_qty';
      const wipCol = isRecount ? 'count2_wip_qty' : 'count1_wip_qty';
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

  // 5. Mark sessions as submitted so they aren't re-aggregated on next recount
  if (sessionIds.length > 0) {
    await supabase
      .from('scan_sessions')
      .update({ submitted_at: new Date().toISOString() })
      .in('id', sessionIds);
  }

  // 6. Advance status
  const newStatus = (!isRecount && flaggedCount > 0) ? 'recount' : 'reviewing';
  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === 'reviewing') {
    // No extra fields needed
  }

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
