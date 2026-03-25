import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PATCH /api/scan-records/[id] — update quantity
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const { id } = await params;
  const body = await request.json();
  const { quantity } = body;

  if (typeof quantity !== 'number' || quantity < 0) {
    return NextResponse.json({ error: 'Valid quantity required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('scan_records')
    .update({ quantity })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/scan-records/[id] — delete a scan record
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const { id } = await params;

  const { error } = await supabase
    .from('scan_records')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
