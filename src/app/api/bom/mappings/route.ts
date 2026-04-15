import { NextRequest, NextResponse } from 'next/server';
import { supabase, fetchAll } from '@/lib/supabase';

export async function GET() {
  if (!supabase) return NextResponse.json([]);
  try {
    const data = await fetchAll(
      supabase.from('bom_mappings').select('*').order('wip_code').order('component_code')
    );
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  const body = await request.json();

  // Look up description from catalog if not provided
  if (!body.component_description && body.component_code) {
    const { data: cat } = await supabase
      .from('component_catalog')
      .select('description')
      .eq('part_number', body.component_code)
      .maybeSingle();
    if (cat?.description) body.component_description = cat.description;
  }

  const { data, error } = await supabase.from('bom_mappings').insert(body).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
