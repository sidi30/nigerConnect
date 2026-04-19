import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes a password and verifies it', async () => {
    const hash = await service.hash('Str0ng!Password');
    expect(hash).toContain('$argon2id');
    expect(await service.verify(hash, 'Str0ng!Password')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('Str0ng!Password');
    expect(await service.verify(hash, 'wrong')).toBe(false);
  });

  it('produces different hashes for same password (salting)', async () => {
    const a = await service.hash('Str0ng!Password');
    const b = await service.hash('Str0ng!Password');
    expect(a).not.toBe(b);
  });
});
