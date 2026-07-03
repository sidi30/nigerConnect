import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { CommunityPricesService } from './community-prices.service';
import {
  createCommunityPriceSchema,
  listCommunityPricesSchema,
  voteCommunityPriceSchema,
} from './dto/rate.dto';

// Redis stub that lets us drive the daily throttle counter deterministically.
const redisWithCount = (count: number) => ({
  incrementCounter: jest.fn(async () => count),
});

describe('CommunityPricesService', () => {
  // ── Zod validation ──────────────────────────────────────────────────────
  it('Zod rejects a non-positive amount and a bad currency code', () => {
    expect(createCommunityPriceSchema.safeParse({ type: 'colis_kg', amount: 0, currency: 'EUR' }).success).toBe(false);
    expect(createCommunityPriceSchema.safeParse({ type: 'colis_kg', amount: 5, currency: 'EU' }).success).toBe(false);
  });

  it('Zod normalises currency + country to upper-case', () => {
    const parsed = createCommunityPriceSchema.safeParse({
      type: 'transfert_argent',
      amount: 5,
      currency: 'eur',
      originCountry: 'fr',
      destCountry: 'ne',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.currency).toBe('EUR');
      expect(parsed.data.originCountry).toBe('FR');
      expect(parsed.data.destCountry).toBe('NE');
    }
  });

  it('Zod vote accepts only 1 or -1', () => {
    expect(voteCommunityPriceSchema.safeParse({ value: 1 }).success).toBe(true);
    expect(voteCommunityPriceSchema.safeParse({ value: -1 }).success).toBe(true);
    expect(voteCommunityPriceSchema.safeParse({ value: 0 }).success).toBe(false);
    expect(voteCommunityPriceSchema.safeParse({ value: 2 }).success).toBe(false);
  });

  // ── Moderation takedown cannot be undone via ?status= (SEC) ───────────────
  // A member-facing listing must never re-surface moderation-removed rows. The
  // list schema pins status to the literal 'active', so an explicit
  // `?status=removed` is rejected (400) rather than served — the only way to see
  // a removed row is the role-gated moderation console (getTarget).
  it('list schema defaults status to active and rejects status=removed', () => {
    const def = listCommunityPricesSchema.safeParse({});
    expect(def.success).toBe(true);
    if (def.success) expect(def.data.status).toBe('active');

    expect(listCommunityPricesSchema.safeParse({ status: 'removed' }).success).toBe(false);
    expect(listCommunityPricesSchema.safeParse({ status: 'active' }).success).toBe(true);
  });

  // ── Anti-spam throttle ──────────────────────────────────────────────────
  it('create derives submitterId from the caller (never the body) and persists', async () => {
    const create = jest.fn(async () => ({ id: 'p1' }));
    const svc = new CommunityPricesService({ communityPrice: { create } } as never, redisWithCount(1) as never);
    await svc.create('me', { type: 'colis_kg', amount: 12, currency: 'EUR' } as never);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ submitterId: 'me', amount: '12', currency: 'EUR' }) }),
    );
  });

  it('the submitter projection is PII-free (no firstName/lastName/city/countryCode)', async () => {
    // BUG-001: a price report must never leak a contributor's real name or
    // coarse location. Assert the Prisma `include` sent for the submitter only
    // selects the safe handle fields.
    const create = jest.fn(async (_args: unknown) => ({ id: 'p1' }));
    const svc = new CommunityPricesService({ communityPrice: { create } } as never, redisWithCount(1) as never);
    await svc.create('me', { type: 'colis_kg', amount: 12, currency: 'EUR' } as never);
    const arg = create.mock.calls[0]![0] as {
      include: { submitter: { select: Record<string, unknown> } };
    };
    const select = arg.include.submitter.select;
    for (const pii of ['firstName', 'lastName', 'city', 'countryCode', 'identityStatus']) {
      expect(select[pii]).toBeUndefined();
    }
    // Still exposes the safe handle fields the UI needs.
    expect(select['id']).toBe(true);
    expect(select['displayName']).toBe(true);
    expect(select['avatarUrl']).toBe(true);
    expect(select['isAmbassador']).toBe(true);
  });

  it('create throttles beyond the daily cap (429) without hitting the DB', async () => {
    const create = jest.fn();
    const svc = new CommunityPricesService({ communityPrice: { create } } as never, redisWithCount(6) as never);
    await expect(
      svc.create('me', { type: 'colis_kg', amount: 12, currency: 'EUR' } as never),
    ).rejects.toBeInstanceOf(HttpException);
    expect(create).not.toHaveBeenCalled();
  });

  // ── AuthZ / IDOR ────────────────────────────────────────────────────────
  it('update by a non-owner is forbidden (no IDOR)', async () => {
    const update = jest.fn();
    const prisma = {
      communityPrice: {
        findUnique: jest.fn(async () => ({ submitterId: 'someone_else' })),
        update,
      },
    };
    const svc = new CommunityPricesService(prisma as never, redisWithCount(1) as never);
    await expect(svc.update('me', 'p1', { amount: 9 } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('delete by a non-owner is forbidden and never hits the DB', async () => {
    const del = jest.fn();
    const prisma = {
      communityPrice: {
        findUnique: jest.fn(async () => ({ submitterId: 'someone_else' })),
        delete: del,
      },
    };
    const svc = new CommunityPricesService(prisma as never, redisWithCount(1) as never);
    await expect(svc.remove('me', 'p1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(del).not.toHaveBeenCalled();
  });

  it('update/delete on an unknown id → 404', async () => {
    const prisma = { communityPrice: { findUnique: jest.fn(async () => null) } };
    const svc = new CommunityPricesService(prisma as never, redisWithCount(1) as never);
    await expect(svc.update('me', 'p1', { amount: 9 } as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.remove('me', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });

  // ── Voting ──────────────────────────────────────────────────────────────
  it('anti-auto-vote: the author cannot vote on their own report (403)', async () => {
    const prisma = {
      communityPrice: { findUnique: jest.fn(async () => ({ submitterId: 'me', status: 'active' })) },
    };
    const svc = new CommunityPricesService(prisma as never, redisWithCount(1) as never);
    await expect(svc.vote('me', 'p1', { value: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cannot vote on removed content (403)', async () => {
    const prisma = {
      communityPrice: { findUnique: jest.fn(async () => ({ submitterId: 'other', status: 'removed' })) },
    };
    const svc = new CommunityPricesService(prisma as never, redisWithCount(1) as never);
    await expect(svc.vote('me', 'p1', { value: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('vote on unknown id → 404', async () => {
    const prisma = { communityPrice: { findUnique: jest.fn(async () => null) } };
    const svc = new CommunityPricesService(prisma as never, redisWithCount(1) as never);
    await expect(svc.vote('me', 'p1', { value: 1 })).rejects.toBeInstanceOf(NotFoundException);
  });

  const voteTx = (existing: { value: number } | null) => {
    const create = jest.fn();
    const del = jest.fn();
    const update = jest.fn();
    const priceUpdate = jest.fn(async () => ({ trustScore: 42 }));
    const tx = {
      communityPriceVote: { findUnique: jest.fn(async () => existing), create, delete: del, update },
      communityPrice: { update: priceUpdate },
    };
    const prisma = {
      communityPrice: { findUnique: jest.fn(async () => ({ submitterId: 'author', status: 'active' })) },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    return { prisma, create, del, update, priceUpdate };
  };

  it('first vote: creates the row and increments trustScore by the value', async () => {
    const { prisma, create, priceUpdate } = voteTx(null);
    const svc = new CommunityPricesService(prisma as never, redisWithCount(1) as never);
    const res = await svc.vote('voter', 'p1', { value: 1 });
    expect(create).toHaveBeenCalledWith({ data: { userId: 'voter', priceId: 'p1', value: 1 } });
    expect(priceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { trustScore: { increment: 1 } } }));
    expect(res.myVote).toBe(1);
  });

  it('revote identical = retract: deletes the row, decrements by the value', async () => {
    const { prisma, del, priceUpdate } = voteTx({ value: 1 });
    const svc = new CommunityPricesService(prisma as never, redisWithCount(1) as never);
    const res = await svc.vote('voter', 'p1', { value: 1 });
    expect(del).toHaveBeenCalled();
    expect(priceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { trustScore: { increment: -1 } } }));
    expect(res.myVote).toBeNull();
  });

  it('flip vote (+1 → -1) applies a delta of -2 in one transaction', async () => {
    const { prisma, update, priceUpdate } = voteTx({ value: 1 });
    const svc = new CommunityPricesService(prisma as never, redisWithCount(1) as never);
    const res = await svc.vote('voter', 'p1', { value: -1 });
    expect(update).toHaveBeenCalled();
    expect(priceUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { trustScore: { increment: -2 } } }));
    expect(res.myVote).toBe(-1);
  });
});
