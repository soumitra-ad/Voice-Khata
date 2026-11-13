'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseAmount, toWords } = require('./core/numerals');
const { openLedger, speakBalance } = require('./core/ledger');
const { parse } = require('./core/parser');
const G = require('./core/guardrails');
const { UNION, PACKS } = require('./core/langpacks');

const TODAY = '2026-11-13', YESTERDAY = '2026-11-12', TOMORROW = '2026-11-14';

test('numerals: required cases', () => {
  const cases = [
    ['340', 340], ['३४०', 340], ['teen sau chaalis', 340], ['three forty', 340, 'en'], ['sava sau', 125], ['dedh sau', 150],
    ['dhai sau', 250], ['paune teen sau', 275], ['do hazaar paanch sau', 2500],
  ];
  for (const [text, value, lang] of cases) {
    const r = normaliseAmount(text, lang || 'hi');
    assert.equal(r.value, value, text);
    assert.equal(r.paise, value * 100, text);
    assert.equal(r.kind, 'money', text);
    assert.ok(Number.isInteger(r.paise));
  }
  const q = normaliseAmount('dhai kilo', 'hi');
  assert.equal(q.kind, 'quantity');
  assert.equal(q.value, 2.5);
  assert.equal(q.unit, 'kg');
});

test('numerals: irregular tables, digit folding, currency, Bengali glued hundreds', () => {
  assert.equal(normaliseAmount('saintees', 'hi').value, 37);
  assert.equal(normaliseAmount('sadtis', 'mr').value, 37);
  assert.equal(normaliseAmount('৩৪০ টাকা', 'bn').value, 340); // Bengali digits
  assert.equal(normaliseAmount('₹1,500', 'hi').value, 1500);
  assert.equal(normaliseAmount('Rs 2,50,000', 'hi').value, 250000);
  assert.equal(normaliseAmount('tinsho', 'bn').value, 300);
  assert.equal(normaliseAmount('twenty one', 'en').value, 21);
  assert.equal(normaliseAmount('sadhe teen sau', 'hi').value, 350);
  assert.equal(normaliseAmount('dhai kilo chawal 120 rupaye', 'hi').value, 120); // money preferred over quantity
  assert.ok(normaliseAmount('paise do', 'hi').confidence < 0.5); // "do" = give, not 2
});

test('numerals: toWords', () => {
  assert.equal(toWords(34000, 'hi'), 'teen sau chaalees rupaye');
  assert.equal(toWords(250050, 'hi'), 'do hazaar paanch sau rupaye aur pachaas paise');
  assert.equal(toWords(30000, 'bn'), 'tin sho taka');
});

test('ledger: atomic add, correction, undo, day total', () => {
  const L = openLedger(':memory:');
  const ramesh = L.addCustomer('Ramesh', ['Ramesh bhai']);
  L.addEntries([
    { customerId: ramesh, direction: 'credit', paise: 34000, date: TODAY },
    { customerId: ramesh, direction: 'payment', paise: 20000, date: YESTERDAY },
  ], { transcript: 'Ramesh ka 340 udhaar, kal 200 diya tha' });
  assert.equal(L.balancePaise(ramesh), 14000);

  const creditId = L.db.prepare("SELECT id FROM entries WHERE direction='credit'").get().id;
  const newId = L.correctEntry(creditId, { paise: 43000 });
  assert.equal(L.balancePaise(ramesh), 23000);
  assert.equal(L.dayTotalPaise(TODAY, 'credit'), 43000);
  const old = L.db.prepare('SELECT amount_paise, undone FROM entries WHERE id = ?').get(creditId);
  assert.equal(old.amount_paise, 34000, 'old amount never mutated');
  assert.equal(old.undone, 1);
  assert.equal(L.db.prepare('SELECT replaces_id FROM entries WHERE id = ?').get(newId).replaces_id, creditId);

  // Atomicity: a bad row (unknown customer, FK) rolls back the whole utterance.
  assert.throws(() => L.addEntries([
    { customerId: ramesh, direction: 'credit', paise: 1000, date: TODAY },
    { customerId: 9999, direction: 'credit', paise: 1000, date: TODAY },
  ]));
  assert.equal(L.balancePaise(ramesh), 23000);
  assert.throws(() => L.addEntries([{ customerId: ramesh, direction: 'credit', paise: 12.5, date: TODAY }]), /paise/);

  assert.equal(L.provisionalBalance(ramesh, [{ customerId: ramesh, direction: 'payment', paise: 3000 }]), 20000);
  assert.equal(L.undoEntry(newId), true);
  assert.equal(L.balancePaise(ramesh), -20000);
  assert.equal(L.undoEntry(newId), false);

  const suresh = L.addCustomer('Suresh');
  L.addEntries([{ customerId: suresh, direction: 'credit', paise: 50000, date: TODAY }]);
  assert.equal(L.totalReceivablePaise(), 50000);
  assert.deepEqual(L.topDebtors(5).map((d) => d.name), ['Suresh']);
  assert.deepEqual(L.findCustomers('ramesh bhai').map((c) => c.id), [ramesh]);
  assert.equal(L.findCustomers('').length, 2);
  assert.ok(L.db.prepare('SELECT COUNT(*) n FROM audit').get().n > 0);
  L.purge();
  assert.equal(L.findCustomers('').length, 0);
  L.close();
});

test('ledger: speakBalance never says minus', () => {
  assert.equal(speakBalance(23000, 'hi', 'Ramesh'), 'Ramesh ka do sau tees rupaye baaki hai.');
  const adv = speakBalance(-5000, 'hi', 'Ramesh');
  assert.match(adv, /advance diya hai/);
  assert.doesNotMatch(adv, /minus|-/);
  assert.match(speakBalance(0, 'hi', 'Ramesh'), /barabar/);
});

test('parser: two entries, directions and per-clause dates', () => {
  const r = parse('Ramesh ka 340 udhaar, kal 200 diya tha', { today: TODAY });
  assert.equal(r.intent, 'add_entries');
  assert.equal(r.lang, 'hi');
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.entries.map((e) => [e.customer.name, e.direction, e.paise, e.date]), [
    ['Ramesh', 'credit', 34000, TODAY],
    ['Ramesh', 'payment', 20000, YESTERDAY],
  ]);
});

test('parser: ne/ko case marker decides direction', () => {
  const a = parse('Ramesh ne 200 diya', { today: TODAY });
  assert.equal(a.intent, 'add_entries');
  assert.equal(a.entries[0].direction, 'payment');
  const b = parse('Ramesh ko 200 diya', { today: TODAY });
  assert.equal(b.entries[0].direction, 'credit');
});

test('parser: no direction verb -> clarify, never guess', () => {
  const r = parse('Ramesh 200', { today: TODAY });
  assert.equal(r.intent, 'clarify');
  assert.equal(r.slot, 'direction');
  assert.ok(!r.entries.length);
  assert.ok(r.question.length < 60);
});

test('parser: correction patches amount on lastIntent', () => {
  const lastIntent = parse('Ramesh ka 340 udhaar, kal 200 diya tha', { today: TODAY });
  const r = parse('nahi, 430', { today: TODAY, lastIntent });
  assert.equal(r.intent, 'correct_slot');
  assert.equal(r.slot, 'amount');
  assert.equal(r.value, 43000);
  assert.equal(r.entryIndex, 0);
  assert.equal(r.patched.entries[0].paise, 43000);
  assert.equal(r.patched.entries[1].paise, 20000);
  assert.equal(lastIntent.entries[0].paise, 34000, 'lastIntent not mutated');
});

test('parser: kal by tense, Marathi kal, queries, disambiguation, misc intents', () => {
  const fut = parse('Ramesh kal 200 de dega', { today: TODAY });
  assert.equal(fut.entries[0].date, TOMORROW);
  assert.equal(fut.entries[0].future, true);
  assert.equal(parse('Rameshne kal 200 dile', { today: TODAY, lang: 'mr', customers: [{ id: 1, name: 'Ramesh' }] }).entries[0].date, YESTERDAY);

  const q = parse('Ramesh ka total?', { today: TODAY });
  assert.equal(q.intent, 'query_balance');
  assert.equal(q.customer.name, 'Ramesh');
  const dt = parse('aaj ka total kitna udhaar', { today: TODAY });
  assert.equal(dt.intent, 'query_day_total');
  assert.equal(dt.date, TODAY);
  assert.equal(dt.direction, 'credit');

  const customers = [{ id: 1, name: 'Ramesh Kumar' }, { id: 2, name: 'Ramesh Doodhwala', aliases: ['doodhwala'] }];
  const d = parse('Ramesh ka 340 udhaar', { today: TODAY, customers });
  assert.equal(d.intent, 'disambiguate');
  assert.equal(d.candidates.length, 2);
  assert.ok(d.question.split(/\s+/).length <= 8, 'short question');
  const one = parse('Ramesh Kumar ka 340 udhaar', { today: TODAY, customers });
  assert.equal(one.entries[0].customer.id, 1);

  assert.equal(parse('haan', {}).intent, 'confirm');
  assert.equal(parse('nahi', {}).intent, 'deny');
  assert.equal(parse('pichla hatao', {}).intent, 'undo');
  assert.equal(parse('naya customer Suresh', {}).name, 'Suresh');
  assert.equal(parse('Ramesh ko reminder bhejna', {}).intent, 'reminder_optin');
  assert.equal(parse('Ramesh gave 200 yesterday', { today: TODAY }).entries[0].direction, 'payment');
  assert.equal(parse('Ramesh ne 200 diya', { today: TODAY }).entries[0].customer.name, 'Ramesh');
});

test('guardrails', () => {
  const threat = G.lintReminder('Ramesh, 500 jaldi do warna police bulaunga', 'hi', { name: 'Ramesh', amount: 'paanch sau rupaye' });
  assert.equal(threat.ok, false);
  assert.match(threat.safeReply, /suvidha/);
  assert.doesNotMatch(threat.safeReply, /police|warna/);
  assert.equal(G.lintReminder('Namaste Ramesh, aapke khaate mein 500 baaki hai. Jab suvidha ho, chuka dijiye.', 'hi').ok, true);

  const noOpt = G.requireOptIn({ name: 'Ramesh', reminder_opt_in: 0 });
  assert.equal(noOpt.ok, false);
  assert.equal(noOpt.reason, 'no_opt_in');
  assert.equal(G.requireOptIn({ name: 'Ramesh', reminder_opt_in: 1 }).ok, true);

  const lend = G.refuseLending('hi');
  assert.equal(lend.ok, false);
  assert.equal(lend.reason, 'lending');
  const p = parse('Ramesh ko 5000 ka loan do, byaaj 2 percent', { today: TODAY });
  assert.equal(p.intent, 'refuse');
  assert.equal(p.reason, 'lending');
  assert.equal(parse('bukhar ki dawai bimari ke liye', {}).reason, 'diagnosis');

  for (const lang of ['hi', 'mr', 'bn', 'en']) assert.match(G.aiDisclosure(lang).safeReply, /AI/);
  assert.equal(G.refuseDiagnosis('en').ok, false);
});

test('langpacks: union lexicon and experimental packs', () => {
  assert.ok(UNION.agent.has('ne') && UNION.recipient.has('ko') && UNION.possessive.has('ka'));
  assert.ok(UNION.give_verbs.has('dihlas') && UNION.give_verbs.has('diyeche'));
  assert.ok(PACKS.bho.experimental && PACKS.mai.experimental);
});
