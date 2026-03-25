import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/components?search=xxx&active=true
export async function GET(request: NextRequest) {
  if (!supabase) return NextResponse.json([]);

  const search = request.nextUrl.searchParams.get('search') || '';
  const activeOnly = request.nextUrl.searchParams.get('active') !== 'false';

  let query = supabase
    .from('component_catalog')
    .select('part_number, description, active, last_seen_at')
    .order('part_number');

  if (activeOnly) {
    query = query.eq('active', true);
  }

  if (search) {
    query = query.or(`part_number.ilike.%${search}%,description.ilike.%${search}%`);
  }

  const { data, error } = await query.limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}
