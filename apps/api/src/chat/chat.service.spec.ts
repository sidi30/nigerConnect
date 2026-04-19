import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';

function makeBlocks(blocked = false) {
  return { isBlocked: jest.fn(async () => blocked) };
}

describe('ChatService', () => {
  it('refuses to create conversation with only self', async () => {
    const prisma = { conversation: {}, conversationMember: {}, user: {} } as never;
    const svc = new ChatService(prisma, makeBlocks() as never);
    await expect(svc.createConversation('me', ['me'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to message a conversation when not a member', async () => {
    const prisma = {
      conversationMember: { findUnique: jest.fn(async () => null) },
    } as never;
    const svc = new ChatService(prisma, makeBlocks() as never);
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
    const svc = new ChatService(prisma as never, makeBlocks() as never);
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
    const svc = new ChatService(prisma as never, makeBlocks() as never);
    await expect(svc.softDeleteMessage('me', 'm1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to create conversation with nonexistent participants', async () => {
    const prisma = {
      user: { findMany: jest.fn(async () => []) },
      conversation: { findFirst: jest.fn(), create: jest.fn() },
    };
    const svc = new ChatService(prisma as never, makeBlocks() as never);
    await expect(svc.createConversation('me', ['ghost'])).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
