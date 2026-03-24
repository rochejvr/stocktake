import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  const { id } = await params;
  await supabase.from('component_chains').delete().eq('id', id);
  return NextResponse.json({ ok: true });
}
