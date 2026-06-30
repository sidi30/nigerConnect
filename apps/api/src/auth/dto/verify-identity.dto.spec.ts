import { reviewIdentitySchema } from './verify-identity.dto';

describe('reviewIdentitySchema — DOB capture for the 18+ gate', () => {
  const userId = '11111111-1111-1111-1111-111111111111';

  it('rejects an approval without a date of birth', () => {
    const r = reviewIdentitySchema.safeParse({ userId, decision: 'approved' });
    expect(r.success).toBe(false);
  });

  it('accepts an approval with a valid past DOB', () => {
    const r = reviewIdentitySchema.safeParse({
      userId,
      decision: 'approved',
      dateOfBirth: '1995-03-12',
    });
    expect(r.success).toBe(true);
  });

  it('rejects a future date of birth', () => {
    const r = reviewIdentitySchema.safeParse({
      userId,
      decision: 'approved',
      dateOfBirth: '2999-01-01',
    });
    expect(r.success).toBe(false);
  });

  it('does not require a DOB to reject', () => {
    const r = reviewIdentitySchema.safeParse({
      userId,
      decision: 'rejected',
      reason: 'illisible',
    });
    expect(r.success).toBe(true);
  });
});
