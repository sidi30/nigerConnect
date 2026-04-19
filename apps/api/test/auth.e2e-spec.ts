import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

const strongPassword = 'Str0ng!Password';

function uniqueEmail() {
  return `u_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}@example.com`;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['health'] });
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'u_' } } });
    await app.close();
  });

  it('registers then logs in and refreshes, full rotation', async () => {
    const email = uniqueEmail();
    const server = app.getHttpServer();

    const register = await request(server)
      .post('/api/auth/register')
      .send({ email, password: strongPassword, firstName: 'Al', lastName: 'Ou' })
      .expect(201);
    expect(register.body.tokens.accessToken).toBeDefined();
    expect(register.body.user.passwordHash).toBeUndefined();

    const login = await request(server)
      .post('/api/auth/login')
      .send({ email, password: strongPassword })
      .expect(200);
    expect(login.body.tokens.accessToken).toBeDefined();

    const refreshToken = login.body.tokens.refreshToken;
    const refresh = await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(refresh.body.tokens.refreshToken).not.toBe(refreshToken);

    // Reusing the old refresh should now fail AND revoke all tokens
    await request(server).post('/api/auth/refresh').send({ refreshToken }).expect(401);

    // The new refresh token should also be revoked (reuse detection revokes all)
    await request(server)
      .post('/api/auth/refresh')
      .send({ refreshToken: refresh.body.tokens.refreshToken })
      .expect(401);
  });

  it('rejects weak password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: uniqueEmail(), password: 'weak', firstName: 'A', lastName: 'B' })
      .expect(400);
  });

  it('GET /api/auth/me returns current user with Bearer token', async () => {
    const email = uniqueEmail();
    const register = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: strongPassword, firstName: 'Al', lastName: 'Ou' })
      .expect(201);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${register.body.tokens.accessToken}`)
      .expect(200);

    expect(me.body.user.email).toBe(email);
    expect(me.body.user.passwordHash).toBeUndefined();
  });

  it('GET /api/auth/me without token returns 401', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('rejects login with wrong password', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password: strongPassword, firstName: 'A', lastName: 'B' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Wr0ng!Password' })
      .expect(401);
  });
});
