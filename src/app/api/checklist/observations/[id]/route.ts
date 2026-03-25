import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PATCH /api/checklist/observations/[id] — update an observation
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { id } = await params;
  const body = await request.json();

  const updates: Record<string, any> = {};
  if (body.issue_description !== undefined) updates.issue_description = body.issue_description;
  if (body.corrective_action !== undefined) updates.corrective_action = body.corrective_action;
  if (body.preventive_action !== undefined) updates.preventive_action = body.preventive_action;
  if (body.status !== undefined) updates.status = body.status;

  // If closing, record who/when
  if (body.status === 'closed') {
    updates.closed_by = body.closed_by;
    updates.closed_by_id = body.closed_by_id;
    updates.closed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('checklist_observations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// DELETE /api/checklist/observations/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const { id } = await params;

  const { error } = await supabase
    .from('checklist_observations')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
