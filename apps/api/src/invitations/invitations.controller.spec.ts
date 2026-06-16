/**
 * Security regression — POST /invitations dedicated throttle (gwani-pentest
 * email delta). The per-user quota only bounds concurrent pending invites; a
 * verified user can loop create → revoke → create to fire unbounded invitation
 * emails to arbitrary addresses (spam/mailbomb relay). The route MUST carry an
 * explicit @Throttle so the per-IP global throttle is tightened here.
 *
 * We assert the throttle metadata is present on the handler rather than
 * spinning up the ThrottlerGuard + Redis.
 */
import { InvitationsController } from './invitations.controller';

describe('InvitationsController — POST /invitations throttle', () => {
  it('declares a dedicated @Throttle on the create handler', () => {
    const handler = InvitationsController.prototype.create;
    // Named-throttle metadata is stored per-name: THROTTLER:LIMIT<name>.
    const shortLimit = Reflect.getMetadata('THROTTLER:LIMITshort', handler);
    const longLimit = Reflect.getMetadata('THROTTLER:LIMITlong', handler);
    const longTtl = Reflect.getMetadata('THROTTLER:TTLlong', handler);
    expect(shortLimit).toBeDefined();
    expect(longLimit).toBeDefined();
    // Tight enough to stop bulk abuse: <= 10/min and <= 40/day.
    expect(Number(shortLimit)).toBeLessThanOrEqual(10);
    expect(Number(longLimit)).toBeLessThanOrEqual(40);
    expect(Number(longTtl)).toBeGreaterThanOrEqual(3_600_000); // window >= 1h
  });
});
