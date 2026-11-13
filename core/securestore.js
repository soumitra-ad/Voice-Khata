'use strict';
// Transcripts encrypted at rest with AES-256-GCM. Plaintext never touches disk.
// Key: TRANSCRIPT_KEY in .env (32 bytes as 64 hex chars). Server-side only.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { openDb } = require('./ledger');

function loadKey(hex = process.env.TRANSCRIPT_KEY) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex || '')) throw new Error('TRANSCRIPT_KEY must be 64 hex chars (32 bytes)');
  return Buffer.from(hex, 'hex');
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12); // 96-bit nonce, fresh per message
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return { ciphertext, iv, authTag: c.getAuthTag() };
}

// Throws if the ciphertext, iv or tag was tampered with, or the key is wrong.
function decrypt({ ciphertext, iv, authTag }, key) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv));
  d.setAuthTag(Buffer.from(authTag));
  return Buffer.concat([d.update(Buffer.from(ciphertext)), d.final()]).toString('utf8');
}

const TABLE = `CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL
)`;

// Deletes every stored transcript. Needs no key, so it works even if the key is lost.
function purge(db) {
  db.exec(TABLE);
  db.exec('DELETE FROM transcripts');
  db.exec('VACUUM');
}

class SecureStore {
  // dbOrFile: a path, or an already-open db handle (e.g. ledger.db) to share one file.
  constructor(dbOrFile = ':memory:', keyHex) {
    this.key = loadKey(keyHex);
    this.db = typeof dbOrFile === 'string' ? openDb(dbOrFile).db : dbOrFile;
    this.db.exec(TABLE);
  }

  put(text) {
    const e = encrypt(text, this.key);
    return Number(this.db.prepare('INSERT INTO transcripts (ciphertext, iv, auth_tag) VALUES (?, ?, ?)')
      .run(e.ciphertext, e.iv, e.authTag).lastInsertRowid);
  }

  get(id) {
    const r = this.db.prepare('SELECT ciphertext, iv, auth_tag FROM transcripts WHERE id = ?').get(id);
    return r ? decrypt({ ciphertext: r.ciphertext, iv: r.iv, authTag: r.auth_tag }, this.key) : null;
  }

  count() { return Number(this.db.prepare('SELECT COUNT(*) AS n FROM transcripts').get().n); }
  purge() { purge(this.db); }
}

// npm run purge            -> delete all transcripts
// npm run purge -- --all   -> also wipe the ledger (customers, entries, promises, audit)
if (require.main === module) {
  try { process.loadEnvFile(); } catch { /* no .env: fall back to defaults */ }
  const file = process.env.LEDGER_DB || './khata.db';
  if (!fs.existsSync(file)) { console.log(`Nothing to purge: ${file} does not exist.`); process.exit(0); }
  const { openLedger } = require('./ledger');
  const L = openLedger(file);
  purge(L.db);
  console.log(`Purged all transcripts from ${file}.`);
  if (process.argv.includes('--all')) { L.purge(); console.log(`Purged ledger data from ${file}.`); }
  L.close();
}

module.exports = { SecureStore, encrypt, decrypt, loadKey, purge };
