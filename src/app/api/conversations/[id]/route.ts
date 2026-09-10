// ============================================================
// DELETE /api/conversations/[id] — permanently delete a conversation.
//
// Closing a conversation (status → 'closed') hides it in the closed
// filter but keeps the row. Agents also need to be able to remove
// badly-created threads entirely so they don't accumulate as garbage.
//
// Deletion order matters: `deals.conversation_id` has no ON DELETE
// clause (migration 001), so deleting a conversation a deal still
// points at would violate the FK. We detach deals first (set their
// conversation_id to NULL — the deal itself is kept), then delete the
// conversation. `messages`, `message_reactions` and `notifications`
// cascade; `flow_runs` and `ai_usage_log` SET NULL.
//
// The contact is left intact — deleting a conversation never deletes
// its contact (they may be shared by deals/tags/other threads).
// ============================================================

import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id } = await params;

    // Verify ownership first — a foreign UUID must 404, not detach
    // deals / attempt a delete against another account's row.
    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (findError) {
      console.error('[conversations/delete] lookup error:', findError);
      return NextResponse.json(
        { error: 'Failed to look up conversation' },
        { status: 500 }
      );
    }
    if (!existing) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    // Detach any deals that reference this thread (FK has no cascade).
    const { error: detachError } = await supabase
      .from('deals')
      .update({ conversation_id: null })
      .eq('conversation_id', id);

    if (detachError) {
      console.error('[conversations/delete] deal detach error:', detachError);
      return NextResponse.json(
        { error: 'Failed to detach linked deals' },
        { status: 500 }
      );
    }

    const { error: deleteError } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);

    if (deleteError) {
      console.error('[conversations/delete] delete error:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete conversation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in conversations delete:', error);
    return toErrorResponse(error);
  }
}
