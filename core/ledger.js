'use strict';
// Local-only SQLite ledger. Money is INTEGER PAISE. credit = +receivable, payment = -receivable.
// Corrections soft-delete (undone=1) and re-insert; amounts are never mutated in place.
const { randomUUID } = require('node:crypto');
const { toWords } = require('./numerals');
const { render } = require('./langpacks');

function openDb(file) {
  try { const Better = require('better-sqlite3'); return { db: new Better(file), driver: 'better-sqlite3' }; }
  catch { const { DatabaseSync } = require('node:sqlite'); return { db: new DatabaseSync(file), driver: 'node:sqlite' }; }
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '',
  reminder_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (reminder_opt_in IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  direction TEXT NOT NULL CHECK (direction IN ('credit','payment')),
  amount_paise INTEGER NOT NULL CHECK (typeof(amount_paise) = 'integer' AND amount_paise > 0),
  entry_date TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  replaces_id INTEGER REFERENCES entries(id),
  undone INTEGER NOT NULL DEFAULT 0 CHECK (undone IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_live ON entries(customer_id, entry_date) WHERE undone = 0;
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,
  entry_id INTEGER,
  detail TEXT
);
CREATE VIEW IF NOT EXISTS balances AS
  SELECT c.id AS customer_id, c.name AS name,
         COALESCE(SUM(CASE e.direction WHEN 'credit' THEN e.amount_paise ELSE -e.amount_paise END), 0) AS balance_paise
  FROM customers c LEFT JOIN entries e ON e.customer_id = c.id AND e.undone = 0
  GROUP BY c.id;
`;

const DIRS = new Set(['credit', 'payment']);
const signed = (e) => (e.direction === 'credit' ? e.paise : -e.paise);

function validate(e) {
  if (!Number.isInteger(e.customerId)) throw new Error('customerId must be an integer');
  if (!DIRS.has(e.direction)) throw new Error(`bad direction ${e.direction}`);
  if (!Number.isInteger(e.paise) || e.paise <= 0) throw new Error(`paise must be a positive integer, got ${e.paise}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw new Error(`bad date ${e.date}`);
}

class Ledger {
  constructor(file = ':memory:') {
    const { db, driver } = openDb(file);
    this.db = db;
    this.driver = driver;
    db.exec(SCHEMA);
    const p = (sql) => db.prepare(sql);
    this.q = {
      addCustomer: p('INSERT INTO customers (name, aliases) VALUES (?, ?)'),
      customers: p('SELECT id, name, aliases, reminder_opt_in FROM customers ORDER BY id'),
      optIn: p('UPDATE customers SET reminder_opt_in = ? WHERE id = ?'),
      insert: p('INSERT INTO entries (customer_id, direction, amount_paise, entry_date, batch_id, replaces_id) VALUES (?, ?, ?, ?, ?, ?)'),
      live: p('SELECT * FROM entries WHERE id = ? AND undone = 0'),
      undo: p('UPDATE entries SET undone = 1 WHERE id = ? AND undone = 0'),
      audit: p('INSERT INTO audit (action, entry_id, detail) VALUES (?, ?, ?)'),
      balance: p('SELECT balance_paise FROM balances WHERE customer_id = ?'),
      dayTotal: p('SELECT COALESCE(SUM(amount_paise), 0) AS t FROM entries WHERE undone = 0 AND entry_date = ? AND direction = ?'),
      receivable: p('SELECT COALESCE(SUM(balance_paise), 0) AS t FROM balances WHERE balance_paise > 0'),
      top: p('SELECT customer_id, name, balance_paise FROM balances WHERE balance_paise > 0 ORDER BY balance_paise DESC LIMIT ?'),
    };
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  audit(action, entryId, detail) { this.q.audit.run(action, entryId == null ? null : entryId, JSON.stringify(detail || {})); }

  addCustomer(name, aliases = []) {
    const id = Number(this.q.addCustomer.run(String(name).trim(), aliases.join(',')).lastInsertRowid);
    this.audit('add_customer', null, { id, name });
    return id;
  }

  setReminderOptIn(customerId, optedIn) {
    this.q.optIn.run(optedIn ? 1 : 0, customerId);
    this.audit('reminder_opt_in', null, { customerId, optedIn: !!optedIn });
  }

  // All entries of one utterance in ONE atomic transaction. Returns new entry ids.
  addEntries(list, meta = {}) {
    if (!Array.isArray(list) || !list.length) throw new Error('no entries');
    list.forEach(validate);
    const batch = randomUUID();
    return this.tx(() => list.map((e) => {
      const id = Number(this.q.insert.run(e.customerId, e.direction, e.paise, e.date, batch, null).lastInsertRowid);
      this.audit('add', id, { ...e, transcript: meta.transcript });
      return id;
    }));
  }

  // Soft-delete the old row and insert the corrected copy. Returns the new entry id.
  correctEntry(entryId, patch = {}, meta = {}) {
    return this.tx(() => {
      const old = this.q.live.get(entryId);
      if (!old) throw new Error(`entry ${entryId} not found or already undone`);
      const e = {
        customerId: patch.customerId ?? old.customer_id, direction: patch.direction ?? old.direction,
        paise: patch.paise ?? old.amount_paise, date: patch.date ?? old.entry_date,
      };
      validate(e);
      this.q.undo.run(entryId);
      const id = Number(this.q.insert.run(e.customerId, e.direction, e.paise, e.date, old.batch_id, entryId).lastInsertRowid);
      this.audit('correct', id, { replaces: entryId, patch, transcript: meta.transcript });
      return id;
    });
  }

  undoEntry(entryId, meta = {}) {
    return this.tx(() => {
      const changed = Number(this.q.undo.run(entryId).changes) > 0;
      if (changed) this.audit('undo', entryId, { transcript: meta.transcript });
      return changed;
    });
  }

  balancePaise(customerId) { const r = this.q.balance.get(customerId); return r ? Number(r.balance_paise) : 0; }
  dayTotalPaise(date, direction = 'credit') { return Number(this.q.dayTotal.get(date, direction).t); }
  totalReceivablePaise() { return Number(this.q.receivable.get().t); }
  topDebtors(n = 5) { return this.q.top.all(n).map((r) => ({ customerId: r.customer_id, name: r.name, balancePaise: Number(r.balance_paise) })); }

  // Alias-aware, case-insensitive. Empty query returns everyone (parser context).
  findCustomers(query = '') {
    const q = String(query).trim().toLowerCase();
    return this.q.customers.all().map((r) => ({
      id: r.id, name: r.name, aliases: r.aliases ? r.aliases.split(',') : [], reminder_opt_in: r.reminder_opt_in,
    })).filter((c) => !q || [c.name, ...c.aliases].some((n) => {
      const l = n.toLowerCase();
      return l === q || l.split(/\s+/).includes(q) || l.startsWith(q);
    }));
  }

  // Balance as it would be after committing `pending` ({customerId, direction, paise}). For read-back before "haan".
  provisionalBalance(customerId, pending = []) {
    return this.balancePaise(customerId) + pending.filter((e) => e.customerId === customerId).reduce((s, e) => s + signed(e), 0);
  }

  purge() { this.tx(() => this.db.exec('DELETE FROM audit; DELETE FROM entries; DELETE FROM customers;')); }
  close() { this.db.close(); }
}

// Negative balance = customer paid in advance. Never say "minus baaki".
function speakBalance(paise, lang = 'hi', name = '') {
  const key = paise > 0 ? 'balance_due' : paise < 0 ? 'balance_advance' : 'balance_zero';
  return render(lang, key, { name, amount: toWords(Math.abs(paise), lang) });
}

const openLedger = (file) => new Ledger(file);

module.exports = { openLedger, Ledger, speakBalance };
