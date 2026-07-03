import { VideoDiskGuardCron } from './video-disk-guard.cron';

function makeConfig(threshold: number, bucket = 'nigerconnect') {
  const values: Record<string, unknown> = {
    MINIO_METRICS_URL: 'http://minio:9000/minio/v2/metrics/cluster',
    S3_BUCKET: bucket,
    VIDEO_DISK_GUARD_BYTES: threshold,
  };
  return { get: (k: string) => values[k] } as never;
}

function makeSettings() {
  return { setSetting: jest.fn(async () => undefined) };
}

const METRICS = `# HELP minio_bucket_usage_total_bytes Total bucket size in bytes
# TYPE minio_bucket_usage_total_bytes gauge
minio_bucket_usage_total_bytes{bucket="nigerconnect",server="minio:9000"} 3221225472
minio_bucket_usage_total_bytes{bucket="nigerconnect-private",server="minio:9000"} 1048576
`;

describe('VideoDiskGuardCron.parseBucketUsage', () => {
  it('extracts the usage for the requested bucket only', () => {
    expect(VideoDiskGuardCron.parseBucketUsage(METRICS, 'nigerconnect')).toBe(3221225472);
    expect(VideoDiskGuardCron.parseBucketUsage(METRICS, 'nigerconnect-private')).toBe(1048576);
  });

  it('returns null when the bucket is absent', () => {
    expect(VideoDiskGuardCron.parseBucketUsage(METRICS, 'nope')).toBeNull();
  });
});

describe('VideoDiskGuardCron.run — disjuncteur', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (global as { fetch?: unknown }).fetch;
  });

  function mockFetch(body: string, ok = true) {
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      text: async () => body,
    })) as never;
  }

  it('TRIPS the kill-switch when usage >= threshold (forces video_enabled=false)', async () => {
    mockFetch(METRICS); // 3 Go
    const settings = makeSettings();
    const cron = new VideoDiskGuardCron(settings as never, makeConfig(2 * 1024 * 1024 * 1024)); // 2 Go
    await cron.run();
    expect(settings.setSetting).toHaveBeenCalledWith('video_enabled', 'false');
  });

  it('does NOT touch the switch when usage is under threshold', async () => {
    mockFetch(METRICS); // 3 Go
    const settings = makeSettings();
    const cron = new VideoDiskGuardCron(settings as never, makeConfig(10 * 1024 * 1024 * 1024)); // 10 Go
    await cron.run();
    expect(settings.setSetting).not.toHaveBeenCalled();
  });

  it('FAIL-SAFE: never re-arms on a metrics fetch error (leaves switch untouched)', async () => {
    (global as { fetch?: unknown }).fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as never;
    const settings = makeSettings();
    const cron = new VideoDiskGuardCron(settings as never, makeConfig(1)); // trivially low threshold
    await cron.run();
    expect(settings.setSetting).not.toHaveBeenCalled();
  });

  it('FAIL-SAFE: bucket missing from metrics → no switch change', async () => {
    mockFetch(`minio_bucket_usage_total_bytes{bucket="other"} 999999999999`);
    const settings = makeSettings();
    const cron = new VideoDiskGuardCron(settings as never, makeConfig(1));
    await cron.run();
    expect(settings.setSetting).not.toHaveBeenCalled();
  });
});
