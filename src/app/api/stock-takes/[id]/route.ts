import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const VALID_TRANSITIONS: Record<string, string[]> = {
  setup:     ['checklist'],
  checklist: ['counting'],
  counting:  ['recount', 'reviewing'],
  recount:   ['reviewing'],
  reviewing: ['recount', 'complete'],  // recount = reopen counting for another round
};

// PATCH /api/stock-takes/[id] — advance status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const { id } = await params;
  const body = await request.json();
  const { status: newStatus } = body;

  // Get current stock take
  const { data: st, error: fetchErr } = await supabase
    .from('stock_takes')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !st) {
    return NextResponse.json({ error: 'Stock take not found' }, { status: 404 });
  }

  // Validate transition
  const allowed = VALID_TRANSITIONS[st.status] || [];
  if (!allowed.includes(newStatus)) {
    return NextResponse.json(
      { error: `Cannot transition from '${st.status}' to '${newStatus}'. Allowed: ${allowed.join(', ')}` },
      { status: 400 }
    );
  }

  // Build update fields
  const update: Record<string, unknown> = { status: newStatus };
  const now = new Date().toISOString();

  if (newStatus === 'counting') {
    update.started_at = now;
    update.frozen_at = now;
    update.frozen_by = 'admin';
  }
  if (newStatus === 'complete') {
    update.completed_at = now;
  }

  const { data: updated, error: updateErr } = await supabase
    .from('stock_takes')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json(updated);
}
