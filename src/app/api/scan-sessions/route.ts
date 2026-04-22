import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/scan-sessions?stockTakeId=xxx — list sessions with record counts
export async function GET(request: NextRequest) {
  if (!supabase) return NextResponse.json([]);

  const stockTakeId = request.nextUrl.searchParams.get('stockTakeId');
  if (!stockTakeId) return NextResponse.json({ error: 'stockTakeId required' }, { status: 400 });

  const { data: sessions, error } = await supabase
    .from('scan_sessions')
    .select('*')
    .eq('stock_take_id', stockTakeId)
    .order('started_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get record counts per session
  const sessionIds = (sessions || []).map(s => s.id);
  let recordCounts: Record<string, number> = {};

  if (sessionIds.length > 0) {
    // Count only physical scans (exclude auto-generated chain credit records)
    // so the badge matches the displayed record list
    const { data: records } = await supabase
      .from('scan_records')
      .select('session_id')
      .in('session_id', sessionIds)
      .is('chained_from', null);

    if (records) {
      for (const r of records) {
        recordCounts[r.session_id] = (recordCounts[r.session_id] || 0) + 1;
      }
    }
  }

  const enriched = (sessions || []).map(s => ({
    ...s,
    record_count: recordCounts[s.id] || 0,
  }));

  return NextResponse.json(enriched);
}

// POST /api/scan-sessions — create a new scan session
export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const body = await request.json();
  const { stock_take_id, user_name, count_number, zone, device_info } = body;

  if (!stock_take_id || !user_name || !count_number) {
    return NextResponse.json({ error: 'stock_take_id, user_name, count_number required' }, { status: 400 });
  }

  // Get current round from stock take
  const { data: st } = await supabase.from('stock_takes').select('current_round').eq('id', stock_take_id).single();
  const roundNumber = st?.current_round || 1;

  const { data, error } = await supabase
    .from('scan_sessions')
    .insert({
      stock_take_id,
      user_id: crypto.randomUUID(),
      user_name,
      count_number,
      round_number: roundNumber,
      zone: zone || null,
      started_at: new Date().toISOString(),
      device_info: device_info || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
