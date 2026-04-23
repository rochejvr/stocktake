import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/count-results/[id]/breakdown
// Returns per-counter breakdown of how a count result was composed
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ count1: [], count2: [] });

  const { id } = await params;

  // 1. Get the count_result to find stock_take_id, part_number, store_code + external qtys
  const { data: result, error } = await supabase
    .from('count_results')
    .select('stock_take_id, part_number, store_code, count1_direct_qty, count1_wip_qty, count1_external_qty, count2_direct_qty, count2_wip_qty, count2_external_qty')
    .eq('id', id)
    .single();

  if (error || !result) {
    return NextResponse.json({ error: 'Count result not found' }, { status: 404 });
  }

  const { stock_take_id, part_number, store_code } = result;

  // 2. Get all sessions for this stock take (to map session_id → count_number + user_name)
  const { data: sessions } = await supabase
    .from('scan_sessions')
    .select('id, count_number, user_name, round_number')
    .eq('stock_take_id', stock_take_id);

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ count1: [], count2: [] });
  }

  const sessionMap = new Map(sessions.map(s => [s.id, { countNumber: s.count_number, userName: s.user_name, roundNumber: s.round_number || 1 }]));

  // 3. Get direct scan records for this barcode + store (case-insensitive)
  const { data: directRecords } = await supabase
    .from('scan_records')
    .select('session_id, user_name, quantity, source, chained_from')
    .eq('stock_take_id', stock_take_id)
    .ilike('barcode', part_number)
    .eq('store_code', store_code);

  // 4. Get chain credit records — where this part was credited from a chain scan
  const { data: chainRecords } = await supabase
    .from('scan_records')
    .select('session_id, user_name, quantity, chained_from')
    .eq('stock_take_id', stock_take_id)
    .ilike('barcode', part_number)
    .eq('store_code', store_code)
    .not('chained_from', 'is', null);

  // 5. Get WIP contributions — find WIP codes that contain this part via BOM
  // Case-insensitive component_code match (ilike without wildcards)
  const { data: bomMappings } = await supabase
    .from('bom_mappings')
    .select('wip_code, qty_per_wip')
    .ilike('component_code', part_number);

  let wipRecords: Array<{ session_id: string; user_name: string; quantity: number; barcode: string; qty_per_wip: number }> = [];
  if (bomMappings && bomMappings.length > 0) {
    // Include both canonical and uppercase variants to catch historical uppercase scan_records
    const wipCodeVariants = [...new Set(
      bomMappings.flatMap(b => [b.wip_code, b.wip_code.toUpperCase()])
    )];
    const { data: wipScans } = await supabase
      .from('scan_records')
      .select('session_id, user_name, quantity, barcode')
      .eq('stock_take_id', stock_take_id)
      .eq('store_code', store_code)
      .in('barcode', wipCodeVariants)
      .is('chained_from', null);

    if (wipScans) {
      // Lowercase keys for case-insensitive lookup against scan records
      const bomMap = new Map(bomMappings.map(b => [b.wip_code.toLowerCase(), b.qty_per_wip || 1]));
      wipRecords = wipScans.map(r => ({
        ...r,
        qty_per_wip: bomMap.get(r.barcode.toLowerCase()) || 1,
      }));
    }
  }

  // 6. Compute max round per SOURCE for count 2 contribution types.
  // Channel-aware + source-aware: round replacement is per-source (WIP barcode or
  // chain parent), NOT per-target component. Different WIPs contributing to the same
  // part in different rounds should ALL be included.
  let maxC2RoundDirect = 0;
  let maxC2RoundExt = 0;
  const maxC2RoundPerSource: Record<string, number> = {};
  if (directRecords) {
    for (const r of directRecords) {
      const sess = sessionMap.get(r.session_id);
      if (sess?.countNumber === 2) {
        if (r.source === 'external') {
          maxC2RoundExt = Math.max(maxC2RoundExt, sess.roundNumber);
        } else if (r.chained_from) {
          const srcKey = r.chained_from.toLowerCase();
          maxC2RoundPerSource[srcKey] = Math.max(maxC2RoundPerSource[srcKey] ?? 0, sess.roundNumber);
        } else {
          maxC2RoundDirect = Math.max(maxC2RoundDirect, sess.roundNumber);
        }
      }
    }
  }
  for (const r of wipRecords) {
    const sess = sessionMap.get(r.session_id);
    if (sess?.countNumber === 2) {
      const srcKey = r.barcode.toLowerCase();
      maxC2RoundPerSource[srcKey] = Math.max(maxC2RoundPerSource[srcKey] ?? 0, sess.roundNumber);
    }
  }

  // 7. Aggregate by count_number + user_name
  type Entry = { counter: string; direct: number; wip: number; ext: number; total: number };
  const countMap: Record<1 | 2, Map<string, Entry>> = { 1: new Map(), 2: new Map() };

  function addToCount(sessionId: string, userName: string, qty: number, type: 'direct' | 'wip' | 'ext', sourceKey?: string) {
    const sess = sessionMap.get(sessionId);
    if (!sess) return;
    const cn = sess.countNumber as 1 | 2;
    if (cn === 2) {
      if (type === 'wip' && sourceKey) {
        // WIP/chain: check per-source max round
        const maxRound = maxC2RoundPerSource[sourceKey] ?? 0;
        if (maxRound > 0 && sess.roundNumber < maxRound) return;
      } else {
        const channelMax = type === 'direct' ? maxC2RoundDirect : maxC2RoundExt;
        if (channelMax > 0 && sess.roundNumber < channelMax) return;
      }
    }
    const map = countMap[cn];
    if (!map.has(userName)) {
      map.set(userName, { counter: userName, direct: 0, wip: 0, ext: 0, total: 0 });
    }
    const entry = map.get(userName)!;
    entry[type] += qty;
    entry.total += qty;
  }

  // Direct scans (non-chained, non-external)
  if (directRecords) {
    for (const r of directRecords) {
      if (r.chained_from) continue;
      const type = r.source === 'external' ? 'ext' : 'direct';
      addToCount(r.session_id, r.user_name, Number(r.quantity), type);
    }
  }

  // Chain credits — count as WIP, keyed by source (chained_from) for round check
  if (directRecords) {
    for (const r of directRecords) {
      if (!r.chained_from) continue;
      addToCount(r.session_id, r.user_name, Number(r.quantity), 'wip', r.chained_from.toLowerCase());
    }
  }

  // WIP scan contributions — keyed by source WIP barcode for round check
  for (const r of wipRecords) {
    const creditedQty = Number(r.quantity) * r.qty_per_wip;
    addToCount(r.session_id, r.user_name, creditedQty, 'wip', r.barcode.toLowerCase());
  }

  // Per-channel carry-over: if count2 has stored values for a channel but no
  // matching count 2 scans, the values were auto-carried from count 1 by
  // end-counting. Show them in the breakdown so totals match count_results.
  const c2FromScans = { direct: 0, wip: 0, ext: 0 };
  for (const e of countMap[2].values()) {
    c2FromScans.direct += e.direct;
    c2FromScans.wip += e.wip;
    c2FromScans.ext += e.ext;
  }
  const carried = {
    direct: Math.max(0, (result.count2_direct_qty ?? 0) - c2FromScans.direct),
    wip: Math.max(0, (result.count2_wip_qty ?? 0) - c2FromScans.wip),
    ext: Math.max(0, (result.count2_external_qty ?? 0) - c2FromScans.ext),
  };
  const carriedTotal = carried.direct + carried.wip + carried.ext;
  if (carriedTotal > 0) {
    countMap[2].set('Carried from Count 1', {
      counter: 'Carried from Count 1',
      direct: carried.direct,
      wip: carried.wip,
      ext: carried.ext,
      total: carriedTotal,
    });
  }

  const toArray = (map: Map<string, Entry>) =>
    [...map.values()].sort((a, b) => b.total - a.total);

  return NextResponse.json({
    count1: toArray(countMap[1]),
    count2: toArray(countMap[2]),
  });
}
