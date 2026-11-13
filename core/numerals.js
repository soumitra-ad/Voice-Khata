'use strict';
// Pure, deterministic amount normaliser. No network, no LLM.
const { UNION, PACKS } = require('./langpacks');
const { toLatin, canonicalKey, isNative } = require('./translit');

const words = (s) => s.trim().split(/\s+/);

// Script normalisation applied to input AND to every lexicon key, so both sides match:
// NFD -> drop nukta -> NFC, chandrabindu -> anusvara (पाँच = पांच), zero-width chars removed, danda -> comma.
const normText = (s) => String(s || '').normalize('NFD').replace(/[़়]/g, '').normalize('NFC')
  .replace(/[​-‍⁠﻿]/g, '').replace(/ँ/g, 'ं').replace(/[।॥]/g, ',');

// 0-100 LOOKUP TABLES. Indic numerals are irregular: never generate them by rule.
// Romanised tables are also used by toWords() for spoken output.
const TABLES = {
  hi: words(`shunya ek do teen chaar paanch chhah saat aath nau das gyaarah baarah terah chaudah
    pandrah solah satrah athaarah unnees bees ikkees baaees teyees chaubees pachchees chhabbees
    sattaaees atthaaees untees tees ikattees battees taintees chauntees paintees chhattees saintees
    adtees untaalees chaalees iktaalees bayaalees taintaalees chavaalees paintaalees chhiyaalees
    saintaalees adtaalees unchaas pachaas ikyaavan baavan tirpan chauvan pachpan chhappan sattaavan
    atthaavan unsath saath iksath baasath tirsath chaunsath painsath chhiyaasath sadsath adsath
    unhattar sattar ikhattar bahattar tihattar chauhattar pachhattar chhihattar satattar athattar
    unaasi assi ikyaasi bayaasi tiraasi chauraasi pachaasi chhiyaasi sattaasi atthaasi navaasi
    nabbe ikyaanave baanave tiraanave chauraanave pachaanave chhiyaanave sattaanave atthaanave
    ninyaanave sau`),
  // TODO native-speaker verify (Marathi romanisation)
  mr: words(`shunya ek don teen chaar paach saha saat aath nau daha akra baara tera chauda pandhra
    sola satra athra ekonis vees ekvees bavees tevees chovees panchvees savvees sattavees atthavees
    ekonatees tees ekatees battees tehetees chautees pastees chhattees sadtees adtees ekonchalees
    chalees ekechalees behechalees trechalees chavvechalees panchechalees sehechalees sattechalees
    atthechalees ekonpannas pannas ekkyavanna bavanna trepanna chopanna pachpanna chhappanna
    sattavanna atthavanna ekonsaath saath eksashta basashta tresashta chausashta pasashta
    sahasashta sadusashta adusashta ekonsattar sattar ekahattar bahattar tryahattar chauryahattar
    panchyahattar shahattar sattyahattar attyahattar ekonainshi aianshi ekyaainshi byaainshi
    tryaainshi chauryaainshi pachyaainshi shahaainshi sattyaainshi attyaainshi ekonnavvad navvad
    ekyannav byannav tryannav chauryannav pachyannav shahannav sattyannav attyannav navvyannav
    shambhar`),
  // TODO native-speaker verify (Bengali romanisation)
  bn: words(`shunno ek dui tin char panch chhoy saat aat noy dosh egaro baro tero choddo ponero
    sholo sotero atharo unish bish ekush baish teish chobbish pochish chhabbish satash athash
    unotrish trish ekatrish batrish tetrish choutrish poyotrish chhotrish saitrish attrish
    unochollish chollish ekchollish beyallish tetallish chuyallish poyotallish chhechollish
    satchollish atchollish unoponchash ponchash ekanno bahanno tippanno chuyanno pochpanno
    chhappanno satanno athanno unoshatt shatt ekshotti bashotti teshotti choushotti poyshotti
    chheshotti satshotti atshotti unosottor sottor ekattor bahattor tiyattor chuyattor pochattor
    chhiyattor sattattor athattor unoashi ashi ekashi biraashi tiraashi churaashi pochashi
    chhiyashi sataashi attashi unonobboi nobboi ekanobboi biranobboi tiranobboi churanobboi
    pochanobboi chhiyanobboi satanobboi atanobboi niranobboi eksho`),
  en: (() => {
    const ones = words(`zero one two three four five six seven eight nine ten eleven twelve thirteen
      fourteen fifteen sixteen seventeen eighteen nineteen`);
    const tens = words('twenty thirty forty fifty sixty seventy eighty ninety');
    const t = [...ones];
    for (const ten of tens) for (let u = 0; u < 10; u++) t.push(u ? `${ten}-${ones[u]}` : ten); // tokenizer splits "-", runs compose "twenty one"
    return [...t, 'hundred'];
  })(),
};

// Native-script tables (parse only).
const NATIVE = {
  hi: words(`शून्य एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस
    बीस इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस
    पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चौवालीस पैंतालीस छियालीस
    सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ
    इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर
    पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी
    अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे सौ`),
  // TODO native-speaker verify (Bengali script)
  bn: words(`শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চোদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ
    কুড়ি একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আঠাশ ঊনত্রিশ ত্রিশ একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ
    পঁয়ত্রিশ ছত্রিশ সাঁইত্রিশ আটত্রিশ ঊনচল্লিশ চল্লিশ একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ
    ছেচল্লিশ সাতচল্লিশ আটচল্লিশ ঊনপঞ্চাশ পঞ্চাশ একান্ন বাহান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন
    আটান্ন ঊনষাট ষাট একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি সাতষট্টি আটষট্টি ঊনসত্তর সত্তর
    একাত্তর বাহাত্তর তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর ঊনআশি আশি একাশি বিরাশি তিরাশি
    চুরাশি পঁচাশি ছিয়াশি সাতাশি অষ্টআশি ঊননব্বই নব্বই একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই
    ছিয়ানব্বই সাতানব্বই আটানব্বই নিরানব্বই একশো`),
  // TODO native-speaker verify (Marathi Devanagari)
  mr: words(`शून्य एक दोन तीन चार पाच सहा सात आठ नऊ दहा अकरा बारा तेरा चौदा पंधरा सोळा सतरा अठरा एकोणीस
    वीस एकवीस बावीस तेवीस चोवीस पंचवीस सव्वीस सत्तावीस अठ्ठावीस एकोणतीस तीस एकतीस बत्तीस तेहेतीस चौतीस
    पस्तीस छत्तीस सदतीस अडतीस एकोणचाळीस चाळीस एक्केचाळीस बेचाळीस त्रेचाळीस चव्वेचाळीस पंचेचाळीस सेहेचाळीस
    सत्तेचाळीस अठ्ठेचाळीस एकोणपन्नास पन्नास एक्कावन्न बावन्न त्रेपन्न चोपन्न पंचावन्न छप्पन्न सत्तावन्न
    अठ्ठावन्न एकोणसाठ साठ एकसष्ट बासष्ट त्रेसष्ट चौसष्ट पासष्ट सहासष्ट सदुसष्ट अडुसष्ट एकोणसत्तर सत्तर
    एक्काहत्तर बाहत्तर त्र्याहत्तर चौऱ्याहत्तर पंच्याहत्तर शहात्तर सत्याहत्तर अठ्ठ्याहत्तर एकोणऐंशी ऐंशी
    एक्क्याऐंशी ब्याऐंशी त्र्याऐंशी चौऱ्याऐंशी पंच्याऐंशी शहाऐंशी सत्त्याऐंशी अठ्ठ्याऐंशी एकोणनव्वद नव्वद
    एक्क्याण्णव ब्याण्णव त्र्याण्णव चौऱ्याण्णव पंच्याण्णव शहाण्णव सत्त्याण्णव अठ्ठ्याण्णव नव्व्याण्णव शंभर`),
};
for (const [l, t] of [...Object.entries(TABLES), ...Object.entries(NATIVE)]) {
  if (t.length !== 101) throw new Error(`numeral table ${l} has ${t.length} entries`);
}

// Spelling variants (exact keys).
const VARIANTS = {
  hi: { char: 4, panch: 5, chhe: 6, che: 6, chah: 6, chhah: 6, gyarah: 11, barah: 12, unnis: 19, ikkis: 21, baais: 22, teis: 23,
    chaubis: 24, pachis: 25, pachchis: 25, chhabbis: 26, sattais: 27, atthais: 28, iktis: 31, saintis: 37, chalis: 40,
    pachas: 50, sath: 60, ninyanve: 99, 'छः': 6, 'छे': 6, 'पांच': 5, 'उन्नासी': 79, 'निन्यानवे': 99 },
  mr: { sadtis: 37, pach: 5, dahaa: 10, chalis: 40 },
  bn: { 'বিশ': 20, 'ছয়': 6, 'ষোল': 16, 'চোদ্দো': 14, 'আটাশি': 88 },
  en: { fourty: 40 },
};

const nmap = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [normText(k), v]));
const SCALES = nmap({ sau: 100, sou: 100, saw: 100, sho: 100, she: 100, shambhar: 100, hundred: 100,
  hazaar: 1000, hazar: 1000, hajar: 1000, hajaar: 1000, thousand: 1000,
  lakh: 1e5, lac: 1e5, lakhs: 1e5, laakh: 1e5, crore: 1e7, karod: 1e7, karor: 1e7, koti: 1e7,
  'सौ': 100, 'शंभर': 100, 'हज़ार': 1000, 'हजार': 1000, 'लाख': 1e5, 'करोड़': 1e7,
  'শো': 100, 'শ': 100, 'একশো': 100, 'একশ': 100, 'হাজার': 1000, 'লাখ': 1e5, 'কোটি': 1e7 });
// Fraction idioms. MOD shifts the following number (sava teen = 3.25); NUM stands alone (dhai = 2.5).
const IDIOM_MOD = nmap({ sava: 0.25, savaa: 0.25, sawa: 0.25, savva: 0.25, soya: 0.25, paune: -0.25, pone: -0.25, paun: -0.25,
  sadhe: 0.5, saadhe: 0.5, sade: 0.5, saade: 0.5,
  'सवा': 0.25, 'पौने': -0.25, 'साढ़े': 0.5, 'সোয়া': 0.25, 'পৌনে': -0.25, 'সাড়ে': 0.5 });
const IDIOM_NUM = nmap({ dedh: 1.5, derh: 1.5, dedha: 1.5, deedh: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5, arhai: 2.5, adich: 2.5,
  arai: 2.5, adha: 0.5, aadha: 0.5, ardha: 0.5, half: 0.5,
  'डेढ़': 1.5, 'ढाई': 2.5, 'अढ़ाई': 2.5, 'आधा': 0.5, 'দেড়': 1.5, 'আড়াই': 2.5, 'আধা': 0.5 });
const CURRENCY = new Set(words('₹ rs rupaye rupay rupaya rupiya rupiye rupee rupees rupe inr taka tk रुपये रुपए रुपया रुपैया रु টাকা').map(normText));
const UNITS = nmap({ kilo: 'kg', kg: 'kg', kilogram: 'kg', kilos: 'kg', gram: 'g', gm: 'g', grams: 'g', litre: 'l', liter: 'l',
  ltr: 'l', litres: 'l', packet: 'packet', packets: 'packet', dozen: 'dozen', darjan: 'dozen', piece: 'piece', pieces: 'piece',
  pcs: 'piece', meter: 'm', metre: 'm', quintal: 'quintal', bori: 'bag', bag: 'bag',
  'किलो': 'kg', 'ग्राम': 'g', 'लीटर': 'l', 'दर्जन': 'dozen', 'पैकेट': 'packet', 'কেজি': 'kg', 'কিলো': 'kg', 'গ্রাম': 'g', 'লিটার': 'l' });

const LANGS = ['hi', 'mr', 'bn', 'en'];
const EXACT = {};
for (const l of LANGS) {
  EXACT[l] = new Map();
  for (const t of [TABLES[l], NATIVE[l] || []]) t.forEach((w, i) => { const k = normText(w); if (!SCALES[k]) EXACT[l].set(k, i); });
  for (const [w, v] of Object.entries(VARIANTS[l])) EXACT[l].set(normText(w), v);
}
// Canonical tier (after exact, before fuzzy). A key that folds two different numerals together matches neither.
const CANON_NUM = new Map();
for (const l of LANGS) for (const [k, v] of EXACT[l]) {
  const c = canonicalKey(k);
  if (!CANON_NUM.has(c)) CANON_NUM.set(c, new Set());
  CANON_NUM.get(c).add(v);
}
const FUZZY_KEYS =[...new Map(LANGS.flatMap((l) => [...EXACT[l]])).entries()].map(([k, v]) => ({ k: [...k], v }));
// Never fuzzy-match ordinary lexicon words into numbers ("hai" must not become "dhai").
const NO_FUZZY = new Set([...UNION.all, ...CURRENCY, ...Object.keys(UNITS), ...Object.keys(SCALES), ...Object.keys(IDIOM_MOD), ...Object.keys(IDIOM_NUM)]);

function editDistance(a, b, max) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Fuzzy match WITHIN THE NUMERAL LEXICON ONLY: <=1 edit under 6 chars, <=2 otherwise.
// shortcut: words under 4 chars are never fuzzed (too many collisions: ko/do, de/do); revisit with real ASR logs.
function fuzzyNumber(w) {
  const cps = [...w];
  if (cps.length < 4 || NO_FUZZY.has(w)) return null;
  const max = cps.length < 6 ? 1 : 2;
  let best = max + 1, vals = new Set();
  for (const { k, v } of FUZZY_KEYS) {
    if (Math.abs(k.length - cps.length) > max) continue;
    const d = editDistance(cps, k, max);
    if (d < best) { best = d; vals = new Set([v]); } else if (d === best) vals.add(v);
  }
  return best <= max && vals.size === 1 ? { v: [...vals][0], fuzzy: true } : null; // tie between different values -> no match
}

// shortcut: tokens under 4 chars never fold canonically into numerals (de/do, ko/do); revisit with real ASR logs.
function canonNumber(w) {
  if ([...w].length < 4 || NO_FUZZY.has(w)) return null;
  const vals = CANON_NUM.get(canonicalKey(w));
  return vals && vals.size === 1 ? { v: [...vals][0], fuzzy: true } : null;
}

// Number value of a single string (not a scale). Ladder: exact -> canonical -> fuzzy. Returns {v, digit, fuzzy, idiom} or null.
function numberOf(w, lang, allowLoose) {
  if (/^\d+(\.\d+)?$/.test(w)) return { v: parseFloat(w), digit: true };
  if (SCALES[w]) return null;
  if (IDIOM_NUM[w] !== undefined) return { v: IDIOM_NUM[w], idiom: true };
  const order = [lang, ...LANGS.filter((l) => l !== lang)].filter((l) => EXACT[l]);
  for (const l of order) if (EXACT[l].has(w)) return { v: EXACT[l].get(w) };
  return allowLoose ? canonNumber(w) || fuzzyNumber(w) : null;
}

// Token-aware: the native-script form (tok.o) is an exact fast path that loose Latin matching can never override.
function tokNumber(tok, lang, allowLoose) {
  if (tok.native && !SCALES[tok.o]) {
    const n = numberOf(tok.o, lang, false);
    if (n) return n;
  }
  return numberOf(tok.t, lang, allowLoose);
}
const tokScale = (tok) => SCALES[tok.o] || SCALES[tok.t];
const tokMod = (tok) => (IDIOM_MOD[tok.o] !== undefined ? IDIOM_MOD[tok.o] : IDIOM_MOD[tok.t]);
const tokCurrency = (tok) => !!tok && (CURRENCY.has(tok.o) || CURRENCY.has(tok.t));
const tokUnit = (tok) => tok && (UNITS[tok.o] || UNITS[tok.t]);

// Hundreds glued onto the number: "tinsho", "তিনশো", "panchshe".
function splitHundreds(tok, lang) {
  for (const w of new Set([tok.o, tok.t])) {
    for (const suf of ['sho', 'she', 'sau', 'শো', 'শ', 'सौ']) {
      if (w.length > suf.length + 1 && w.endsWith(suf)) {
        const n = numberOf(w.slice(0, -suf.length), lang, false);
        if (n && !n.digit) return n;
      }
    }
  }
  return null;
}

const ZEROS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];
const foldDigits = (s) => s.replace(/[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯０-９]/g,
  (c) => { const cp = c.codePointAt(0); return String(cp - ZEROS.find((z) => cp >= z && cp <= z + 9)); });

// Tokens: raw = original script (display), o = normalised native form (exact native lookups),
// t = Latin form used for all lexicon matching (transliterated when native). The input text is never modified.
function tokenize(text) {
  const s = foldDigits(String(text || '')).normalize('NFC').replace(/[​-‍⁠﻿]/g, '')
    .replace(/[।॥]/g, ',').toLowerCase().replace(/(\d),(?=\d)/g, '$1');
  const out = [];
  for (const m of s.matchAll(/\d+(?:\.\d+)?|[\p{L}\p{M}]+|[₹,?|]/gu)) {
    const raw = m[0], native = isNative(raw);
    out.push({ t: native ? toLatin(raw) : raw, o: native ? normText(raw) : raw, raw, native, s: m.index, e: m.index + raw.length });
  }
  return out;
}

// Read one numeric run starting at token i. Returns null if token i does not start a number.
// opts.exclude: tokens (known customer names) that must never be read as numbers.
function readRun(toks, i, lang, opts = {}) {
  let j = i, total = 0, cur = 0, mod = null, any = false, lastScale = false, prevDigit = false, conf = 0.98;
  let currency = false, anchored = false, digit = false;
  if (tokCurrency(toks[j])) { currency = true; j++; }
  const addNum = (n) => {
    let v = n.v;
    if (mod !== null) { v += mod; mod = null; conf = Math.min(conf, 0.85); }
    if (!n.digit) conf = Math.min(conf, n.fuzzy ? 0.8 : n.idiom ? 0.85 : 0.9);
    const words2 = !n.digit && !prevDigit;
    if (!any || (cur === 0 && lastScale)) cur = v;
    else if (lastScale && v < 100) cur += v; // teen sau chaalis
    else if (words2 && cur >= 20 && cur < 100 && cur % 10 === 0 && v < 10) cur += v; // twenty one
    else if (words2 && cur >= 1 && cur < 100 && v >= 10 && v < 100) { cur = cur * 100 + v; conf = Math.min(conf, 0.75); } // three forty
    else return false;
    any = true; lastScale = false; prevDigit = !!n.digit;
    if (!n.fuzzy) anchored = true;
    if (n.digit) digit = true;
    return true;
  };
  const addScale = (s) => {
    const base = cur || (mod !== null ? 1 + mod : 1);
    if (mod !== null) conf = Math.min(conf, 0.85);
    mod = null;
    if (s === 100) cur = base * 100; else { total += base * s; cur = 0; }
    any = true; lastScale = true; prevDigit = false; anchored = true;
  };
  for (; j < toks.length; j++) {
    const tok = toks[j], w = tok.t;
    if (opts.exclude && opts.exclude.has(w)) break; // known customer name: never a numeral, exact or fuzzy
    const n = tokNumber(tok, lang, !(opts.noLoose && opts.noLoose.has(w)));
    if (n) { if (!addNum(n)) break; continue; }
    const sc = tokScale(tok);
    if (sc) { addScale(sc); continue; }
    const h = splitHundreds(tok, lang);
    if (h) { if (!addNum(h)) break; addScale(100); continue; }
    const md = tokMod(tok);
    if (md !== undefined && (!any || lastScale)) { mod = md; continue; }
    if (w === 'and' && any && toks[j + 1] && tokNumber(toks[j + 1], lang, false)) continue;
    break;
  }
  if (!any) return null;
  let unit = null;
  if (tokCurrency(toks[j])) { currency = true; j++; } else if (tokUnit(toks[j])) { unit = tokUnit(toks[j]); j++; }
  // A run made only of fuzzy guesses, with no exact numeral, scale or currency word, is rejected.
  if (!anchored && !currency) return null;
  // "do" is also the Hindi imperative "give": a bare, unanchored "do" is not trusted as an amount.
  if (j - i === 1 && toks[i].t === 'do' && !toks[i].native) conf = 0.3;
  const value = total + cur;
  return { value, paise: Math.round(value * 100), confidence: conf, kind: unit ? 'quantity' : 'money', unit,
    currency, digit, span: [toks[i].s, toks[j - 1].e], start: i, end: j };
}

function scanTokens(toks, lang = 'hi', opts = {}) {
  const runs = [];
  for (let i = 0; i < toks.length;) {
    const r = readRun(toks, i, lang, opts);
    if (r) { runs.push(r); i = r.end; } else i++;
  }
  return runs;
}

// Trusted money run; a digit run beats a word parse.
function pickMoney(runs) {
  const money = runs.filter((r) => r.kind === 'money' && r.confidence >= 0.5);
  return money.find((r) => r.digit) || money[0];
}

const findAmounts = (text, lang = 'hi') => scanTokens(tokenize(text), lang);

// Best money amount; else the first run of any kind (e.g. a quantity).
function normaliseAmount(text, lang = 'hi') {
  const runs = findAmounts(text, lang);
  const r = pickMoney(runs) || runs[0];
  if (!r) return { value: null, paise: null, confidence: 0, kind: null, unit: null, span: null };
  const { value, paise, confidence, kind, unit, span } = r;
  return { value, paise, confidence, kind, unit, span };
}

// Exact-only: used by the parser to keep numeral words out of customer names.
const isNumeralWord = (w) => !!(SCALES[w] || IDIOM_MOD[w] !== undefined || IDIOM_NUM[w] !== undefined || CURRENCY.has(w) ||
  UNITS[w] || numberOf(w, 'hi', false) || w === 'and');
const isNumeralToken = (tok) => !!(isNumeralWord(tok.t) || tokScale(tok) || tokMod(tok) !== undefined || tokCurrency(tok) ||
  tokUnit(tok) || (tok.native && numberOf(tok.o, 'hi', false)));

// Spoken words for an amount in paise. Indian grouping (lakh/crore) in every language.
const SPEAK = {
  hi: { scales: ['crore', 'lakh', 'hazaar', 'sau'], cur: 'rupaye', paise: 'paise', and: 'aur' },
  mr: { scales: ['koti', 'lakh', 'hajar', 'shambhar'], cur: 'rupaye', paise: 'paise', and: 'aani' },
  bn: { scales: ['koti', 'lakh', 'hajar', 'sho'], cur: 'taka', paise: 'poysha', and: 'ar' },
  en: { scales: ['crore', 'lakh', 'thousand', 'hundred'], cur: 'rupees', paise: 'paise', and: 'and' },
};
// Native script: the same NATIVE lookup tables, read in reverse (value -> word).
const SPEAK_NATIVE = {
  hi: { scales: ['करोड़', 'लाख', 'हज़ार', 'सौ'], cur: 'रुपये', paise: 'पैसे', and: 'और' },
  mr: { scales: ['कोटी', 'लाख', 'हजार', 'शंभर'], cur: 'रुपये', paise: 'पैसे', and: 'आणि' },
  bn: { scales: ['কোটি', 'লাখ', 'হাজার', 'শো'], cur: 'টাকা', paise: 'পয়সা', and: 'আর' },
};
// Joined native hundreds (mr तीनशे, bn তিনশ), read once at load. Hindi has none: it says तीन सौ.
const HUNDREDS = Object.fromEntries(['hi', 'mr', 'bn'].filter((l) => PACKS[l].hundreds_1_9).map((l) => [l, PACKS[l].hundreds_1_9]));
// script: 'latin' (romanised) or 'native' (Devanagari / Bengali). English has no native form.
function toWords(paise, lang = 'hi', script = 'latin') {
  const L = TABLES[lang] ? lang : 'hi';
  const nat = script === 'native' && NATIVE[L];
  const sp = nat ? SPEAK_NATIVE[L] : SPEAK[L], table = nat ? NATIVE[L] : TABLES[L], hundreds = nat && HUNDREDS[L];
  const say = (n) => {
    if (n < 100) return table[n];
    const parts = [];
    [1e7, 1e5, 1e3, 100].forEach((s, k) => {
      const q = Math.floor(n / s);
      if (q) { parts.push(s === 100 && hundreds ? hundreds[q - 1] : `${say(q)} ${sp.scales[k]}`); n %= s; }
    });
    if (n) parts.push(table[n]);
    return parts.join(' ');
  };
  const p = Math.abs(Math.round(paise)), r = Math.floor(p / 100), ps = p % 100;
  if (!ps) return `${say(r)} ${sp.cur}`;
  if (!r) return `${say(ps)} ${sp.paise}`;
  return `${say(r)} ${sp.cur} ${sp.and} ${say(ps)} ${sp.paise}`;
}

module.exports = { normaliseAmount, findAmounts, scanTokens, pickMoney, tokenize, normText, foldDigits, toWords, isNumeralWord, isNumeralToken, TABLES, SCALES };
