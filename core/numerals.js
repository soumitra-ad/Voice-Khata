'use strict';
// Pure, deterministic amount normaliser. No network, no LLM.

const words = (s) => s.trim().split(/\s+/);

// Romanised 0-100 LOOKUP TABLES. Indic numerals are irregular: never generate them by rule.
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
for (const [l, t] of Object.entries(TABLES)) if (t.length !== 101) throw new Error(`numeral table ${l} has ${t.length} entries`);

// Common spelling variants the fold below cannot reach.
const VARIANTS = {
  hi: { char: 4, panch: 5, chhe: 6, che: 6, chah: 6, chhah: 6, gyarah: 11, barah: 12, unnis: 19, ikkis: 21, baais: 22, teis: 23,
    chaubis: 24, pachis: 25, pachchis: 25, chhabbis: 26, sattais: 27, atthais: 28, iktis: 31, saintis: 37, chalis: 40,
    pachas: 50, sath: 60, assi: 80, nabbe: 90, ninyanve: 99 },
  mr: { sadtis: 37, pach: 5, dahaa: 10, chalis: 40, pannas: 50 },
  bn: { tinsho: 300 },
  en: { fourty: 40 },
};

const SCALES = { sau: 100, sou: 100, saw: 100, sho: 100, she: 100, shambhar: 100, hundred: 100,
  hazaar: 1000, hazar: 1000, hajar: 1000, hajaar: 1000, thousand: 1000,
  lakh: 1e5, lac: 1e5, lakhs: 1e5, laakh: 1e5, crore: 1e7, karod: 1e7, karor: 1e7, koti: 1e7 };
// Fraction idioms. MOD shifts the following number (sava teen = 3.25); NUM stands alone (dhai = 2.5).
const IDIOM_MOD = { sava: 0.25, savaa: 0.25, sawa: 0.25, savva: 0.25, soya: 0.25, paune: -0.25, pone: -0.25, paun: -0.25,
  sadhe: 0.5, saadhe: 0.5, sade: 0.5, saade: 0.5 };
const IDIOM_NUM = { dedh: 1.5, derh: 1.5, dedha: 1.5, deedh: 1.5, dhai: 2.5, dhaai: 2.5, adhai: 2.5, arhai: 2.5, adich: 2.5,
  arai: 2.5, adha: 0.5, aadha: 0.5, ardha: 0.5, half: 0.5 };
const CURRENCY = new Set(words('₹ rs rupaye rupay rupaya rupiya rupiye rupee rupees rupe inr taka tk'));
const UNITS = { kilo: 'kg', kg: 'kg', kilogram: 'kg', kilos: 'kg', gram: 'g', gm: 'g', grams: 'g', litre: 'l', liter: 'l',
  ltr: 'l', litres: 'l', packet: 'packet', packets: 'packet', dozen: 'dozen', darjan: 'dozen', piece: 'piece', pieces: 'piece',
  pcs: 'piece', meter: 'm', metre: 'm', quintal: 'quintal', bori: 'bag', bag: 'bag' };

// Loose spelling fold: aa->a, ee->i, oo->u, collapse doubled letters. Used only after exact lookup fails.
const fold = (w) => w.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a').replace(/(.)\1+/g, '$1');

const LANGS = ['hi', 'mr', 'bn', 'en'];
const EXACT = {}, FOLDED = {};
for (const l of LANGS) {
  EXACT[l] = new Map();
  TABLES[l].forEach((w, i) => { if (!SCALES[w]) EXACT[l].set(w, i); });
  for (const [w, v] of Object.entries(VARIANTS[l])) EXACT[l].set(w, v);
  FOLDED[l] = new Map();
  const clash = new Set();
  for (const [w, v] of EXACT[l]) {
    const f = fold(w);
    if (FOLDED[l].has(f) && FOLDED[l].get(f) !== v) clash.add(f);
    FOLDED[l].set(f, v);
  }
  for (const f of clash) FOLDED[l].delete(f);
}

function lookup(w, lang) {
  const order = [lang, ...LANGS.filter((l) => l !== lang)].filter((l) => EXACT[l]);
  for (const l of order) if (EXACT[l].has(w)) return { v: EXACT[l].get(w), fuzzy: false };
  const f = fold(w);
  for (const l of order) if (FOLDED[l].has(f)) return { v: FOLDED[l].get(f), fuzzy: true };
  return null;
}

// Number value of a single token (not a scale). Returns {v, digit, fuzzy, idiom} or null.
function numberOf(w, lang) {
  if (/^\d+(\.\d+)?$/.test(w)) return { v: parseFloat(w), digit: true };
  if (SCALES[w]) return null;
  if (IDIOM_NUM[w] !== undefined) return { v: IDIOM_NUM[w], idiom: true };
  return lookup(w, lang);
}

// Bengali/Marathi glue hundreds onto the number: "tinsho", "panchshe".
function splitHundreds(w, lang) {
  for (const suf of ['sho', 'she', 'sau']) {
    if (w.length > suf.length + 1 && w.endsWith(suf)) {
      const n = numberOf(w.slice(0, -suf.length), lang);
      if (n && !n.digit) return n;
    }
  }
  return null;
}

const ZEROS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];
const foldDigits = (s) => s.replace(/[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯０-９]/g,
  (c) => { const cp = c.codePointAt(0); return String(cp - ZEROS.find((z) => cp >= z && cp <= z + 9)); });

function tokenize(text) {
  const s = foldDigits(String(text || '')).toLowerCase().replace(/(\d),(?=\d)/g, '$1');
  const out = [];
  for (const m of s.matchAll(/\d+(?:\.\d+)?|[\p{L}\p{M}]+|[₹,?।|]/gu)) out.push({ t: m[0], s: m.index, e: m.index + m[0].length });
  return out;
}

// Read one numeric run starting at token i. Returns null if token i does not start a number.
function readRun(toks, i, lang) {
  let j = i, total = 0, cur = 0, mod = null, any = false, lastScale = false, prevDigit = false, conf = 0.98, currency = false;
  if (CURRENCY.has(toks[j] && toks[j].t)) { currency = true; j++; }
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
    return true;
  };
  const addScale = (s) => {
    const base = cur || (mod !== null ? 1 + mod : 1);
    if (mod !== null) conf = Math.min(conf, 0.85);
    mod = null;
    if (s === 100) cur = base * 100; else { total += base * s; cur = 0; }
    any = true; lastScale = true; prevDigit = false;
  };
  for (; j < toks.length; j++) {
    const w = toks[j].t;
    const n = numberOf(w, lang);
    if (n) { if (!addNum(n)) break; continue; }
    if (SCALES[w]) { addScale(SCALES[w]); continue; }
    const h = splitHundreds(w, lang);
    if (h) { if (!addNum(h)) break; addScale(100); continue; }
    if (IDIOM_MOD[w] !== undefined && (!any || lastScale)) { mod = IDIOM_MOD[w]; continue; }
    if (w === 'and' && any && toks[j + 1] && numberOf(toks[j + 1].t, lang)) continue;
    break;
  }
  if (!any) return null;
  let unit = null;
  if (toks[j] && CURRENCY.has(toks[j].t)) { currency = true; j++; } else if (toks[j] && UNITS[toks[j].t]) { unit = UNITS[toks[j].t]; j++; }
  // "do" is also the Hindi imperative "give": a bare, unanchored "do" is not trusted as an amount.
  if (j - i === 1 && toks[i].t === 'do') conf = 0.3;
  const value = total + cur;
  return { value, paise: Math.round(value * 100), confidence: conf, kind: unit ? 'quantity' : 'money', unit,
    currency, span: [toks[i].s, toks[j - 1].e], start: i, end: j };
}

function scanTokens(toks, lang = 'hi') {
  const runs = [];
  for (let i = 0; i < toks.length;) {
    const r = readRun(toks, i, lang);
    if (r) { runs.push(r); i = r.end; } else i++;
  }
  return runs;
}

const findAmounts = (text, lang = 'hi') => scanTokens(tokenize(text), lang);

// First trusted money amount; else the first run of any kind (e.g. a quantity).
function normaliseAmount(text, lang = 'hi') {
  const runs = findAmounts(text, lang);
  const r = runs.find((x) => x.kind === 'money' && x.confidence >= 0.5) || runs[0];
  if (!r) return { value: null, paise: null, confidence: 0, kind: null, unit: null, span: null };
  const { value, paise, confidence, kind, unit, span } = r;
  return { value, paise, confidence, kind, unit, span };
}

const isNumeralWord = (w) => !!(SCALES[w] || IDIOM_MOD[w] !== undefined || IDIOM_NUM[w] !== undefined || CURRENCY.has(w) ||
  UNITS[w] || numberOf(w, 'hi') || w === 'and');

// Spoken words for an amount in paise. Indian grouping (lakh/crore) in every language.
const SPEAK = {
  hi: { scales: ['crore', 'lakh', 'hazaar', 'sau'], cur: 'rupaye', paise: 'paise', and: 'aur' },
  mr: { scales: ['koti', 'lakh', 'hajar', 'shambhar'], cur: 'rupaye', paise: 'paise', and: 'aani' },
  bn: { scales: ['koti', 'lakh', 'hajar', 'sho'], cur: 'taka', paise: 'poysha', and: 'ar' },
  en: { scales: ['crore', 'lakh', 'thousand', 'hundred'], cur: 'rupees', paise: 'paise', and: 'and' },
};
function toWords(paise, lang = 'hi') {
  const L = TABLES[lang] ? lang : 'hi', sp = SPEAK[L], table = TABLES[L];
  const say = (n) => {
    if (n < 100) return table[n];
    const parts = [];
    [1e7, 1e5, 1e3, 100].forEach((s, k) => {
      const q = Math.floor(n / s);
      if (q) { parts.push(`${say(q)} ${sp.scales[k]}`); n %= s; }
    });
    if (n) parts.push(table[n]);
    return parts.join(' ');
  };
  const p = Math.abs(Math.round(paise)), r = Math.floor(p / 100), ps = p % 100;
  if (!ps) return `${say(r)} ${sp.cur}`;
  if (!r) return `${say(ps)} ${sp.paise}`;
  return `${say(r)} ${sp.cur} ${sp.and} ${say(ps)} ${sp.paise}`;
}

module.exports = { normaliseAmount, findAmounts, scanTokens, tokenize, foldDigits, toWords, isNumeralWord, TABLES, SCALES };
