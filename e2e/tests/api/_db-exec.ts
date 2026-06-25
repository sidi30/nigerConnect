/**
 * _db-exec.ts — shared test-DB mutation helper for the API e2e specs.
 *
 * Dual-path, kept deliberately synchronous so every existing call site
 * (`const out = psql(sql)`) keeps working unchanged:
 *
 *   1. DATABASE_URL set  → run the SQL over TCP with the `pg` package.
 *      Used in CI (GitHub Postgres service container) and anywhere a real
 *      connection string is available. Because the specs call this helper
 *      synchronously, the actual `pg` round-trip runs in a short-lived child
 *      process (`execFileSync`) that prints psql-compatible aligned output.
 *
 *   2. DATABASE_URL unset → fall back to the original local-dev behaviour:
 *      `docker exec nigerconnect-postgres psql -U nigerconnect -d nigerconnect`
 *      (psql isn't on the Windows host; the dev DB lives in that container).
 *
 * In BOTH paths `psql(sql)` returns text in psql's default aligned-table
 * format, so the existing call-site parsers keep working verbatim:
 *   - `out.match(/\{.*\}/)` + JSON.parse        (row_to_json rows)
 *   - `out.match(/\d+/)`    + parseInt          (scalar counts)
 *   - header / dashes / value / "(N rows)" line splitting
 *
 * `redisDel(key)` mirrors the same dual-path approach for the mandatory Redis
 * cache flushes (REDIS_URL over TCP in CI, docker exec redis-cli locally).
 */

import { execFileSync } from 'child_process';

// Resolve the workers that perform the actual TCP I/O. Kept as sibling `.cjs`
// files so they run under plain node regardless of the spec transpiler.
const PG_WORKER = require.resolve('./_pg-worker.cjs');
const REDIS_WORKER = require.resolve('./_redis-worker.cjs');

const DATABASE_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];

/**
 * Run an arbitrary SQL statement against the test database and return its
 * output as psql-style aligned text.
 *
 * Whitespace in `sql` is collapsed to a single line first — the docker/psql
 * path passes the statement as a single `-c "..."` shell argument, and the
 * pg path is unaffected by the collapse.
 */
export function psql(sql: string): string {
  const oneLine = sql.replace(/\s+/g, ' ').trim();

  if (DATABASE_URL) {
    // Hand the SQL to the pg worker over argv; it prints psql-compatible text.
    return execFileSync(process.execPath, [PG_WORKER, oneLine], {
      env: { ...process.env, DATABASE_URL },
      stdio: 'pipe',
    }).toString();
  }

  // Local dev: no DATABASE_URL → original docker exec psql behaviour.
  return execFileSync(
    'docker',
    [
      'exec',
      'nigerconnect-postgres',
      'psql',
      '-U',
      'nigerconnect',
      '-d',
      'nigerconnect',
      '-c',
      oneLine,
    ],
    { stdio: 'pipe' },
  ).toString();
}

/**
 * Delete a single key from the test Redis. Synchronous to match the existing
 * call sites (which flush a cache key and then immediately re-read through the
 * API). Unlike a couple of best-effort flushes elsewhere, the parrainage
 * mode-switch tests REQUIRE this to succeed — the registration_mode cache TTL
 * is 300s, so a missed flush would make the API serve a stale mode.
 *
 *   - REDIS_URL set   → delete over TCP via the redis worker (CI + anywhere).
 *   - REDIS_URL unset → fall back to `docker exec nigerconnect-redis redis-cli`.
 */
export function redisDel(key: string): void {
  if (REDIS_URL) {
    execFileSync(process.execPath, [REDIS_WORKER, key], {
      env: { ...process.env, REDIS_URL },
      stdio: 'pipe',
    });
    return;
  }

  // Local dev: no REDIS_URL → original docker exec redis-cli behaviour.
  execFileSync('docker', ['exec', 'nigerconnect-redis', 'redis-cli', 'DEL', key], {
    stdio: 'pipe',
  });
}
