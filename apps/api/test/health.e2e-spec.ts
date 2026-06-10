import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Boot the full AppModule (not HealthModule alone): HealthController injects
    // PrismaService + RedisService, which are provided by the @Global()
    // PrismaModule / RedisModule. Importing HealthModule in isolation cannot
    // resolve them ("Nest can't resolve dependencies of the HealthController"),
    // so the app must be wired the way production wires it.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok (DB + Redis reachable)', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.checks).toEqual({ db: 'ok', redis: 'ok' });
  });
});
