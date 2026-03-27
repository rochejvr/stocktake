import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  const { id } = await params;
  const body = await request.json();
  const { data, error } = await supabase.from('component_chains').update(body).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  const { id } = await params;
  await supabase.from('component_chains').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
