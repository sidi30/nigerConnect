/**
 * _redis-worker.cjs — child-process worker for _db-exec.ts `redisDel`.
 *
 * Deletes a single key from the Redis at process.env.REDIS_URL, speaking RESP
 * directly over a raw TCP socket (node's built-in `net`) so no extra package
 * is needed. Exits 0 on success, non-zero (error on stderr) on failure, so the
 * calling `execFileSync` throws like the previous `execSync` did.
 *
 * Runs as a standalone node process (not via the Playwright transpiler), hence
 * plain CommonJS.
 */

const net = require('net');

const key = process.argv[2];
const url = new URL(process.env.REDIS_URL);

const host = url.hostname || '127.0.0.1';
const port = url.port ? Number(url.port) : 6379;
const password = url.password ? decodeURIComponent(url.password) : null;
// redis://host:port/<db> — optional numeric db index in the path.
const dbIndex = url.pathname && url.pathname.length > 1 ? url.pathname.slice(1) : null;

/** Encode a RESP array command, e.g. ['DEL', 'foo'] → "*2\r\n$3\r\nDEL\r\n$3\r\nfoo\r\n". */
function resp(args) {
  let out = `*${args.length}\r\n`;
  for (const a of args) {
    const s = String(a);
    out += `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
  }
  return out;
}

const socket = net.createConnection({ host, port });
socket.setEncoding('utf8');

// Queue the commands to send, and track how many replies we still expect.
const commands = [];
if (password) commands.push(['AUTH', password]);
if (dbIndex) commands.push(['SELECT', dbIndex]);
commands.push(['DEL', key]);

let pending = commands.length;
let buffer = '';
let failed = false;

function fail(msg) {
  if (failed) return;
  failed = true;
  process.stderr.write(String(msg) + '\n');
  socket.destroy();
  process.exit(1);
}

socket.on('connect', () => {
  socket.write(commands.map(resp).join(''));
});

socket.on('data', (chunk) => {
  buffer += chunk;
  // Consume complete RESP replies line-by-line. We only issue simple commands
  // whose replies are single-line (+OK, :N, -ERR ...).
  let nl;
  while ((nl = buffer.indexOf('\r\n')) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 2);
    if (line.startsWith('-')) {
      return fail(line.slice(1));
    }
    pending -= 1;
    if (pending === 0) {
      socket.end();
      process.exit(0);
    }
  }
});

socket.on('error', (err) => fail((err && err.message) || err));
