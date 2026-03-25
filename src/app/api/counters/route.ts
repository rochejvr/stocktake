import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/counters?stockTakeId=xxx — list counters for a stock take
export async function GET(request: NextRequest) {
  if (!supabase) return NextResponse.json([]);

  const stockTakeId = request.nextUrl.searchParams.get('stockTakeId');
  if (!stockTakeId) return NextResponse.json({ error: 'stockTakeId required' }, { status: 400 });

  const { data, error } = await supabase
    .from('counters')
    .select('*')
    .eq('stock_take_id', stockTakeId)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// POST /api/counters — register a new counter (generates 4-digit PIN)
export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const body = await request.json();
  const { stock_take_id, name, zone } = body;

  if (!stock_take_id || !name?.trim()) {
    return NextResponse.json({ error: 'stock_take_id and name required' }, { status: 400 });
  }

  // Generate unique 4-digit PIN for this stock take
  let pin: string | null = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000)); // 1000-9999
    const { data: existing } = await supabase
      .from('counters')
      .select('id')
      .eq('stock_take_id', stock_take_id)
      .eq('pin', candidate)
      .maybeSingle();

    if (!existing) {
      pin = candidate;
      break;
    }
  }

  if (!pin) {
    return NextResponse.json({ error: 'Could not generate unique PIN' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('counters')
    .insert({
      stock_take_id,
      name: name.trim(),
      pin,
      zone: zone?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Counter name already exists for this stock take' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
