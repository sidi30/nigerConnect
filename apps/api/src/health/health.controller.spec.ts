import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller';

const makePrisma = (ok: boolean) => ({
  $queryRaw: jest.fn(() =>
    ok ? Promise.resolve([{ '?column?': 1 }]) : Promise.reject(new Error('db down')),
  ),
});
const makeRedis = (ok: boolean) => ({
  client: {
    ping: jest.fn(() => (ok ? Promise.resolve('PONG') : Promise.reject(new Error('redis down')))),
  },
});

describe('HealthController', () => {
  it('/ready returns ok when db + redis are up', async () => {
    const ctrl = new HealthController(makePrisma(true) as never, makeRedis(true) as never);
    const result = await ctrl.ready();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ db: 'ok', redis: 'ok' });
    expect(result.service).toBe('nigerconnect-api');
    expect(typeof result.uptime).toBe('number');
  });

  it('/ready throws 503 when db is down', async () => {
    const ctrl = new HealthController(makePrisma(false) as never, makeRedis(true) as never);
    await expect(ctrl.ready()).rejects.toBeInstanceOf(HttpException);
  });

  it('/ready throws 503 when redis is down', async () => {
    const ctrl = new HealthController(makePrisma(true) as never, makeRedis(false) as never);
    await expect(ctrl.ready()).rejects.toBeInstanceOf(HttpException);
  });

  it('/live always returns ok regardless of deps', async () => {
    const ctrl = new HealthController(makePrisma(false) as never, makeRedis(false) as never);
    const result = ctrl.live();
    expect(result.status).toBe('ok');
    expect(typeof result.uptime).toBe('number');
  });

  it('legacy / preserves the old contract', async () => {
    const ctrl = new HealthController(makePrisma(true) as never, makeRedis(true) as never);
    const result = await ctrl.legacy();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ db: 'ok', redis: 'ok' });
  });
});
