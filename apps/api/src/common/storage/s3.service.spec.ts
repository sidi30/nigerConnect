import { BadRequestException } from '@nestjs/common';
import { S3Service } from './s3.service';

/**
 * Focus: assertOwnedPublicMedia — the anti-spoofing media guard added for the
 * stories-video beta. The critical invariant is that the client-DECLARED
 * mediaType is confronted with the REAL Content-Type from the HEAD, closing the
 * image↔video spoof, on top of ownership (prefix) + size caps.
 */
function makeConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    S3_BUCKET: 'nigerconnect',
    S3_PRIVATE_BUCKET: 'nigerconnect-private',
    CDN_URL: 'https://cdn.example.com',
    S3_SSE: false,
    S3_ENDPOINT: 'http://minio:9000',
    S3_PUBLIC_ENDPOINT: undefined,
    S3_REGION: 'us-east-1',
    S3_FORCE_PATH_STYLE: true,
    S3_ACCESS_KEY: 'k',
    S3_SECRET_KEY: 's',
    ...overrides,
  };
  return { get: (k: string) => values[k] } as never;
}

/** Build an S3Service whose internal client HEAD returns the given object head. */
function makeService(head: { ContentType?: string; ContentLength?: number } | Error) {
  const svc = new S3Service(makeConfig());
  const send = jest.fn(async () => {
    if (head instanceof Error) throw head;
    return head;
  });
  (svc as unknown as { client: { send: typeof send } }).client = { send };
  return { svc, send };
}

const url = (key: string) => `https://cdn.example.com/${key}`;

describe('S3Service.assertOwnedPublicMedia — anti-spoof binding', () => {
  it('accepts a real video declared as video, within cap → returns url + bytes', async () => {
    const { svc } = makeService({ ContentType: 'video/mp4', ContentLength: 5_000_000 });
    const out = await svc.assertOwnedPublicMediaDetailed(
      url('stories/u1/a.mp4'),
      'video',
      'stories/u1/',
    );
    expect(out).toEqual({
      url: url('stories/u1/a.mp4'),
      bytes: 5_000_000,
      contentType: 'video/mp4',
    });
  });

  it('REJECTS a real image declared as video (spoof) → 400', async () => {
    const { svc } = makeService({ ContentType: 'image/jpeg', ContentLength: 1000 });
    await expect(
      svc.assertOwnedPublicMedia(url('stories/u1/a.mp4'), 'video', 'stories/u1/'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS a real video declared as image (reverse spoof) → 400', async () => {
    const { svc } = makeService({ ContentType: 'video/mp4', ContentLength: 1000 });
    await expect(
      svc.assertOwnedPublicMedia(url('stories/u1/a.jpg'), 'image', 'stories/u1/'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS an object under another user prefix (anti-IDOR) → 400', async () => {
    const { svc, send } = makeService({ ContentType: 'video/mp4', ContentLength: 1000 });
    await expect(
      svc.assertOwnedPublicMedia(url('stories/u2/a.mp4'), 'video', 'stories/u1/'),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Ownership is checked BEFORE the HEAD — never even touch the object.
    expect(send).not.toHaveBeenCalled();
  });

  it('REJECTS a foreign-host URL (parsePublicKey null) → 400', async () => {
    const { svc } = makeService({ ContentType: 'video/mp4', ContentLength: 1000 });
    await expect(
      svc.assertOwnedPublicMedia('https://evil.example/x.mp4', 'video', 'stories/u1/'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS a video over the 25 Mo cap → 400', async () => {
    const { svc } = makeService({
      ContentType: 'video/mp4',
      ContentLength: S3Service.MAX_PUBLIC_VIDEO_BYTES + 1,
    });
    await expect(
      svc.assertOwnedPublicMedia(url('stories/u1/a.mp4'), 'video', 'stories/u1/'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS an unsupported content-type → 400', async () => {
    const { svc } = makeService({ ContentType: 'application/zip', ContentLength: 10 });
    await expect(
      svc.assertOwnedPublicMedia(url('stories/u1/a.mp4'), 'video', 'stories/u1/'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('REJECTS when the object does not exist (HEAD throws) → 400', async () => {
    const { svc } = makeService(new Error('NotFound'));
    await expect(
      svc.assertOwnedPublicMedia(url('stories/u1/a.mp4'), 'video', 'stories/u1/'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
