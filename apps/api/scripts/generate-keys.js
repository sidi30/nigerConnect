#!/usr/bin/env node
// Génère une paire RSA pour signer les JWT RS256.
// Usage: node scripts/generate-keys.js
const { generateKeyPairSync } = require('crypto');
const { mkdirSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

const keysDir = join(__dirname, '..', 'keys');
if (!existsSync(keysDir)) mkdirSync(keysDir, { recursive: true });

const privPath = join(keysDir, 'jwt-private.pem');
const pubPath = join(keysDir, 'jwt-public.pem');

if (existsSync(privPath) && existsSync(pubPath)) {
  console.log('Keys already exist, skipping.');
  process.exit(0);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(privPath, privateKey, { mode: 0o600 });
writeFileSync(pubPath, publicKey, { mode: 0o644 });

console.log(`✓ Keys written to ${keysDir}`);
