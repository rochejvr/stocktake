import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/checklist/observations — create a new observation
export async function POST(request: NextRequest) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const body = await request.json();
  const {
    stock_take_id,
    checklist_item_id,
    phase,
    department,
    issue_description,
    corrective_action,
    preventive_action,
    reported_by,
    reported_by_id,
  } = body;

  if (!stock_take_id || !issue_description || !reported_by) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('checklist_observations')
    .insert({
      stock_take_id,
      checklist_item_id: checklist_item_id || null,
      phase,
      department,
      issue_description,
      corrective_action: corrective_action || null,
      preventive_action: preventive_action || null,
      reported_by,
      reported_by_id: reported_by_id || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
