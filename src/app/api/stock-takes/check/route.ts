import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const reference = request.nextUrl.searchParams.get('reference');
  if (!reference || !supabase) return NextResponse.json({ exists: false });

  const { data } = await supabase
    .from('stock_takes')
    .select('id, status')
    .eq('reference', reference)
    .maybeSingle();

  return NextResponse.json({ exists: !!data, status: data?.status ?? null });
}
