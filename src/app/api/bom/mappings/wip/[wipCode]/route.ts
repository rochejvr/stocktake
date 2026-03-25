import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// DELETE /api/bom/mappings/wip/[wipCode] — delete all mappings for a WIP code
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ wipCode: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { wipCode } = await params;

  const { error } = await supabase
    .from('bom_mappings')
    .delete()
    .eq('wip_code', wipCode);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: wipCode });
}
