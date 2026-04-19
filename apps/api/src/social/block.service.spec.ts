import { BlockService } from './block.service';

function makeRedis() {
  const store = new Map<string, string>();
  return {
    client: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
      del: jest.fn(async (k: string) => {
        store.delete(k);
        return 1;
      }),
    },
  };
}

describe('BlockService', () => {
  it('self is never blocked', async () => {
    const prisma = { block: { findFirst: jest.fn() } };
    const svc = new BlockService(prisma as never, makeRedis() as never);
    expect(await svc.isBlocked('x', 'x')).toBe(false);
    expect(prisma.block.findFirst).not.toHaveBeenCalled();
  });

  it('uses the same cache key regardless of argument order', async () => {
    const redis = makeRedis();
    const prisma = { block: { findFirst: jest.fn(async () => null) } };
    const svc = new BlockService(prisma as never, redis as never);
    await svc.isBlocked('a', 'b');
    await svc.isBlocked('b', 'a');
    // Only one DB hit because cache key is symmetric
    expect(prisma.block.findFirst).toHaveBeenCalledTimes(1);
  });

  it('removes friendship and upserts block in a transaction', async () => {
    const tx = {
      user: { findUnique: jest.fn(async () => ({ id: 't' })) },
      friendship: { deleteMany: jest.fn(async () => ({ count: 1 })) },
      block: { upsert: jest.fn(async () => ({})) },
    };
    const prisma = {
      $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    };
    const svc = new BlockService(prisma as never, makeRedis() as never);
    await svc.block('me', 't');
    expect(tx.friendship.deleteMany).toHaveBeenCalled();
    expect(tx.block.upsert).toHaveBeenCalled();
  });
});
