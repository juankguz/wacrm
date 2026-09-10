// ============================================================
// WhatsApp inbound identity resolution (BSUID + phone).
//
// Meta's username rollout means a webhook may arrive with NO phone
// number: `message.from` and `contacts[].wa_id` can both be omitted.
// The stable identity is the Business-scoped User ID (BSUID), sent as
// `contacts[].user_id` / `message.from_user_id` (e.g.
// `US.13491208655302741918`).
//
// This module resolves the raw webhook fields into a single identity
// object WITHOUT touching the DB, so the webhook and tests can use it
// as a pure function. The phone path (normalization, E.164, variants,
// dedupe) lives elsewhere and is unchanged.
//
// Priority (per Meta's docs and the migration 037 design):
//   BSUID  = contacts[].user_id || message.from_user_id
//   phone  = message.from || contacts[].wa_id        (both optional)
//   username = contacts[].profile.username
//   displayName = contacts[].profile.name
//
// `source` reports which identifiers were present:
//   'bsuid' | 'phone' | 'both' | 'unknown'
// ============================================================

export interface InboundContactShape {
  user_id?: string | null;
  wa_id?: string | null;
  profile?: {
    name?: string | null;
    username?: string | null;
  } | null;
}

export interface InboundMessageShape {
  from?: string | null;
  from_user_id?: string | null;
}

export interface ResolvedWhatsAppIdentity {
  /** Business-scoped User ID (BSUID), or null when absent. */
  whatsappUserId: string | null;
  /** Phone number as delivered by Meta, or null when omitted. */
  phone: string | null;
  /** Username, when the user adopted one. */
  username: string | null;
  /** WhatsApp profile display name. */
  displayName: string | null;
  source: 'bsuid' | 'phone' | 'both' | 'unknown';
}

/**
 * Resolve the WhatsApp identity from an inbound contact + message.
 * Pure — no side effects. The caller decides how to map the result
 * onto find-or-create contact logic.
 */
export function resolveWhatsAppIdentity(
  contact: InboundContactShape | undefined | null,
  message: InboundMessageShape | undefined | null,
): ResolvedWhatsAppIdentity {
  const whatsappUserId =
    (contact?.user_id && contact.user_id.trim()) ||
    (message?.from_user_id && message.from_user_id.trim()) ||
    null;

  const phone =
    (message?.from && message.from.trim()) ||
    (contact?.wa_id && contact.wa_id.trim()) ||
    null;

  const username =
    (contact?.profile?.username && contact.profile.username.trim()) || null;
  const displayName =
    (contact?.profile?.name && contact.profile.name.trim()) || null;

  const source: ResolvedWhatsAppIdentity['source'] = whatsappUserId
    ? phone
      ? 'both'
      : 'bsuid'
    : phone
      ? 'phone'
      : 'unknown';

  return { whatsappUserId, phone, username, displayName, source };
}
