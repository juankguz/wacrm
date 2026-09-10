import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// BSUID send-path tests. Verify that a contact carrying a `whatsapp_user_id`
// is messaged via Meta's `recipient` field (NOT `to`), with no E.164
// sanitization and no phone-variant retry — while a contact with neither
// phone nor BSUID is refused with a clear error.
// ---------------------------------------------------------------------------

const { sendTextMessage } = vi.hoisted(() => ({
  sendTextMessage: vi.fn(async () => ({ messageId: 'wamid-bsuid-1' })),
}));

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage,
  sendTemplateMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
  isLegacyFormat: vi.fn(() => false),
}));

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ['update', 'eq', 'select']) b[m] = vi.fn(chain);
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: null });
      return b;
    },
  }),
}));

import { sendMessageToConversation, SendMessageError } from './send-message';

interface ContactRow {
  id: string;
  account_id: string;
  phone: string;
  whatsapp_user_id?: string | null;
}

let contactRow: ContactRow | null = null;

function makeDb(): SupabaseClient {
  function builder(table: string) {
    let didInsert = false;

    const selectResult = () => {
      switch (table) {
        case 'conversations':
          return {
            data: { id: 'conv-1', account_id: 'acct-1', contact: contactRow },
            error: null,
          };
        case 'whatsapp_config':
          return {
            data: {
              id: 'cfg-1',
              account_id: 'acct-1',
              phone_number_id: 'PNID-1',
              access_token: 'enc-token',
            },
            error: null,
          };
        case 'messages':
          return { data: { id: 'msg-1' }, error: null };
        default:
          return { data: null, error: null };
      }
    };

    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'delete']) {
      b[m] = vi.fn(chain);
    }
    b.insert = vi.fn(() => {
      didInsert = true;
      return b;
    });
    b.single = vi.fn(() => Promise.resolve(selectResult()));
    b.maybeSingle = vi.fn(() => Promise.resolve(selectResult()));
    b.then = (resolve: (v: unknown) => unknown) => resolve(selectResult());
    void didInsert;
    return b;
  }

  return { from: vi.fn((table: string) => builder(table)) } as unknown as SupabaseClient;
}

describe('sendMessageToConversation — BSUID recipient', () => {
  beforeEach(() => {
    sendTextMessage.mockClear();
  });

  it('sends to the BSUID via `recipient` with no phone sanitization or variants', async () => {
    contactRow = {
      id: 'contact-b',
      account_id: 'acct-1',
      phone: '',
      whatsapp_user_id: 'US.13491208655302741918',
    };

    const result = await sendMessageToConversation(makeDb(), 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'text',
      contentText: 'hola',
    });

    expect(result.whatsappMessageId).toBe('wamid-bsuid-1');
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const args = (sendTextMessage.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    // The BSUID goes in `recipient`, `to` is absent — never passed through
    // sanitizePhoneForMeta / phoneVariants.
    expect(args.recipient).toBe('US.13491208655302741918');
    expect(args.to).toBeUndefined();
  });

  it('refuses a contact with neither phone nor BSUID', async () => {
    contactRow = { id: 'contact-x', account_id: 'acct-1', phone: '' };

    await expect(
      sendMessageToConversation(makeDb(), 'acct-1', {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'hola',
      })
    ).rejects.toBeInstanceOf(SendMessageError);

    await sendMessageToConversation(makeDb(), 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'text',
      contentText: 'hola',
    }).catch((e: SendMessageError) => {
      expect(e.status).toBe(400);
      expect(e.message).toMatch(/no usable WhatsApp identity/i);
    });

    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
