import { ChatGateway } from './chat.gateway';

/**
 * Security regression: the WS handshake must honour the JWT jti blacklist, the
 * same way the REST JwtAuthGuard does. A revoked access token (logout / revoke
 * all sessions) must NOT be allowed to open a chat socket, even though its
 * signature/iss/aud/exp are still otherwise valid.
 *
 * We drive handleConnection() directly with stubbed collaborators and assert
 * that a blacklisted jti results in a disconnect and no presence/room side
 * effects.
 */
describe('ChatGateway — handshake jti revocation', () => {
  function makeSocket() {
    return {
      handshake: { auth: { token: 'valid.jwt.token' }, headers: {}, query: {} },
      join: jest.fn(),
      rooms: new Set<string>(),
      disconnect: jest.fn(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
  }

  function buildGateway(opts: { blacklisted: boolean }) {
    const config = {
      get: (key: string) =>
        key === 'JWT_PUBLIC_KEY_PATH'
          ? // any readable file; the gateway only reads it at construction.
            __filename
          : key === 'JWT_ISSUER'
            ? 'iss'
            : key === 'JWT_AUDIENCE'
              ? 'aud'
              : undefined,
    };
    const jwt = {
      verifyAsync: jest.fn(async () => ({ sub: 'u1', jti: 'jti-1' })),
    };
    const chat = { prisma: { conversationMember: { findMany: jest.fn(async () => []) } } };
    const presence = {
      markOnline: jest.fn(async () => undefined),
      markOfflineDelayed: jest.fn(async () => undefined),
    };
    const redis = {
      isJwtBlacklisted: jest.fn(async () => opts.blacklisted),
    };
    const gw = new ChatGateway(
      config as never,
      jwt as never,
      chat as never,
      presence as never,
      redis as never,
    );
    return { gw, jwt, presence, redis };
  }

  it('disconnects a socket whose jti is blacklisted', async () => {
    const { gw, presence, redis } = buildGateway({ blacklisted: true });
    const socket = makeSocket();
    await gw.handleConnection(socket as never);

    expect(redis.isJwtBlacklisted).toHaveBeenCalledWith('jti-1');
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    // Must not have marked the revoked user online or joined any room.
    expect(presence.markOnline).not.toHaveBeenCalled();
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('admits a socket whose jti is not blacklisted', async () => {
    const { gw, presence, redis } = buildGateway({ blacklisted: false });
    const socket = makeSocket();
    await gw.handleConnection(socket as never);

    expect(redis.isJwtBlacklisted).toHaveBeenCalledWith('jti-1');
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(presence.markOnline).toHaveBeenCalledWith('u1');
  });
});
