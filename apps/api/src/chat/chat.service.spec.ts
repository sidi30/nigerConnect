import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

function makeBlocks(blocked = false) {
  return { isBlocked: jest.fn(async () => blocked) };
}

function makeNotifications() {
  return { create: jest.fn(async () => null) };
}

/**
 * S3 stub. `assertOwnedPublicImage` echoes back a canonical CDN URL by default;
 * pass `reject` to simulate a foreign/unowned URL the real guard would refuse.
 */
function makeS3(reject = false) {
  return {
    assertOwnedPublicImage: jest.fn(async (url: string, ownerId?: string) => {
      if (reject) throw new BadRequestException('Media URL must point to an uploaded file on this platform');
      return `https://cdn.test/users/${ownerId}/photo/canonical.jpg`;
    }),
  };
}

describe('ChatService', () => {
  it('refuses to create conversation with only self', async () => {
    const prisma = { conversation: {}, conversationMember: {}, user: {} } as never;
    const svc = new ChatService(prisma, makeBlocks() as never, makeNotifications() as never, makeS3() as never);
    await expect(svc.createConversation('me', ['me'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to message a conversation when not a member', async () => {
    const prisma = {
      conversationMember: { findUnique: jest.fn(async () => null) },
    } as never;
    const svc = new ChatService(prisma, makeBlocks() as never, makeNotifications() as never, makeS3() as never);
    await expect(svc.sendMessage('me', 'c1', { content: 'x' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns existing direct conversation instead of creating a duplicate', async () => {
    const prisma = {
      user: { findMany: jest.fn(async () => [{ id: 'other' }]) },
      conversation: {
        findFirst: jest.fn(async () => ({ id: 'existing-convo' })),
        create: jest.fn(),
      },
    };
    const svc = new ChatService(prisma as never, makeBlocks() as never, makeNotifications() as never, makeS3() as never);
    const result = await svc.createConversation('me', ['other']);
    expect((result as { id: string }).id).toBe('existing-convo');
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('refuses to delete a message owned by another user', async () => {
    const prisma = {
      message: {
        findUnique: jest.fn(async () => ({ id: 'm1', senderId: 'other', deletedAt: null })),
        update: jest.fn(),
      },
    };
    const svc = new ChatService(prisma as never, makeBlocks() as never, makeNotifications() as never, makeS3() as never);
    await expect(svc.softDeleteMessage('me', 'm1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to delete a message older than the 15-min window', async () => {
    const old = new Date(Date.now() - 16 * 60 * 1000); // 16 min ago
    const prisma = {
      message: {
        findUnique: jest.fn(async () => ({
          id: 'm1',
          senderId: 'me',
          conversationId: 'c1',
          deletedAt: null,
          createdAt: old,
        })),
        update: jest.fn(),
      },
    };
    const svc = new ChatService(prisma as never, makeBlocks() as never, makeNotifications() as never, makeS3() as never);
    await expect(svc.softDeleteMessage('me', 'm1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('refuses to edit a non-editable message type (file)', async () => {
    // Text and image (caption) are editable by design; a 'file' is not.
    const prisma = {
      message: {
        findUnique: jest.fn(async () => ({
          id: 'm1',
          senderId: 'me',
          conversationId: 'c1',
          deletedAt: null,
          createdAt: new Date(),
          messageType: 'file',
        })),
        update: jest.fn(),
      },
    };
    const svc = new ChatService(prisma as never, makeBlocks() as never, makeNotifications() as never, makeS3() as never);
    await expect(svc.editMessage('me', 'm1', 'hi')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('refuses to edit a message older than the 15-min window', async () => {
    const old = new Date(Date.now() - 20 * 60 * 1000);
    const prisma = {
      message: {
        findUnique: jest.fn(async () => ({
          id: 'm1',
          senderId: 'me',
          conversationId: 'c1',
          deletedAt: null,
          createdAt: old,
          messageType: 'text',
        })),
        update: jest.fn(),
      },
    };
    const svc = new ChatService(prisma as never, makeBlocks() as never, makeNotifications() as never, makeS3() as never);
    await expect(svc.editMessage('me', 'm1', 'hi')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('refuses to create conversation with nonexistent participants', async () => {
    const prisma = {
      user: { findMany: jest.fn(async () => []) },
      conversation: { findFirst: jest.fn(), create: jest.fn() },
    };
    const svc = new ChatService(prisma as never, makeBlocks() as never, makeNotifications() as never, makeS3() as never);
    await expect(svc.createConversation('me', ['ghost'])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('refuses to send a message in a direct convo when the peer has blocked the sender', async () => {
    // Membership row exists (the block came AFTER the convo was created),
    // so without the explicit block check the message would have gone
    // through and notified the blocker.
    const prisma = {
      conversationMember: {
        findUnique: jest.fn(async () => ({ userId: 'me' })),
      },
      conversation: {
        findUnique: jest.fn(async () => ({
          type: 'direct',
          members: [{ userId: 'me' }, { userId: 'peer' }],
        })),
      },
      message: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    const svc = new ChatService(
      prisma as never,
      makeBlocks(true) as never,
      makeNotifications() as never,
      makeS3() as never,
    );
    await expect(
      svc.sendMessage('me', 'c1', { content: 'hi' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  // ── mediaUrl host-binding (A01/A10): chat must not persist an arbitrary
  // client-supplied URL. Without binding to our own bucket + the sender's key
  // prefix, a caller could attach an off-platform tracking/SSRF URL that every
  // recipient's client auto-loads, or reference another user's object. ────────
  it('binds a media message URL to the sender via assertOwnedPublicImage and persists the canonical URL', async () => {
    const created = { id: 'msg-1', sender: {} };
    const s3 = makeS3();
    const prisma = {
      conversationMember: {
        findUnique: jest.fn(async () => ({ userId: 'me' })),
        updateMany: jest.fn(),
        findMany: jest.fn(async () => [{ userId: 'me', muted: false }]),
      },
      conversation: {
        findUnique: jest.fn(async () => ({ type: 'group', members: [{ userId: 'me' }] })),
        update: jest.fn(),
      },
      message: { create: jest.fn(async () => created) },
      user: { findUnique: jest.fn(async () => ({ displayName: 'Me' })) },
      $transaction: jest.fn(async () => [created, {}, {}]),
    };
    const svc = new ChatService(prisma as never, makeBlocks() as never, makeNotifications() as never, s3 as never);
    await svc.sendMessage('me', 'c1', {
      messageType: 'image',
      mediaUrl: 'https://attacker.example/track.gif',
    });
    // The guard ran, scoped to the sender, and the CANONICAL url it returned was
    // persisted — never the raw attacker-controlled URL.
    expect(s3.assertOwnedPublicImage).toHaveBeenCalledWith('https://attacker.example/track.gif', 'me');
    const createArg = (prisma.message.create.mock.calls as unknown as Array<[{ data: { mediaUrl: string } }]>)[0]![0];
    expect(createArg.data.mediaUrl).toBe('https://cdn.test/users/me/photo/canonical.jpg');
  });

  it('rejects a media message whose URL is not an owned platform object', async () => {
    const prisma = {
      conversationMember: { findUnique: jest.fn(async () => ({ userId: 'me' })) },
      conversation: { findUnique: jest.fn(async () => ({ type: 'group', members: [{ userId: 'me' }] })) },
      message: { create: jest.fn() },
    };
    const svc = new ChatService(
      prisma as never,
      makeBlocks() as never,
      makeNotifications() as never,
      makeS3(true) as never,
    );
    await expect(
      svc.sendMessage('me', 'c1', { messageType: 'image', mediaUrl: 'https://evil.test/x.jpg' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('refuses to send a media message type with no mediaUrl', async () => {
    const prisma = {
      conversationMember: { findUnique: jest.fn(async () => ({ userId: 'me' })) },
      conversation: { findUnique: jest.fn(async () => ({ type: 'group', members: [{ userId: 'me' }] })) },
      message: { create: jest.fn() },
    };
    const svc = new ChatService(prisma as never, makeBlocks() as never, makeNotifications() as never, makeS3() as never);
    await expect(
      svc.sendMessage('me', 'c1', { messageType: 'image', content: 'caption' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});
