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
