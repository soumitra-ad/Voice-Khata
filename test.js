'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normaliseAmount, toWords } = require('./core/numerals');
const { openLedger, speakBalance } = require('./core/ledger');
const { parse } = require('./core/parser');
const G = require('./core/guardrails');
const { SecureStore, encrypt, decrypt, loadKey, purge } = require('./core/securestore');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  ], { transcriptId: 1 });
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
  assert.equal(fut.intent, 'promise_note');
  assert.equal(fut.promise.due_on, TOMORROW);
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

test('numerals: native script, mixed script, fuzzy, digit preference', () => {
  const cases = [['तीन सौ चालीस', 340], ['सवा सौ', 125], ['ढाई सौ', 250], ['दो हज़ार पाँच सौ', 2500], ['तीन sau chaalis', 340],
    ['३४०', 340], ['पौने तीन सौ', 275], ['डेढ़ सौ', 150], ['दो हजार पांच सौ', 2500], ['तीन\u200B सौ चालीस', 340]];
  for (const [t, v] of cases) assert.equal(normaliseAmount(t, 'hi').value, v, t);
  assert.equal(normaliseAmount('তিন শো চল্লিশ', 'bn').value, 340);
  assert.equal(normaliseAmount('তিনশো', 'bn').value, 300);
  assert.equal(normaliseAmount('ঢাই কেজি', 'bn').kind, 'quantity'); // union lexicon via translit: "dhai kg", never money
  assert.equal(normaliseAmount('ढाई किलो', 'hi').kind, 'quantity');
  // Fuzzy ASR spellings, numeral lexicon only.
  assert.equal(normaliseAmount('teen sau chalees', 'hi').value, 340);
  assert.equal(normaliseAmount('teen sau chaalis', 'hi').value, 340);
  assert.equal(normaliseAmount('Ramesh ka total kya hai', 'hi').value, null); // "hai" never becomes "dhai"
  // Digit run beats a word parse.
  assert.equal(normaliseAmount('teen sau chaalis, 350', 'hi').value, 350);
});

test('parser: native-script amount and fuzzy never eats a known customer name', () => {
  const r = parse('Ramesh ka तीन सौ चालीस udhaar', { today: TODAY });
  assert.equal(r.entries[0].paise, 34000);
  // "Chalis" is a near-numeral; as a known customer it must stay a name.
  const c = parse('Chalis ka 200 udhaar', { today: TODAY, customers: [{ id: 7, name: 'Chalis' }] });
  assert.equal(c.entries[0].customer.id, 7);
  assert.equal(c.entries[0].paise, 20000);
  const f = parse('Chaalisa teen sau udhaar', { today: TODAY, customers: [{ id: 8, name: 'Chaalisa' }] }); // fuzzy-near "chaalees"
  assert.equal(f.entries[0].customer.id, 8);
  assert.equal(f.entries[0].paise, 30000);
});

test('parser: correction targeting is deterministic, never by proximity', () => {
  const lastIntent = parse('Ramesh ka 340 udhaar, kal 200 diya tha', { today: TODAY });
  const a = parse('nahi, 430', { today: TODAY, lastIntent });
  assert.equal(a.entryIndex, 0);
  assert.equal(a.patched.entries[0].paise, 43000);

  const b = parse('nahi, 210', { today: TODAY, lastIntent });
  assert.equal(b.intent, 'correct_slot');
  assert.equal(b.entryIndex, 0, 'primary clause, NOT the 200 entry by proximity');
  assert.equal(b.patched.entries[1].paise, 20000);

  const c = parse('kal wala nahi, 250', { today: TODAY, lastIntent });
  assert.equal(c.intent, 'correct_slot');
  assert.equal(c.entryIndex, 1);
  assert.equal(c.patched.entries[1].paise, 25000);
  assert.equal(c.patched.entries[0].paise, 34000);

  assert.equal(parse('nahi, doosra 250', { today: TODAY, lastIntent }).entryIndex, 1);
  assert.equal(parse('nahi, udhaar wala 500', { today: TODAY, lastIntent }).entryIndex, 0);
  assert.equal(parse('nahi, 200 wala 250', { today: TODAY, lastIntent }).entryIndex, 1);
  assert.equal(parse('nahi, jama 250', { today: TODAY, lastIntent }).entryIndex, 1);

  // No primary (neither entry dated today) -> ask, naming both amounts.
  const old = parse('Ramesh ka kal 340 udhaar tha, parso 200 diya tha', { today: TODAY });
  assert.equal(old.entries.length, 2);
  const d = parse('nahi, 430', { today: TODAY, lastIntent: old });
  assert.equal(d.intent, 'clarify');
  assert.equal(d.slot, 'correction_target');
  assert.equal(d.question, '340 wala ya 200 wala?');

  const one = parse('Ramesh ko 200 diya', { today: TODAY });
  assert.equal(parse('nahi, 250', { today: TODAY, lastIntent: one }).entryIndex, 0);
});

test('promises: future is a note, not a payment', () => {
  for (const t of ['Ramesh kal 200 dega', 'Ramesh kal 200 de dunga', 'Ramesh ka 200 kal milega', 'Ramesh ka 200 kal aa jayega', 'Ramesh will pay 200 tomorrow']) {
    const r = parse(t, { today: TODAY });
    assert.equal(r.intent, 'promise_note', t);
    assert.equal(r.promise.paise, 20000, t);
    assert.equal(r.promise.due_on, TOMORROW, t);
    assert.ok(!r.entries, t);
  }
  assert.equal(parse('Ramesh kal 200 dega', { today: TODAY }).reply, 'Theek, kal 200 milne ka note likh diya.');

  // Past tense stays a normal entry.
  const past = parse('Ramesh ne kal 200 diya tha', { today: TODAY });
  assert.equal(past.intent, 'add_entries');
  assert.equal(past.entries[0].direction, 'payment');
  assert.equal(past.entries[0].date, YESTERDAY);

  // Mixed: one real entry + one promise.
  const mix = parse('Ramesh ka 340 udhaar, kal 200 dega', { today: TODAY });
  assert.equal(mix.entries.length, 1);
  assert.equal(mix.promises.length, 1);

  // Conversion.
  const note = parse('Ramesh kal 200 dega', { today: TODAY });
  for (const t of ['aa gaya', 'abhi likh do']) {
    const f = parse(t, { today: TODAY, lastIntent: note });
    assert.equal(f.intent, 'promise_fulfil', t);
    assert.deepEqual([f.entry.direction, f.entry.paise, f.entry.date], ['payment', 20000, TODAY]);
  }
  // Without an open promise, "200 aa gaya" is just a payment.
  assert.equal(parse('Ramesh ka 200 aa gaya', { today: TODAY }).entries[0].direction, 'payment');
});

test('ledger: promises never touch the balance until fulfilled', () => {
  const L = openLedger(':memory:');
  const r = L.addCustomer('Ramesh');
  L.addEntries([{ customerId: r, direction: 'credit', paise: 34000, date: TODAY }]);
  const pid = L.addPromise({ customerId: r, paise: 20000, dueOn: TOMORROW });
  assert.equal(L.balancePaise(r), 34000, 'promise leaves balance unchanged');
  assert.equal(L.openPromises(r).length, 1);
  L.fulfilPromise(pid, { date: TODAY });
  assert.equal(L.balancePaise(r), 14000, 'conversion applies the payment');
  assert.equal(L.openPromises(r).length, 0);
  assert.throws(() => L.fulfilPromise(pid, { date: TODAY }), /not open/);
  assert.equal(L.balancePaise(r), 14000);
  L.close();
});

test('securestore: AES-256-GCM transcripts, no plaintext on disk, purge', () => {
  const keyHex = 'ab'.repeat(32);
  const key = loadKey(keyHex);
  const e = encrypt('Ramesh ka 340 udhaar', key);
  assert.equal(e.iv.length, 12);
  assert.equal(e.authTag.length, 16);
  assert.equal(decrypt(e, key), 'Ramesh ka 340 udhaar');
  assert.throws(() => decrypt({ ...e, authTag: Buffer.alloc(16) }, key)); // tamper detected
  assert.throws(() => decrypt(e, loadKey('cd'.repeat(32))));             // wrong key
  assert.throws(() => loadKey('abc'), /64 hex/);
  assert.throws(() => loadKey(undefined), /64 hex/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-'));
  const file = path.join(dir, 'test.db');
  const L = openLedger(file);
  const S = new SecureStore(L.db, keyHex);
  const secret = 'Suresh ka 777 udhaar unique-plaintext-marker';
  const tid = S.put(secret);
  const c = L.addCustomer('Suresh');
  L.addEntries([{ customerId: c, direction: 'credit', paise: 77700, date: TODAY }], { transcriptId: tid });
  assert.equal(S.get(tid), secret);
  L.close();
  const raw = fs.readFileSync(file);
  assert.equal(raw.includes('unique-plaintext-marker'), false, 'plaintext must not be on disk');

  const L2 = openLedger(file);
  const S2 = new SecureStore(L2.db, keyHex);
  assert.equal(S2.get(tid), secret);
  purge(L2.db);
  assert.equal(S2.count(), 0);
  assert.equal(L2.balancePaise(c), 77700, 'transcript purge leaves the ledger alone');
  L2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const { toLatin, canonicalKey } = require('./core/translit');

test('translit: deterministic char map, schwa deletion, nukta, Bengali inherent o', () => {
  assert.equal(toLatin('उधार'), 'udhaar');
  assert.equal(toLatin('रमेश'), 'ramesh');
  assert.equal(toLatin('समझना'), 'samajhna'); // medial schwa
  assert.equal(toLatin('मित्र'), 'mitra');     // schwa kept after conjunct
  assert.equal(toLatin('क़ ख़ ग़ ज़ ड़ ढ़ फ़'), 'qa kha ga za ra rha fa');
  assert.equal(toLatin('पाँच दुःख'), 'paanch duhkh');
  assert.equal(toLatin('ক'), 'ko');
  assert.equal(toLatin('রমেশের ধার'), 'romesher dhar');
  assert.equal(toLatin('নয় বড়'), 'noy bor');
  assert.equal(toLatin('ৰ ৱ', 'beng'), 'ro wo');
  assert.equal(canonicalKey('रमेश'), canonicalKey('Ramesh'));
  assert.equal(canonicalKey('chaalis'), canonicalKey('chaalees'));
  const raw = 'रमेश का 340 उधार';
  toLatin(raw);
  assert.equal(raw, 'रमेश का 340 उधार'); // input untouched
});

test('numerals: Marathi Devanagari table, scale variants, canonical guards', () => {
  for (const [t, v] of [['चाळीस', 40], ['सदतीस', 37], ['पंचवीस', 25], ['एकवीस', 21], ['पन्नास', 50], ['तीन शंभर', 300], ['वीस', 20]]) {
    assert.equal(normaliseAmount(t, 'mr').value, v, t);
  }
  for (const t of ['हज़ार', 'हजार', 'হাজার', 'hazaar', 'hazar', 'hajaar']) assert.equal(normaliseAmount(t, 'hi').value, 1000, t);
  for (const t of ['सौ', 'শো', 'sau']) assert.equal(normaliseAmount(t, 'hi').value, 100, t);
  for (const t of ['लाख', 'লাখ', 'lakh']) assert.equal(normaliseAmount(t, 'hi').value, 100000, t);
  // "pachaasee" folds to the key shared by 50 (pachaas) and 85 (pachaasi): match neither.
  assert.equal(normaliseAmount('pachaasee', 'hi').value, null);
  // Exact native numeral is never overridden by a loose Latin match.
  assert.equal(normaliseAmount('सात', 'hi').value, 7);
});

test('parser: native-script utterances end to end', () => {
  const T = { today: TODAY };
  const a = parse('रमेश का 340 उधार', T);
  assert.deepEqual([a.entries[0].customer.name, a.entries[0].paise, a.entries[0].direction, a.entries[0].date], ['Ramesh', 34000, 'credit', TODAY]);
  assert.equal(parse('रमेश ने 200 दिया', T).entries[0].direction, 'payment');
  assert.equal(parse('रमेश को 200 दिया', T).entries[0].direction, 'credit');

  const two = parse('रमेश का तीन सौ चालीस उधार, कल 200 दिया था', T);
  assert.deepEqual(two.entries.map((e) => [e.direction, e.paise, e.date]), [['credit', 34000, TODAY], ['payment', 20000, YESTERDAY]]);

  const p = parse('रमेश कल 200 देगा', T);
  assert.equal(p.intent, 'promise_note');
  const L = openLedger(':memory:');
  const id = L.addCustomer(p.promise.customer.name);
  L.addPromise({ customerId: id, paise: p.promise.paise, dueOn: p.promise.due_on });
  assert.equal(L.balancePaise(id), 0, 'promise leaves balance unchanged');
  L.close();

  const lastIntent = parse('Ramesh ka 340 udhaar', T);
  const c = parse('नाही, 430', { ...T, lastIntent });
  assert.equal(c.intent, 'correct_slot');
  assert.equal(c.slot, 'amount');
  assert.equal(c.patched.entries[0].paise, 43000);

  const roster = { ...T, customers: [{ id: 1, name: 'Ramesh' }] };
  for (const t of ['রমেশের 340 ধার', 'रमेशचा 340 उधार', 'रमेश ka 340 udhaar', 'रमेश का 340 उधार']) {
    const r = parse(t, roster);
    assert.deepEqual([r.entries[0].customer.id, r.entries[0].paise, r.entries[0].direction], [1, 34000, 'credit'], t);
  }
  // Without a roster the suffix is still stripped from the name.
  const bn = parse('রমেশের 340 ধার', T).entries[0].customer;
  assert.equal(canonicalKey(bn.name), canonicalKey('Ramesh'));
  assert.equal(bn.display, 'রমেশ');
  const mr = parse('रमेशचा 340 उधार', T).entries[0].customer;
  assert.deepEqual([mr.name, mr.display], ['Ramesh', 'रमेश']);

  const teja = parse('तेजा का 340 उधार', T);
  assert.deepEqual([teja.entries[0].customer.name, teja.entries[0].paise], ['Teja', 34000]);
});

test('original script is preserved in returned text and stored transcript', () => {
  const text = 'रमेश का तीन सौ चालीस उधार, कल 200 दिया था';
  const r = parse(text, { today: TODAY });
  assert.equal(r.text, text);
  assert.equal(r.entries[0].customer.display, 'रमेश');
  const S = new SecureStore(':memory:', 'ef'.repeat(32));
  for (const t of [text, 'রমেশের 340 ধার', 'रमेशचा 340 उधार']) assert.equal(S.get(S.put(t)), t);
});

const D = require('./core/dialog');
const { render } = require('./core/langpacks');

test('dialog: disambiguation answered with just a tag, never the whole sentence', () => {
  const customers = [{ id: 1, name: 'Ramesh', aliases: ['gali wala'] }, { id: 2, name: 'Ramesh', aliases: ['station wala'] }];
  const ctx = { today: TODAY, customers };
  const q = parse('Ramesh ka 340 udhaar', ctx);
  assert.equal(q.intent, 'disambiguate');
  assert.equal(D.questionFor(q, { lang: 'hi', customers }), 'Kaunse Ramesh: gali wala ya station wala?');
  const pending = D.pendingFrom(q, 'Ramesh ka 340 udhaar');
  for (const [answer, id] of [['gali wala', 1], ['station', 2], ['station wala', 2], ['pehla', 1], ['doosra', 2], ['गली वाला', 1], ['दूसरा', 2]]) {
    const r = D.answerPending(pending, answer, ctx);
    assert.equal(r.intent, 'add_entries', answer);
    assert.deepEqual([r.entries[0].customer.id, r.entries[0].paise, r.entries[0].direction], [id, 34000, 'credit'], answer);
  }
  assert.equal(D.answerPending(pending, 'Suresh ka 500 udhaar', ctx), null); // a new sentence is not an answer
  assert.equal(D.answerPending(pending, 'wala', ctx), null);                 // names nobody
});

test('dialog: "340 wala ya 200 wala?" answered with pehla / doosra / an amount', () => {
  const last = parse('Ramesh ka kal 340 udhaar tha, parso 200 diya tha', { today: TODAY });
  const c = parse('nahi, 430', { today: TODAY, lastIntent: last });
  assert.equal(D.questionFor(c, { lang: 'hi', lastIntent: last }), '340 wala ya 200 wala?');
  const pending = D.pendingFrom(c, 'nahi, 430', last);
  for (const [answer, i] of [['pehla', 0], ['doosra', 1], ['340 wala', 0], ['200 wala', 1], ['udhaar wala', 0], ['जमा वाला', 1], ['पहला', 0]]) {
    const r = D.answerPending(pending, answer, { today: TODAY });
    assert.equal(r.intent, 'correct_slot', answer);
    assert.equal(r.entryIndex, i, answer);
    assert.equal(r.patched.entries[i].paise, 43000, answer);
    assert.equal(r.patched.entries[1 - i].paise, last.entries[1 - i].paise, answer);
  }
  assert.equal(D.answerPending(pending, 'teesra', { today: TODAY }), null);
});

test('dialog: direction clarify answered with "ne diya" keeps the amount', () => {
  const q = parse('Ramesh 200', { today: TODAY });
  const pending = D.pendingFrom(q, 'Ramesh 200');
  const r = D.answerPending(pending, 'Ramesh ne diya', { today: TODAY });
  assert.deepEqual([r.intent, r.entries[0].direction, r.entries[0].paise], ['add_entries', 'payment', 20000]);
  assert.equal(D.answerPending(pending, 'Ramesh ko diya', { today: TODAY }).entries[0].direction, 'credit');
});

test('native-script replies: number words and templates', () => {
  assert.equal(toWords(34000, 'hi', 'native'), 'तीन सौ चालीस रुपये');
  assert.equal(toWords(250050, 'hi', 'native'), 'दो हज़ार पाँच सौ रुपये और पचास पैसे');
  assert.equal(toWords(34000, 'bn', 'native'), 'তিনশ চল্লিশ টাকা');
  assert.equal(toWords(2500, 'mr', 'native'), 'पंचवीस रुपये');
  assert.equal(toWords(34000, 'en', 'native'), toWords(34000, 'en')); // English has no native script
  assert.equal(toWords(34000, 'hi'), 'teen sau chaalees rupaye');       // Latin stays the default

  assert.equal(speakBalance(23000, 'hi', 'रमेश', 'native'), 'रमेश का दो सौ तीस रुपये बाकी है।');
  assert.match(speakBalance(-5000, 'hi', 'रमेश', 'native'), /एडवांस दिया है/);
  assert.equal(speakBalance(23000, 'bn', 'রমেশ', 'native'), 'রমেশ এর দুইশ ত্রিশ টাকা বাকি আছে।');
  const d = G.aiDisclosure('hi', 'native').safeReply;
  assert.match(d, /AI/);
  assert.match(d, /[ऀ-ॿ]/);
  assert.match(G.aiDisclosure('bn', 'native').safeReply, /[ঀ-৿]/);

  // Every Latin reply template has a native twin, written in that script.
  const SCRIPT_RE = { hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, bn: /[ঀ-৿]/ };
  for (const lang of ['hi', 'mr', 'bn']) {
    for (const key of Object.keys(PACKS[lang].templates)) {
      assert.ok(PACKS[lang].native[key], `${lang}.native.${key} missing`);
      const out = render(lang, key, { name: 'X', amount: '1', options: '1', entries: '1', balance: '1', when: '1', credit: '1', payment: '1' }, 'native');
      if (/[A-Za-z]{3}/.test(PACKS[lang].templates[key].replace(/\{\w+\}|AI|EMI/g, ''))) assert.match(out, SCRIPT_RE[lang], `${lang}.${key}`);
    }
  }
});

test('server.js holds no user-facing reply strings', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.doesNotMatch(src, /[ऀ-৿]/, 'no Devanagari/Bengali text in server.js');
  assert.doesNotMatch(src, /REPLIES|const say\b/);
  const keys = new Set(Object.values(PACKS).flatMap((p) => Object.keys(p.templates || {})));
  const fragments = Object.values(PACKS).flatMap((p) => [...Object.values(p.templates || {}), ...Object.values(p.native || {})])
    .flatMap((t) => t.split(/\{\w+\}/)).map((x) => x.trim())
    // Phrases or native-script text only: single English words ("credit") collide with code identifiers.
    .filter((x) => x.length >= 6 && /\p{L}{3}/u.test(x) && !keys.has(x) && (/\s/.test(x) || /[^\x00-\x7F]/.test(x)));
  for (const frag of new Set(fragments)) assert.ok(!src.includes(frag), `server.js contains reply text: "${frag}"`);
});

const { cacheKey, MockTimbre, TTS_CACHE } = require('./adapters/timbre');
const { isNumeralToken, tokenize } = require('./core/numerals');

// Words in a reply, counting each spoken amount (a run of number/scale/currency words) as ONE word.
function replyWords(text) {
  let n = 0, inAmount = false;
  for (const t of tokenize(text)) {
    if (!/[\p{L}\p{N}]/u.test(t.t)) { inAmount = false; continue; }
    const num = /^\d/.test(t.t) || isNumeralToken(t);
    if (!(num && inAmount)) n++;
    inAmount = num;
  }
  return n;
}

test('native hundreds are joined words in Marathi and Bengali, separate in Hindi', () => {
  assert.equal(toWords(34000, 'mr', 'native'), 'तीनशे चाळीस रुपये');
  assert.equal(toWords(34000, 'bn', 'native'), 'তিনশ চল্লিশ টাকা');
  assert.equal(toWords(34000, 'hi', 'native'), 'तीन सौ चालीस रुपये');
  assert.equal(toWords(10000, 'mr', 'native'), 'शंभर रुपये');
  assert.equal(toWords(90000, 'bn', 'native'), 'নয়শ টাকা');
  assert.equal(toWords(25075000, 'mr', 'native'), 'दोन लाख पन्नास हजार सातशे पन्नास रुपये');
  assert.equal(toWords(34000, 'mr'), 'teen shambhar chalees rupaye'); // Latin unchanged
});

test('every reply template is at most 10 words (a {var} counts as one)', () => {
  const wc = (t) => t.replace(/\{\w+\}/g, 'X').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  for (const [lang, p] of Object.entries(PACKS)) {
    for (const [set, obj] of [['latin', p.templates], ['native', p.native]]) {
      for (const [k, t] of Object.entries(obj || {})) assert.ok(wc(t) <= 10, `${lang}.${set}.${k} has ${wc(t)} words`);
    }
  }
});

test('TTS cache key includes script (same text, different script = different audio)', async () => {
  assert.notEqual(cacheKey('नमस्ते', 'v1', 'hi', 'native'), cacheKey('नमस्ते', 'v1', 'hi', 'latin'));
  assert.notEqual(cacheKey('x', 'v1', 'hi', 'native'), cacheKey('x', 'v1', 'mr', 'native'));
  assert.notEqual(cacheKey('x', 'v1', 'hi', 'native'), cacheKey('x', 'v2', 'hi', 'native'));
  const latin = new MockTimbre({ lang: 'hi', voice: 'v1', script: 'latin' });
  const native = new MockTimbre({ lang: 'hi', voice: 'v1', script: 'native' });
  for await (const _ of latin.stream('cache-probe')) { /* fill */ } // eslint-disable-line no-unused-vars
  assert.ok(TTS_CACHE.has(latin.key('cache-probe')));
  assert.ok(!TTS_CACHE.has(native.key('cache-probe')), 'native must not reuse latin audio');
  await native.prewarm(['cache-probe']);
  assert.ok(TTS_CACHE.has(native.key('cache-probe')));
});

test('e2e: mock loop over the real WebSocket — disambiguate, short answer, correct, commit, query', { timeout: 30000 }, async () => {
  const { spawn } = require('node:child_process');
  const WebSocket = require('ws');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-e2e-'));
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '0', MOCK_VOICE: '1',
    TTS_SCRIPT: 'native', LEDGER_DB: path.join(dir, 'e2e.db'), TRANSCRIPT_KEY: 'ab'.repeat(32) } });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      srv.stdout.on('data', (d) => { out += d; const m = out.match(/localhost:(\d+)/); if (m) resolve(Number(m[1])); });
      srv.on('exit', (c) => reject(new Error(`server exited ${c}: ${out}`)));
    });
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const agent = [], intents = [];
    let ledger = null, waiter = null;
    ws.on('message', (d, bin) => {
      if (bin) return;
      const m = JSON.parse(String(d));
      if (m.type === 'agent') agent.push(m.text);
      if (m.type === 'intent') intents.push(m.intent);
      if (m.type === 'ledger') ledger = m;
      if (m.type === 'tts_end') {
        ws.send(JSON.stringify({ type: 'play_start', t: 1 }));
        ws.send(JSON.stringify({ type: 'play_end', gen: m.gen }));
        if (waiter) { const w = waiter; waiter = null; w(); }
      }
    });
    await new Promise((r) => ws.on('open', r));
    const spoken = () => new Promise((r) => { waiter = r; });
    let done = spoken();
    ws.send(JSON.stringify({ type: 'hello', lang: 'hi' }));
    await done;
    assert.equal(agent[0], G.aiDisclosure('hi', 'native').safeReply, 'AI disclosure is the literal first turn');

    const turn = async () => {
      ws.send(JSON.stringify({ type: 'ptt_down' }));
      for (let i = 0; i < 25; i++) ws.send(Buffer.alloc(640));
      await new Promise((r) => setTimeout(r, 20));
      const p = spoken();
      ws.send(JSON.stringify({ type: 'ptt_up', t: 0 }));
      await p;
      return agent[agent.length - 1];
    };
    assert.equal(await turn(), 'कौन से रमेश: गली वाला या स्टेशन वाला?');      // "रमेश का 340 उधार, कल 200 दिया था"
    assert.match(await turn(), /^रमेश: तीन सौ चालीस रुपये उधार, कल दो सौ रुपये जमा। बाकी एक सौ चालीस रुपये। सही है\?$/); // "gali wala"
    assert.match(await turn(), /चार सौ तीस रुपये उधार.*बाकी दो सौ तीस रुपये/); // "नाही, 430"
    assert.equal(await turn(), 'लिख लिया। रमेश का दो सौ तीस रुपये बाकी है।'); // "हाँ"
    assert.equal(await turn(), 'कौन से रमेश: गली वाला या स्टेशन वाला?');      // "रमेश का टोटल?"
    assert.equal(await turn(), 'रमेश का दो सौ तीस रुपये बाकी है।');            // "गली वाला"
    assert.deepEqual(intents, ['disambiguate', 'add_entries', 'correct_slot', 'confirm', 'disambiguate', 'query_balance']);

    const [gali, station] = ledger.customers.filter((c) => c.name === 'Ramesh').sort((a, b) => a.id - b.id);
    assert.equal(gali.balancePaise, 23000);
    assert.equal(station.balancePaise, 0);
    for (const t of agent) {
      assert.doesNotMatch(t.replace(/\bAI\b/g, ''), /[A-Za-z]/, `mixed script in native mode: ${t}`);
      assert.ok(replyWords(t) <= 10, `reply over 10 words: ${t}`);
    }
    ws.close();
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Real adapters against local fake Gnani servers that enforce the documented protocol (no API calls) ----
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  return Promise.resolve().then(fn).finally(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; });
}
const COMMON = { GNANI_API_KEY: 'test-key', GNANI_AUTH_HEADER: 'x-api-key-id', GNANI_AUTH_VALUE: '{key}', GNANI_LANG_MAP: 'hi:hi-IN,mr:mr-IN,bn:bn-IN,en:en-IN' };

test('prisma adapter: headers, exact 1024-byte frames, VAD split joined into ONE final after commit', { timeout: 15000 }, async () => {
  const { WebSocketServer } = require('ws');
  const { PrismaAdapter } = require('./adapters/prisma');
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once('listening', r));
  const conns = [], bad = [];
  let frames = 0, commits = 0;
  wss.on('connection', (sock, req) => {
    conns.push(req.headers);
    if (!req.headers['language_code']) { sock.close(1008, 'language_code missing'); return; }
    sock.send(JSON.stringify({ type: 'connected' }));
    sock.on('message', (d, bin) => {
      if (bin) {
        if (d.length !== 1024) bad.push(d.length);
        frames++;
        if (frames === 2) sock.send(JSON.stringify({ type: 'speech_start' }));
        if (frames === 8) sock.send(JSON.stringify({ type: 'transcript', text: 'रमेश का 340', is_final: true })); // VAD split mid-turn
        if (frames === 9) sock.send(JSON.stringify({ type: 'speech_start' }));
        return;
      }
      if (JSON.parse(String(d)).type === 'commit') {
        commits++;
        sock.send(JSON.stringify({ type: 'processing' }));
        setTimeout(() => sock.send(JSON.stringify({ type: 'transcript', text: 'उधार', is_final: true })), 30);
      }
    });
  });
  const port = wss.address().port;
  await withEnv({ ...COMMON, GNANI_STT_WS_URL: `ws://localhost:${port}`,
    GNANI_STT_HEADERS: '{"model":"prisma-v3.0","language_code":"{lang}","x-sample-rate":"16000"}',
    GNANI_STT_FRAME_BYTES: '1024', GNANI_STT_FRAME_MS: '32', GNANI_STT_END_MESSAGE: '{"type":"commit"}', GNANI_STT_EVENT_FIELD: 'type',
    GNANI_STT_FINAL_EVENT: 'transcript', GNANI_STT_SPEECH_EVENT: 'speech_start', GNANI_STT_ERROR_EVENT: 'error', GNANI_STT_TEXT_FIELD: 'text',
    GNANI_STT_PARTIAL_EVENT: '', GNANI_STT_START_MESSAGE: '' }, async () => {
    const p = new PrismaAdapter({ lang: 'mr' });
    const partials = [];
    p.on('partial', (t) => partials.push(t));
    p.on('error', () => {});
    p.connect();
    await new Promise((r) => p.once('open', r));
    const finalP = new Promise((r) => p.once('final', r));
    const t0 = Date.now();
    p.start();
    for (let i = 0; i < 25; i++) p.sendPcm(Buffer.alloc(640)); // 500 ms of 20 ms client frames, sent as a burst
    await new Promise((r) => setTimeout(r, 350));
    p.end();
    const final = await finalP;
    assert.equal(final, 'रमेश का 340 उधार', 'one final for the whole push-to-talk turn');
    assert.deepEqual(partials, ['रमेश का 340']);
    assert.deepEqual(bad, [], 'every frame exactly 1024 bytes');
    assert.equal(frames, Math.ceil((25 * 640) / 1024));
    assert.equal(commits, 1);
    assert.ok(Date.now() - t0 < 1500, 'endpoint is not delayed by pacing');
    const h = conns[0];
    assert.deepEqual([h['x-api-key-id'], h.model, h.language_code, h['x-sample-rate']], ['test-key', 'prisma-v3.0', 'mr-IN', '16000']);

    // Headers are fixed per connection: switching language reconnects with the new code.
    p.lang = 'bn';
    await new Promise((r) => p.once('open', r));
    assert.equal(conns[1].language_code, 'bn-IN');
    p.close();
  });
  await new Promise((r) => wss.close(r));
});

test('timbre adapter: hi-IN request, base64 audio, error ends the reply, barge-in never leaks stale audio', { timeout: 15000 }, async () => {
  const { WebSocketServer } = require('ws');
  const { TimbreAdapter } = require('./adapters/timbre');
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.once('listening', r));
  const requests = [];
  let connections = 0;
  wss.on('connection', (sock, req) => {
    connections++;
    assert.equal(req.headers['x-api-key-id'], 'test-key');
    sock.on('message', (d) => {
      const r = JSON.parse(String(d));
      requests.push(r);
      const marker = requests.length; // every byte of this reply's audio = its request number
      const chunk = () => JSON.stringify({ type: 'audio', data: { audio: Buffer.alloc(640, marker).toString('base64'), is_final: false } });
      const rid = `req-${marker}`;
      sock.send(JSON.stringify({ type: 'start', message: 'Streaming started', request_id: rid }));
      if (r.text.startsWith('boom')) { sock.send(JSON.stringify({ type: 'error', message: 'Invalid text' })); return; }
      const n = r.text.startsWith('long') ? 20 : 3;
      let i = 0;
      const iv = setInterval(() => {
        if (sock.readyState !== 1) return clearInterval(iv);
        if (i++ < n) { sock.send(chunk()); return; }
        clearInterval(iv);
        // As observed on the live API: two 'complete' messages, the second (with request_id) a moment later.
        sock.send(JSON.stringify({ type: 'complete', data: { audio: '', is_final: true } }));
        setTimeout(() => { if (sock.readyState === 1) sock.send(JSON.stringify({ type: 'complete', message: 'Streaming completed', request_id: rid })); }, 15);
      }, 10);
    });
  });
  const port = wss.address().port;
  await withEnv({ ...COMMON, GNANI_TTS_WS_URL: `ws://localhost:${port}`, GNANI_TTS_VOICE: 'Shivani', GNANI_TTS_SAMPLE_RATE: '16000',
    GNANI_TTS_REQUEST_TEMPLATE: '{"text":"{text}","voice":"{voice}","model":"timbre-v3.0","language":"{lang}","audio_config":{"sample_rate":16000,"container":"raw"}}',
    GNANI_TTS_AUDIO_FIELD: 'data.audio', GNANI_TTS_EVENT_FIELD: 'type', GNANI_TTS_END_EVENT: 'complete', GNANI_TTS_ERROR_EVENT: 'error', GNANI_TTS_CANCEL_MESSAGE: '' }, async () => {
    const t = new TimbreAdapter({ lang: 'hi', script: 'native' });
    const errLog = console.error; console.error = () => {};
    try {
      const got = [];
      for await (const c of t.stream(`नमस्ते ${Date.now()}`)) got.push(c);
      assert.equal(Buffer.concat(got).length, 3 * 640);
      assert.equal(requests[0].language, 'hi-IN');
      assert.equal(requests[0].voice, 'Shivani');
      assert.equal(requests[0].model, 'timbre-v3.0');
      assert.match(requests[0].text, /^नमस्ते/);

      const errored = [];
      for await (const c of t.stream(`boom ${Date.now()}`)) errored.push(c); // must END, not hang
      assert.equal(errored.length, 0);

      // Barge-in mid-reply: the rest of request 3 must never show up in request 4.
      let n = 0;
      for await (const c of t.stream(`long ${Date.now()}`)) { assert.equal(c[0], 3); if (++n === 2) { t.flush(); break; } }
      const next = [];
      for await (const c of t.stream(`short ${Date.now()}`)) next.push(c);
      assert.ok(next.length > 0 && next.every((c) => c.every((b) => b === 4)), 'only the new reply\'s audio');
      assert.equal(connections, 2, 'barge-in dropped the socket; the next reply reconnected');

      // Back-to-back segments: the late second 'complete' of one reply must not end the next one.
      const a = [], b = [];
      for await (const c of t.stream(`seg-a ${Date.now()}`)) a.push(c);
      for await (const c of t.stream(`seg-b ${Date.now()}`)) b.push(c);
      assert.equal(a.length, 3);
      assert.equal(b.length, 3, 'second segment not truncated by the first one\'s late complete');
    } finally { console.error = errLog; t.close(); }
  });
  await new Promise((r) => wss.close(r));
});

test('.env.example never contains real secrets (it is committed)', () => {
  const ex = fs.readFileSync(path.join(__dirname, '.env.example'), 'utf8');
  for (const k of ['GNANI_API_KEY', 'TRANSCRIPT_KEY']) {
    const m = ex.match(new RegExp(`^${k}=([^#\\n]*)`, 'm'));
    assert.ok(m, `${k} line present`);
    assert.equal(m[1].trim(), '', `${k} must be empty in .env.example — put it in .env`);
  }
});

test('parser: real Prisma v3.0 transcript (live probe) — no comma between clauses, digits, danda', () => {
  // Verbatim from npm run probe against wss://api.vachana.ai/stt/v3/stream, 2026-11-13.
  const r = parse('रमेश का 340 रुपये उधार कल 200 दिया था।', { today: TODAY });
  assert.equal(r.intent, 'add_entries');
  assert.deepEqual(r.entries.map((e) => [e.customer.name, e.direction, e.paise, e.date]), [
    ['Ramesh', 'credit', 34000, TODAY],
    ['Ramesh', 'payment', 20000, YESTERDAY],
  ]);
  assert.deepEqual(parse('Ramesh ko 200 diya Suresh ne 300 diya', { today: TODAY }).entries.map((e) => [e.customer.name, e.direction]),
    [['Ramesh', 'credit'], ['Suresh', 'payment']]);
  assert.equal(parse('Ramesh 200 300', { today: TODAY }).intent, 'clarify'); // no direction word between: never guess a split
});

test('langpacks: reply-language detection returns a score, and ties stay on Hindi', () => {
  const { detectLangScore } = require('./core/langpacks');
  const mr = detectLangScore(['kiti', 'baki', 'aahe']);
  assert.equal(mr.lang, 'mr');
  assert.ok(mr.score >= 2, 'Marathi sentence must score at least 2');
  assert.equal(detectLangScore(['ramesh', '340']).score, 0, 'names and digits are not language evidence');
});

test('parser: confidence-gated replyLang, parsing still on the union lexicon', () => {
  const mr = parse('kiti baki aahe', { lang: 'hi' });
  assert.equal(mr.replyLang, 'mr', 'a Marathi utterance asks for a Marathi reply');
  const bare = parse('ramesh 340', { lang: 'hi' });
  assert.equal(bare.replyLang, undefined, 'no lexicon evidence means no language switch');
  const hi = parse('ramesh ka 340 udhaar', { lang: 'bn' });
  assert.equal(hi.replyLang, 'hi', 'reply language does not change how the words are parsed');
  assert.equal(hi.intent, 'add_entries', 'Hindi parsed even with a Bengali session language');
});

test('securestore: list decrypts newest first, and reports rows the key cannot open', () => {
  const { SecureStore } = require('./core/securestore');
  const store = new SecureStore(':memory:', 'cd'.repeat(32));
  store.put(JSON.stringify({ role: 'user', text: 'pehla', at: '2026-11-13T10:00:00Z' }));
  store.put(JSON.stringify({ role: 'agent', text: 'doosra', at: '2026-11-13T10:00:01Z' }));
  const rows = store.list(10);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, 'doosra');
  assert.equal(rows[1].role, 'user');
  assert.equal(store.count(), 2);
  const wrong = new SecureStore(':memory:', 'ef'.repeat(32));
  assert.equal(wrong.list(5).length, 0);
});

test('e2e: typed turns, a real purge, and reseeding over HTTP', { timeout: 30000 }, async () => {
  const { spawn } = require('node:child_process');
  const WebSocket = require('ws');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khata-typed-'));
  const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: '0', MOCK_VOICE: '1',
    TTS_SCRIPT: 'native', LEDGER_DB: path.join(dir, 'typed.db'), TRANSCRIPT_KEY: 'ab'.repeat(32) } });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      srv.stdout.on('data', (d) => { out += d; const m = out.match(/localhost:(\d+)/); if (m) resolve(Number(m[1])); });
      srv.on('exit', (c) => reject(new Error(`server exited ${c}: ${out}`)));
    });
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    let ledger = null, waiter = null;
    ws.on('message', (d, bin) => {
      if (bin) return;
      const m = JSON.parse(String(d));
      if (m.type === 'ledger') ledger = m;
      if (m.type === 'tts_end') {
        ws.send(JSON.stringify({ type: 'play_end', gen: m.gen }));
        if (waiter) { const w = waiter; waiter = null; w(); }
      }
    });
    await new Promise((r) => ws.on('open', r));
    const spoken = () => new Promise((r) => { waiter = r; });
    let done = spoken();
    ws.send(JSON.stringify({ type: 'hello', lang: 'hi' }));
    await done;

    const say = async (text) => {
      const p = spoken();
      ws.send(JSON.stringify({ type: 'text', text }));
      await p;
    };
    await say('ramesh ka 300 udhaar');             // ambiguous: two Rameshes
    await say('gali wala');                        // completes the pending question
    await say('haan');                             // commits
    const ramesh = ledger.customers.find((c) => c.balancePaise === 30000);
    assert.ok(ramesh, `typed loop committed a 300 rupee credit, got ${JSON.stringify(ledger.customers)}`);

    const tx = await (await fetch(`http://localhost:${port}/transcripts`, { headers: { 'x-khata': '1' } })).json();
    assert.ok(tx.transcripts.length > 0, 'stored transcripts are readable through the local audit endpoint');
    assert.ok(tx.transcripts.some((t) => t.role === 'user' && /ramesh/i.test(t.text)));

    const post = (p) => fetch(`http://localhost:${port}${p}`, { method: 'POST', headers: { 'x-khata': '1' } });
    const withoutHeader = await fetch(`http://localhost:${port}/purge`, { method: 'POST' });
    assert.equal(withoutHeader.status, 403, 'purge needs its header');

    const purged = await (await post('/purge')).json();
    assert.equal(purged.customers, 0);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(ledger.customers.length, 0, 'purge leaves no customers behind');
    assert.equal(ledger.totalPaise, 0);

    const seeded = await (await post('/seed')).json();
    assert.ok(seeded.customers >= 2, 'seed brings the synthetic roster back');
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(ledger.customers.length >= 2);

    const after = await (await fetch(`http://localhost:${port}/transcripts`, { headers: { 'x-khata': '1' } })).json();
    assert.equal(after.transcripts.length, 0, 'purge removes the transcripts too');
    ws.close();
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
