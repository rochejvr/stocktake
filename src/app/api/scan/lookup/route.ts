import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET /api/scan/lookup?barcode=XXX&stockTakeId=YYY
// Returns part info if barcode is a valid Pastel part or BOM WIP code
export async function GET(request: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ barcode: '', description: null, found: false, valid: false });
  }

  const barcode = request.nextUrl.searchParams.get('barcode')?.trim();
  const stockTakeId = request.nextUrl.searchParams.get('stockTakeId');

  if (!barcode) {
    return NextResponse.json({ error: 'barcode required' }, { status: 400 });
  }

  // 1. Check pastel_inventory for current stock take
  if (stockTakeId) {
    // Case-insensitive match; return canonical casing from DB
    const { data: pastelMatch } = await supabase
      .from('pastel_inventory')
      .select('part_number, description')
      .eq('stock_take_id', stockTakeId)
      .ilike('part_number', barcode)
      .limit(1)
      .maybeSingle();

    if (pastelMatch) {
      return NextResponse.json({
        barcode: pastelMatch.part_number,
        description: pastelMatch.description,
        found: true,
        valid: true,
        source: 'pastel_inventory',
      });
    }
  }

  // 2. Check bom_mappings — barcode might be a WIP code
  const { data: bomMatch } = await supabase
    .from('bom_mappings')
    .select('wip_code, notes')
    .ilike('wip_code', barcode)
    .limit(1)
    .maybeSingle();

  if (bomMatch) {
    return NextResponse.json({
      barcode: bomMatch.wip_code,
      description: bomMatch.notes || `WIP: ${bomMatch.wip_code}`,
      found: true,
      valid: true,
      source: 'bom_mappings',
    });
  }

  // 3. Not in Pastel or BOM — invalid for counting
  return NextResponse.json({
    barcode,
    description: null,
    found: false,
    valid: false,
  });
}
