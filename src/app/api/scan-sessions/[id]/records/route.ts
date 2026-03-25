import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/scan-sessions/[id]/records — list records for a session
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json([]);

  const { id: sessionId } = await params;

  const { data, error } = await supabase
    .from('scan_records')
    .select('*')
    .eq('session_id', sessionId)
    .order('scanned_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// POST /api/scan-sessions/[id]/records — add scan record(s)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const { id: sessionId } = await params;
  const body = await request.json();

  // Accept single record or array of records (for chain inserts)
  const records: Array<{
    barcode: string;
    quantity: number;
    stock_take_id: string;
    user_name: string;
    store_code?: string;
    chained_from?: string | null;
  }> = Array.isArray(body) ? body : [body];

  const toInsert = records.map(r => ({
    session_id: sessionId,
    stock_take_id: r.stock_take_id,
    barcode: r.barcode,
    quantity: r.quantity,
    scanned_at: new Date().toISOString(),
    user_name: r.user_name,
    store_code: r.store_code || '001',
    chained_from: r.chained_from || null,
  }));

  const { data, error } = await supabase
    .from('scan_records')
    .insert(toInsert)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
