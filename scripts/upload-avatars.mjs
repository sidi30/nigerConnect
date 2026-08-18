/**
 * Téléverse les avatars des comptes d'animation.
 *
 * Pour chaque compte : signe un PUT dans `users/{id du compte}`, envoie le
 * fichier, puis lie l'URL au profil. Le dossier est celui du compte lui-même,
 * exactement comme pour un membre — c'est ce qui permet à
 * `assertOwnedPublicImage` de valider l'appartenance sans exception.
 *
 * Prérequis : les 25 comptes doivent EXISTER (POST /admin/animation/accounts),
 * donc la migration doit être appliquée.
 *
 *   NODE_EXTRA_CA_CERTS=C:/Users/ramzi/.certs/norton-root.pem \
 *   NC_API=https://api.nigerconnect.app/api NC_ADMIN_TOKEN=... \
 *   node scripts/upload-avatars.mjs [--dry-run] [--only nc09,nc10]
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const API = process.env.NC_API;
const TOKEN = process.env.NC_ADMIN_TOKEN;
if (!API || !TOKEN) {
  console.error('NC_API et NC_ADMIN_TOKEN sont requis.');
  process.exit(1);
}

const DRY = process.argv.includes('--dry-run');
const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(',')) : null;

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'docs', 'midjourney_session');
const mapping = JSON.parse(await readFile(path.join(dir, 'mapping.json'), 'utf8'));
/** Variante retenue par compte. Défaut `_0` — voir selection.json pour les choix. */
const selectionPath = path.join(dir, 'selection.json');
const selection = existsSync(selectionPath)
  ? JSON.parse(await readFile(selectionPath, 'utf8'))
  : {};

const api = async (method, route, body) => {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};

let ok = 0;
let failed = 0;
for (const [handle, entry] of Object.entries(mapping).sort()) {
  if (ONLY && !ONLY.has(handle)) continue;

  const variant = selection[handle] ?? 0;
  const file = entry.files.find((f) => f.endsWith(`_${variant}.png`)) ?? entry.files[0];
  const full = path.join(dir, file);

  if (DRY) {
    console.log(`${handle} ← ${file}`);
    ok += 1;
    continue;
  }

  try {
    const bytes = await readFile(full);
    // 15 Mo est le plafond de l'API (S3Service.MAX_PUBLIC_IMAGE_BYTES) : on le
    // vérifie ici pour échouer avant d'avoir signé et transféré pour rien.
    if (bytes.length > 15 * 1024 * 1024) {
      throw new Error(`${(bytes.length / 1048576).toFixed(1)} Mo > 15 Mo`);
    }

    const presigned = await api('POST', `/admin/animation/bots/${handle}/avatar/presign`, {
      contentType: 'image/png',
    });

    const put = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: bytes,
    });
    if (!put.ok) throw new Error(`PUT S3 → ${put.status}`);

    await api('PATCH', `/admin/animation/bots/${handle}/avatar`, {
      avatarUrl: presigned.publicUrl,
    });
    console.log(`✓ ${handle}  ${file}`);
    ok += 1;
  } catch (error) {
    console.error(`✗ ${handle}  ${String(error)}`);
    failed += 1;
  }
}

console.log(`\n${ok} avatar(s) ${DRY ? 'à téléverser' : 'téléversés'}, ${failed} en échec.`);
if (!mapping.nc23) console.log('Rappel : nc23 (Ramatou Assoumane) n’a pas encore de photo.');
