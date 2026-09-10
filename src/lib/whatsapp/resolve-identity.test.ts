import { describe, expect, it } from 'vitest';
import {
  resolveWhatsAppIdentity,
  type InboundContactShape,
  type InboundMessageShape,
} from './resolve-identity';

const BSUID = 'US.13491208655302741918';
const PHONE = '16505551234';

function contact(p: Partial<InboundContactShape> = {}): InboundContactShape {
  return { ...p };
}

function message(p: Partial<InboundMessageShape> = {}): InboundMessageShape {
  return { ...p };
}

describe('resolveWhatsAppIdentity', () => {
  it('resolves a BSUID-only identity (username adopter, no phone)', () => {
    const id = resolveWhatsAppIdentity(
      contact({
        user_id: BSUID,
        profile: { name: 'Sheena Nelson', username: 'realsheenanelson' },
      }),
      message({ from_user_id: BSUID }),
    );
    expect(id.whatsappUserId).toBe(BSUID);
    expect(id.phone).toBeNull();
    expect(id.username).toBe('realsheenanelson');
    expect(id.displayName).toBe('Sheena Nelson');
    expect(id.source).toBe('bsuid');
  });

  it('resolves a phone-only identity (legacy, no username)', () => {
    const id = resolveWhatsAppIdentity(
      contact({ wa_id: PHONE, profile: { name: 'Jane' } }),
      message({ from: PHONE }),
    );
    expect(id.whatsappUserId).toBeNull();
    expect(id.phone).toBe(PHONE);
    expect(id.source).toBe('phone');
  });

  it('resolves both identifiers (BSUID + phone present)', () => {
    const id = resolveWhatsAppIdentity(
      contact({ user_id: BSUID, wa_id: PHONE }),
      message({ from: PHONE, from_user_id: BSUID }),
    );
    expect(id.whatsappUserId).toBe(BSUID);
    expect(id.phone).toBe(PHONE);
    expect(id.source).toBe('both');
  });

  it('prefers contacts[].user_id over message.from_user_id for the BSUID', () => {
    const id = resolveWhatsAppIdentity(
      contact({ user_id: 'US.contact', wa_id: PHONE }),
      message({ from_user_id: 'US.message', from: PHONE }),
    );
    expect(id.whatsappUserId).toBe('US.contact');
  });

  it('falls back to message.from_user_id when contacts[].user_id is absent', () => {
    const id = resolveWhatsAppIdentity(
      contact({ profile: { name: 'X' } }),
      message({ from_user_id: BSUID }),
    );
    expect(id.whatsappUserId).toBe(BSUID);
    expect(id.source).toBe('bsuid');
  });

  it('falls back to message.from when wa_id is absent', () => {
    const id = resolveWhatsAppIdentity(contact({}), message({ from: PHONE }));
    expect(id.phone).toBe(PHONE);
  });

  it('returns source unknown and no identifiers when nothing is present', () => {
    const id = resolveWhatsAppIdentity(
      contact({ profile: { name: 'Ghost' } }),
      message({}),
    );
    expect(id.whatsappUserId).toBeNull();
    expect(id.phone).toBeNull();
    expect(id.source).toBe('unknown');
  });

  it('never treats the BSUID as a phone number', () => {
    const id = resolveWhatsAppIdentity(
      contact({ user_id: BSUID }),
      message({ from_user_id: BSUID }),
    );
    expect(id.phone).toBeNull();
    expect(id.whatsappUserId).toBe(BSUID);
  });

  it('handles null contact and message', () => {
    expect(resolveWhatsAppIdentity(null, null).source).toBe('unknown');
  });
});
