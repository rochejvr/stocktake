import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/counters/login — authenticate counter by name + PIN, return or resume session
export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const body = await request.json();
  const { stock_take_id, name, pin, count_number, device_info } = body;

  if (!stock_take_id || !name?.trim() || !pin) {
    return NextResponse.json({ error: 'stock_take_id, name, and pin required' }, { status: 400 });
  }

  // Look up counter
  const { data: counter, error: counterErr } = await supabase
    .from('counters')
    .select('*')
    .eq('stock_take_id', stock_take_id)
    .eq('name', name.trim())
    .eq('pin', pin)
    .eq('is_active', true)
    .maybeSingle();

  if (counterErr) return NextResponse.json({ error: counterErr.message }, { status: 500 });
  if (!counter) return NextResponse.json({ error: 'Invalid name or PIN' }, { status: 401 });

  // Look for existing active (non-submitted) session for this counter
  const { data: existingSession } = await supabase
    .from('scan_sessions')
    .select('*')
    .eq('stock_take_id', stock_take_id)
    .eq('user_name', counter.name)
    .is('submitted_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSession) {
    // Load existing scan records for this session
    const { data: records } = await supabase
      .from('scan_records')
      .select('*')
      .eq('session_id', existingSession.id)
      .order('scanned_at', { ascending: false });

    return NextResponse.json({
      session: existingSession,
      counter,
      records: records || [],
      resumed: true,
    });
  }

  // Create new session
  const cn = count_number || 1;
  const { data: newSession, error: sessErr } = await supabase
    .from('scan_sessions')
    .insert({
      stock_take_id,
      user_id: counter.id,
      user_name: counter.name,
      count_number: cn,
      zone: counter.zone,
      started_at: new Date().toISOString(),
      device_info: device_info || null,
    })
    .select()
    .single();

  if (sessErr) return NextResponse.json({ error: sessErr.message }, { status: 500 });

  return NextResponse.json({
    session: newSession,
    counter,
    records: [],
    resumed: false,
  });
}
