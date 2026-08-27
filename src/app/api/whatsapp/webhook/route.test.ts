import { describe, expect, it } from 'vitest'
import { parseMessageContent, type WhatsAppMessage } from './route'

// ---------------------------------------------------------------------------
// Unit tests for `parseMessageContent`. The full POST pipeline is exercised
// by integration tests elsewhere; here we focus on the inbound shape →
// internal contract mapping that every downstream consumer (Flows engine,
// automations engine, inbox UI, message.received webhook) depends on.
//
// The `button` case is the new addition — Meta sends
// `message.type === 'button'` with `{ text, payload }` when a customer
// taps a quick-reply button inside one of our templates. We normalize it
// to the same internal contract as `interactive.button_reply` /
// `interactive.list_reply` (contentText + interactiveReplyId).
// ---------------------------------------------------------------------------

// parseMessageContent only calls `getMediaUrl` for media cases (image /
// video / document / audio / sticker). The non-media cases below never
// reach the network, so a fixed token is safe and silences the
// unused-var warning without leaking any real secret.
const TOKEN = 'test-access-token'

function msg(partial: Partial<WhatsAppMessage>): WhatsAppMessage {
  return {
    id: 'wamid-1',
    from: '15551234567',
    timestamp: '1700000000',
    type: 'text',
    ...partial,
  }
}

describe('parseMessageContent — button (template quick-reply)', () => {
  it('uses button.text as contentText and button.payload as interactiveReplyId', async () => {
    const result = await parseMessageContent(
      msg({
        type: 'button',
        button: { text: 'Sí, me interesa', payload: 'interested' },
      }),
      TOKEN,
    )
    expect(result.contentText).toBe('Sí, me interesa')
    expect(result.interactiveReplyId).toBe('interested')
    expect(result.mediaUrl).toBeNull()
    expect(result.mediaType).toBeNull()
  })

  it('falls back to button.payload as contentText when button.text is missing', async () => {
    const result = await parseMessageContent(
      msg({ type: 'button', button: { payload: 'interested' } }),
      TOKEN,
    )
    expect(result.contentText).toBe('interested')
    expect(result.interactiveReplyId).toBe('interested')
  })

  it('falls back to button.payload when button.text is whitespace-only', async () => {
    const result = await parseMessageContent(
      msg({
        type: 'button',
        button: { text: '   ', payload: 'interested' },
      }),
      TOKEN,
    )
    expect(result.contentText).toBe('interested')
    expect(result.interactiveReplyId).toBe('interested')
  })

  it('returns empty defaults when both text and payload are missing', async () => {
    const result = await parseMessageContent(
      msg({ type: 'button', button: {} }),
      TOKEN,
    )
    expect(result.contentText).toBeNull()
    expect(result.interactiveReplyId).toBeNull()
    expect(result.mediaUrl).toBeNull()
    expect(result.mediaType).toBeNull()
  })

  it('returns empty defaults when the button object itself is missing', async () => {
    const result = await parseMessageContent(
      msg({ type: 'button' }),
      TOKEN,
    )
    expect(result.contentText).toBeNull()
    expect(result.interactiveReplyId).toBeNull()
  })
})

describe('parseMessageContent — regression: other message types', () => {
  it('handles text messages', async () => {
    const result = await parseMessageContent(
      msg({ type: 'text', text: { body: 'hola' } }),
      TOKEN,
    )
    expect(result.contentText).toBe('hola')
    expect(result.interactiveReplyId).toBeNull()
  })

  it('keeps existing interactive.button_reply behavior', async () => {
    const result = await parseMessageContent(
      msg({
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'yes', title: 'Yes' },
        },
      }),
      TOKEN,
    )
    expect(result.contentText).toBe('Yes')
    expect(result.interactiveReplyId).toBe('yes')
  })

  it('keeps existing interactive.list_reply behavior', async () => {
    const result = await parseMessageContent(
      msg({
        type: 'interactive',
        interactive: {
          type: 'list_reply',
          list_reply: { id: 'order_1', title: 'Order 1' },
        },
      }),
      TOKEN,
    )
    expect(result.contentText).toBe('Order 1')
    expect(result.interactiveReplyId).toBe('order_1')
  })

  it('falls back to reply id when interactive.title is missing', async () => {
    const result = await parseMessageContent(
      msg({
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'yes', title: '' },
        },
      }),
      TOKEN,
    )
    expect(result.contentText).toBe('yes')
    expect(result.interactiveReplyId).toBe('yes')
  })

  it('returns the legacy "[Interactive reply]" placeholder when no id is present', async () => {
    const result = await parseMessageContent(
      msg({
        type: 'interactive',
        interactive: { type: 'button_reply' },
      }),
      TOKEN,
    )
    expect(result.contentText).toBe('[Interactive reply]')
    expect(result.interactiveReplyId).toBeNull()
  })

  it('formats location messages with name, address and coordinates', async () => {
    const result = await parseMessageContent(
      msg({
        type: 'location',
        location: {
          latitude: 40.4,
          longitude: -3.7,
          name: 'Office',
          address: 'Calle Mayor 1',
        },
      }),
      TOKEN,
    )
    expect(result.contentText).toBe('Office - Calle Mayor 1 - 40.4,-3.7')
    expect(result.interactiveReplyId).toBeNull()
  })

  it('returns reaction emoji as contentText', async () => {
    const result = await parseMessageContent(
      msg({ type: 'reaction', reaction: { message_id: 'wm-1', emoji: '👍' } }),
      TOKEN,
    )
    expect(result.contentText).toBe('👍')
    expect(result.interactiveReplyId).toBeNull()
  })

  it('still returns "[Unsupported message type: foo]" for unknown types', async () => {
    const result = await parseMessageContent(
      msg({ type: 'some_future_type' }),
      TOKEN,
    )
    expect(result.contentText).toBe('[Unsupported message type: some_future_type]')
    expect(result.interactiveReplyId).toBeNull()
  })

  it('returns mediaType for sticker and swallows the Meta verify error', async () => {
    // getMediaUrl will throw (no real Meta), parseMessageContent's helper
    // catches it and returns mediaUrl=null. We only assert the contract:
    // mediaType is preserved and there's no interactiveReplyId.
    const result = await parseMessageContent(
      msg({
        type: 'sticker',
        sticker: { id: 'sid', mime_type: 'image/webp' },
      }),
      TOKEN,
    )
    expect(result.contentText).toBeNull()
    expect(result.mediaType).toBe('image/webp')
    expect(result.mediaUrl).toBeNull()
    expect(result.interactiveReplyId).toBeNull()
  })
})
