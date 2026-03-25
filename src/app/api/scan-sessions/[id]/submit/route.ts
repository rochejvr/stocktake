import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// PUT /api/scan-sessions/[id]/submit — mark session as submitted
export async function PUT(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!supabase) return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });

  const { id: sessionId } = await params;

  const { data, error } = await supabase
    .from('scan_sessions')
    .update({ submitted_at: new Date().toISOString() })
    .eq('id', sessionId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
