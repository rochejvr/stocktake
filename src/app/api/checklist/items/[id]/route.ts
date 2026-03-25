import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PATCH /api/checklist/items/[id] — sign off or un-sign an item
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { id } = await params;
  const body = await request.json();

  // body: { completed_by, completed_by_id, completed_at, notes } or { clear: true }
  if (body.clear) {
    const { data, error } = await supabase
      .from('checklist_items')
      .update({
        completed_by: null,
        completed_by_id: null,
        completed_at: null,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const updates: Record<string, any> = {};
  if (body.completed_by !== undefined) updates.completed_by = body.completed_by;
  if (body.completed_by_id !== undefined) updates.completed_by_id = body.completed_by_id;
  if (body.completed_at !== undefined) updates.completed_at = body.completed_at;
  if (body.notes !== undefined) updates.notes = body.notes;

  const { data, error } = await supabase
    .from('checklist_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
