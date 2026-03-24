import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  if (!supabase) return NextResponse.json([]);
  const { data } = await supabase.from('component_chains').select('*').order('scanned_code');
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  const body = await request.json();
  const { data, error } = await supabase.from('component_chains').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
