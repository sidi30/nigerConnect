/**
 * _pg-worker.cjs — child-process worker for _db-exec.ts.
 *
 * Reads a single SQL statement from argv[2], runs it against process.env
 * DATABASE_URL using the `pg` package, and writes the result to stdout in
 * psql's default *aligned* table format so the e2e specs' text parsers keep
 * working unchanged. Exits non-zero (with the pg error on stderr) on failure,
 * so the calling `execFileSync` throws like `execSync` did before.
 *
 * Runs as a standalone node process (not via the Playwright transpiler), hence
 * plain CommonJS.
 */

const { Client } = require('pg');

const sql = process.argv[2];
const connectionString = process.env.DATABASE_URL;

/**
 * Render a value the way psql prints it in aligned mode:
 *   - null  → '' (empty cell; the specs treat an empty cell as NULL)
 *   - objects/arrays (e.g. row_to_json output) → compact JSON
 *   - everything else → String(value)
 */
function renderCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Reproduce psql's default aligned output for a SELECT result so call-site
 * parsers (header line, dashes line, value lines, "(N rows)") keep matching.
 * For non-SELECT statements (UPDATE/INSERT/DELETE) psql prints a command tag
 * like "UPDATE 1" — mimic that; the specs that run those ignore the output.
 */
function formatAligned(result) {
  const fields = result.fields || [];

  // Non-row-returning command (UPDATE/INSERT/DELETE/...) → command tag line.
  if (fields.length === 0) {
    const tag = result.command || 'OK';
    const count = typeof result.rowCount === 'number' ? ` ${result.rowCount}` : '';
    return `${tag}${count}\n`;
  }

  const headers = fields.map((f) => f.name);
  const rows = result.rows.map((row) => headers.map((h) => renderCell(row[h])));

  // Column widths = max of header and any cell in that column.
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length), 0),
  );

  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  const headerLine = ' ' + headers.map((h, i) => pad(h, widths[i])).join(' | ') + ' ';
  const dashLine = widths.map((w) => '-'.repeat(w + 2)).join('+');
  const dataLines = rows.map(
    (r) => ' ' + r.map((c, i) => pad(c, widths[i])).join(' | ') + ' ',
  );

  const n = result.rowCount != null ? result.rowCount : rows.length;
  const footer = `(${n} ${n === 1 ? 'row' : 'rows'})`;

  return [headerLine, dashLine, ...dataLines, footer, ''].join('\n');
}

(async () => {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const result = await client.query(sql);
    process.stdout.write(formatAligned(result));
    await client.end();
    process.exit(0);
  } catch (err) {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
    process.stderr.write(String((err && err.message) || err) + '\n');
    process.exit(1);
  }
})();
