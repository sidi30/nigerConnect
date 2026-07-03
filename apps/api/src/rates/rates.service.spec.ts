import { RatesService, EUR_XOF_PEG } from './rates.service';

// Sample matching the ECB eurofxref-daily.xml shape (trimmed to the currencies
// we consume). The parser must be robust to the surrounding markup.
const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope>
  <Cube>
    <Cube time='2026-07-03'>
      <Cube currency='USD' rate='1.0800'/>
      <Cube currency='JPY' rate='170.00'/>
      <Cube currency='CAD' rate='1.4700'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe('RatesService', () => {
  const redisStub = () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() });

  it('parses the ECB feed (time + USD + CAD)', () => {
    const svc = new RatesService({} as never, redisStub() as never);
    expect(svc.parseEcbXml(ECB_XML)).toEqual({ asOf: '2026-07-03', eurUsd: 1.08, eurCad: 1.47 });
  });

  it('skips (returns null) when a required currency is missing — never invents a value', () => {
    const svc = new RatesService({} as never, redisStub() as never);
    const noCad = ECB_XML.replace(/<Cube currency='CAD'[^/]*\/>/, '');
    expect(svc.parseEcbXml(noCad)).toBeNull();
    expect(svc.parseEcbXml('<garbage/>')).toBeNull();
  });

  it('getToday derives USD/CAD from the peg + latest snapshot', async () => {
    const prisma = {
      fxRateSnapshot: {
        findFirst: jest.fn(async () => ({
          asOf: new Date('2026-07-03T00:00:00.000Z'),
          eurUsd: '1.08',
          eurCad: '1.47',
        })),
      },
    };
    const svc = new RatesService(prisma as never, redisStub() as never);
    const today = await svc.getToday();
    expect(today.eurXof).toBe(EUR_XOF_PEG);
    expect(today.usdXof).toBeCloseTo(655.957 / 1.08, 3);
    expect(today.cadXof).toBeCloseTo(655.957 / 1.47, 3);
    expect(today.asOf).toBe('2026-07-03');
    expect(today.source).toBe('ecb');
  });

  it('getToday fail-open: empty table → peg only, source unavailable, no fabricated USD/CAD', async () => {
    const prisma = { fxRateSnapshot: { findFirst: jest.fn(async () => null) } };
    const svc = new RatesService(prisma as never, redisStub() as never);
    const today = await svc.getToday();
    expect(today).toEqual({
      eurXof: EUR_XOF_PEG,
      usdXof: null,
      cadXof: null,
      asOf: null,
      source: 'unavailable',
    });
  });

  it('getBanner serves the Redis cache without touching the DB (cache-first)', async () => {
    const cached = { rates: { eurXof: EUR_XOF_PEG, usdXof: 607, cadXof: 446, asOf: '2026-07-03', source: 'ecb' }, prices: [] };
    const redis = { ...redisStub(), get: jest.fn(async () => JSON.stringify(cached)) };
    const prisma = { communityPrice: { findMany: jest.fn() }, fxRateSnapshot: { findFirst: jest.fn() } };
    const svc = new RatesService(prisma as never, redis as never);
    const banner = await svc.getBanner();
    expect(banner).toEqual(cached);
    expect(prisma.communityPrice.findMany).not.toHaveBeenCalled();
    expect(prisma.fxRateSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('upsertSnapshot is idempotent on the publication day and busts the banner cache', async () => {
    const upsert = jest.fn(async () => ({}));
    const redis = redisStub();
    const svc = new RatesService({ fxRateSnapshot: { upsert } } as never, redis as never);
    await svc.upsertSnapshot({ asOf: '2026-07-03', eurUsd: 1.08, eurCad: 1.47 });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { asOf: new Date('2026-07-03T00:00:00.000Z') } }),
    );
    expect(redis.del).toHaveBeenCalledWith('rates:banner');
  });
});
