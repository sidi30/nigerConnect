import { AnimationIllustrationService } from './animation-illustration.service';
import { S3Service } from '../common/storage/s3.service';

/**
 * Ce service est le seul endroit où un octet venu d'un tiers devient un objet
 * de NOTRE bucket. Trois propriétés comptent, et chacune casse silencieusement
 * si personne ne la surveille :
 *
 *   - ce qui est rangé est bien une image (le générateur rend parfois une page
 *     d'erreur en HTML, qui deviendrait une publication cassée pour tout le
 *     monde) ;
 *   - la clé suit `users/{compte}/…`, faute de quoi la garde d'attache
 *     refusera la publication au moment où le cron la sortira ;
 *   - une panne du tiers ne fait pas échouer le lot : on rend null, le texte
 *     part sans image.
 */

function makeS3() {
  return {
    putPublicObject: jest.fn(
      async (key: string, _body: Buffer, _contentType: string) => `https://cdn.test/${key}`,
    ),
  };
}

function respond(
  contentType: string,
  body: Uint8Array,
  init: { ok?: boolean; status?: number } = {},
) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

const BOT = '11111111-1111-1111-1111-111111111111';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe("illustration d'une publication d'animation", () => {
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("range l'image sous la clé du compte, comme pour un membre", async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond('image/jpeg', JPEG) as never);
    const s3 = makeS3();
    const svc = new AnimationIllustrationService(s3 as never);

    const url = await svc.illustrate(BOT, 'un marché de Niamey au coucher du soleil');

    const key = s3.putPublicObject.mock.calls[0]![0] as string;
    expect(key.startsWith(`users/${BOT}/animation/`)).toBe(true);
    expect(key.endsWith('.jpg')).toBe(true);
    expect(url).toBe(`https://cdn.test/${key}`);
  });

  it("n'envoie que la description, jamais l'identifiant du compte", async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond('image/jpeg', JPEG) as never);
    const svc = new AnimationIllustrationService(makeS3() as never);

    await svc.illustrate(BOT, 'un thé partagé sous un arbre');

    const called = fetchSpy.mock.calls[0]![0] as string;
    expect(called).toContain(encodeURIComponent('un thé partagé sous un arbre'));
    expect(called).not.toContain(BOT);
  });

  it("refuse une page d'erreur HTML déguisée en image", async () => {
    const html = new TextEncoder().encode('<html>rate limited</html>');
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond('text/html', html) as never);
    const s3 = makeS3();
    const svc = new AnimationIllustrationService(s3 as never);

    expect(await svc.illustrate(BOT, 'une place de marché')).toBeNull();
    expect(s3.putPublicObject).not.toHaveBeenCalled();
  });

  it('refuse une réponse vide', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respond('image/jpeg', new Uint8Array()) as never);
    const s3 = makeS3();
    const svc = new AnimationIllustrationService(s3 as never);

    expect(await svc.illustrate(BOT, 'une place de marché')).toBeNull();
    expect(s3.putPublicObject).not.toHaveBeenCalled();
  });

  it('refuse une image au-dessus du plafond que la garde d’attache appliquera', async () => {
    const huge = new Uint8Array(S3Service.MAX_PUBLIC_IMAGE_BYTES + 1);
    huge[0] = 0xff;
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond('image/jpeg', huge) as never);
    const s3 = makeS3();
    const svc = new AnimationIllustrationService(s3 as never);

    expect(await svc.illustrate(BOT, 'une place de marché')).toBeNull();
    expect(s3.putPublicObject).not.toHaveBeenCalled();
  });

  it('rend null — sans lever — quand le générateur est en panne', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const svc = new AnimationIllustrationService(makeS3() as never);

    await expect(svc.illustrate(BOT, 'une place de marché')).resolves.toBeNull();
  });

  it('rend null sur une réponse non-200', async () => {
    fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(respond('image/jpeg', JPEG, { ok: false, status: 429 }) as never);
    const svc = new AnimationIllustrationService(makeS3() as never);

    await expect(svc.illustrate(BOT, 'une place de marché')).resolves.toBeNull();
  });

  it('ignore une description vide ou démesurée, sans appeler le tiers', async () => {
    fetchSpy = jest.spyOn(global, 'fetch');
    const svc = new AnimationIllustrationService(makeS3() as never);

    expect(await svc.illustrate(BOT, '   ')).toBeNull();
    expect(await svc.illustrate(BOT, 'a'.repeat(401))).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepte png et webp, avec la bonne extension', async () => {
    for (const [type, ext] of [
      ['image/png', '.png'],
      ['image/webp', '.webp'],
    ] as const) {
      fetchSpy?.mockRestore();
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(respond(type, JPEG) as never);
      const s3 = makeS3();
      const svc = new AnimationIllustrationService(s3 as never);

      await svc.illustrate(BOT, 'une scène de rue');

      expect((s3.putPublicObject.mock.calls[0]![0] as string).endsWith(ext)).toBe(true);
      expect(s3.putPublicObject.mock.calls[0]![2]).toBe(type);
    }
  });
});
