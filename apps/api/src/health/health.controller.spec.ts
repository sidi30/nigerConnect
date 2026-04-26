import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller';

const makePrisma = (ok: boolean) => ({
  $queryRaw: jest.fn(() => (ok ? Promise.resolve([{ '?column?': 1 }]) : Promise.reject(new Error('db down')))),
});
const makeRedis = (ok: boolean) => ({
  client: { ping: jest.fn(() => (ok ? Promise.resolve('PONG') : Promise.reject(new Error('redis down')))) },
});

describe('HealthController', () => {
  it('returns ok when db + redis are up', async () => {
    const ctrl = new HealthController(makePrisma(true) as never, makeRedis(true) as never);
    const result = await ctrl.check();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ db: 'ok', redis: 'ok' });
    expect(result.service).toBe('nigerconnect-api');
    expect(typeof result.uptime).toBe('number');
  });

  it('throws 503 when db is down', async () => {
    const ctrl = new HealthController(makePrisma(false) as never, makeRedis(true) as never);
    await expect(ctrl.check()).rejects.toBeInstanceOf(HttpException);
  });

  it('throws 503 when redis is down', async () => {
    const ctrl = new HealthController(makePrisma(true) as never, makeRedis(false) as never);
    await expect(ctrl.check()).rejects.toBeInstanceOf(HttpException);
  });
});
