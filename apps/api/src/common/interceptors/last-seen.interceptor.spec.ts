import { of, lastValueFrom, throwError } from 'rxjs';
import { LastSeenInterceptor } from './last-seen.interceptor';

function makeContext(user?: { sub: string }) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

function makeDeps(setResult: 'OK' | null = 'OK') {
  const redis = { client: { set: jest.fn(async () => setResult) } };
  const prisma = { $executeRaw: jest.fn(async () => 1) };
  return { redis, prisma };
}

/** Lets the fire-and-forget `void this.stamp(...)` microtask settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('LastSeenInterceptor', () => {
  it('stamps last_seen_at when the Redis throttle key is free', async () => {
    const { redis, prisma } = makeDeps('OK');
    const interceptor = new LastSeenInterceptor(prisma as never, redis as never);

    await lastValueFrom(
      interceptor.intercept(makeContext({ sub: 'u1' }), { handle: () => of('ok') } as never),
    );
    await flush();

    expect(redis.client.set).toHaveBeenCalledWith('lastseen:u1', '1', 'EX', 3600, 'NX');
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('skips the write while the hourly window is still held', async () => {
    const { redis, prisma } = makeDeps(null);
    const interceptor = new LastSeenInterceptor(prisma as never, redis as never);

    await lastValueFrom(
      interceptor.intercept(makeContext({ sub: 'u1' }), { handle: () => of('ok') } as never),
    );
    await flush();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('ignores anonymous traffic', async () => {
    const { redis, prisma } = makeDeps('OK');
    const interceptor = new LastSeenInterceptor(prisma as never, redis as never);

    await lastValueFrom(
      interceptor.intercept(makeContext(undefined), { handle: () => of('ok') } as never),
    );
    await flush();

    expect(redis.client.set).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not stamp a failed request', async () => {
    const { redis, prisma } = makeDeps('OK');
    const interceptor = new LastSeenInterceptor(prisma as never, redis as never);

    await expect(
      lastValueFrom(
        interceptor.intercept(makeContext({ sub: 'u1' }), {
          handle: () => throwError(() => new Error('boom')),
        } as never),
      ),
    ).rejects.toThrow('boom');
    await flush();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('never lets a telemetry failure reach the caller', async () => {
    const redis = {
      client: {
        set: jest.fn(async () => {
          throw new Error('redis down');
        }),
      },
    };
    const prisma = { $executeRaw: jest.fn(async () => 1) };
    const interceptor = new LastSeenInterceptor(prisma as never, redis as never);

    await expect(
      lastValueFrom(
        interceptor.intercept(makeContext({ sub: 'u1' }), { handle: () => of('ok') } as never),
      ),
    ).resolves.toBe('ok');
    await flush();

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
