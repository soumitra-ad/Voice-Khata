'use strict';
// Script-agnostic front end: Devanagari / Bengali -> Latin, plus loose canonical keys for matching.
// Internal only. Callers must keep and display the ORIGINAL text; never overwrite it with this output.

const DEVA = {
  cons: { 'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny', 'ट': 't', 'ठ': 'th',
    'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n', 'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h' },
  // Nukta forms (NFC keeps क़ etc. decomposed as base + U+093C).
  nukta: { 'क': 'q', 'ख': 'kh', 'ग': 'g', 'ज': 'z', 'ड': 'r', 'ढ': 'rh', 'फ': 'f', 'य': 'y', 'र': 'r', 'ऩ': 'n' },
  vowels: { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ॲ': 'a' },
  matras: { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' },
  virama: '्', nuktaSign: '़', anusvara: ['ं', 'n'], chandrabindu: ['ँ', 'n'], visarga: 'ः',
  inherent: 'a', medialSchwa: true, shortenFinal: true,
};
const BENG = {
  cons: { 'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng', 'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n', 'ট': 't', 'ঠ': 'th',
    'ড': 'd', 'ঢ': 'dh', 'ণ': 'n', 'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n', 'প': 'p', 'ফ': 'ph', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
    'য': 'j', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h', 'ৰ': 'r', 'ৱ': 'w' },
  // ড় ঢ় য় decompose under NFC to base + U+09BC.
  nukta: { 'ড': 'r', 'ঢ': 'rh', 'য': 'y' },
  vowels: { 'অ': 'o', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u', 'ঊ': 'u', 'ঋ': 'ri', 'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou' },
  matras: { 'া': 'a', 'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ৃ': 'ri', 'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou' },
  virama: '্', nuktaSign: '়', anusvara: ['ং', 'ng'], chandrabindu: ['ঁ', 'n'], visarga: 'ঃ',
  khandaTa: 'ৎ', inherent: 'o', medialSchwa: false, shortenFinal: false,
};
const SHORTEN = { aa: 'a', ee: 'i', oo: 'u' };

function translitWord(word, S) {
  const segs = [];
  const chars = [...word.normalize('NFC')];
  const last = () => segs[segs.length - 1];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (S.cons[c] !== undefined) {
      let cons = S.cons[c];
      if (chars[i + 1] === S.nuktaSign) { cons = S.nukta[c] || cons; i++; }
      segs.push({ cons, vowel: S.inherent, inherent: true, tail: '' });
    } else if (S.matras[c] !== undefined && segs.length) {
      Object.assign(last(), { vowel: S.matras[c], inherent: false });
    } else if (c === S.virama && segs.length) {
      Object.assign(last(), { vowel: '', inherent: false, virama: true });
    } else if (S.vowels[c] !== undefined) {
      segs.push({ cons: '', vowel: S.vowels[c], inherent: false, tail: '' });
    } else if ((c === S.anusvara[0] || c === S.chandrabindu[0]) && segs.length) {
      Object.assign(last(), { tail: last().tail + (c === S.anusvara[0] ? S.anusvara[1] : S.chandrabindu[1]), inherent: false });
    } else if (c === S.visarga && segs.length) {
      Object.assign(last(), { tail: last().tail + 'h', inherent: false });
    } else if (c === S.khandaTa) {
      segs.push({ cons: 't', vowel: '', inherent: false, tail: '' });
    } else if (c !== S.nuktaSign) {
      segs.push({ cons: c, vowel: '', inherent: false, tail: '' }); // anything else passes through
    }
  }
  const n = segs.length;
  // Word-final schwa deletion (उधार -> udhaar, রমেশ -> romesh); kept after a conjunct (मित्र -> mitra).
  if (n > 1 && segs[n - 1].inherent && !segs[n - 2].virama) Object.assign(segs[n - 1], { vowel: '', inherent: false });
  // Hindi medial schwa deletion, right to left: V C [a] C V -> drop (समझना -> samajhnaa, कमला -> kamlaa).
  if (S.medialSchwa) {
    for (let i = n - 2; i >= 1; i--) {
      const g = segs[i], p = segs[i - 1], q = segs[i + 1];
      if (g.inherent && p.vowel && q.cons && q.vowel) Object.assign(g, { vowel: '', inherent: false });
    }
  }
  // Common Hindi romanisation writes word-final long vowels short: दिया diya, था tha, की ki.
  if (S.shortenFinal && n && !segs[n - 1].tail) segs[n - 1].vowel = SHORTEN[segs[n - 1].vowel] || segs[n - 1].vowel;
  return segs.map((g) => g.cons + g.vowel + g.tail).join('');
}

const DEVA_RUN = /[ऀ-ॣ॰-ॿ]+/g;
const BENG_RUN = /[ঀ-৥ৰ-৿]+/g;

// scriptHint ('deva' | 'beng') forces a script; otherwise each run is detected by its code points.
function toLatin(text, scriptHint) {
  let s = String(text || '').normalize('NFC').replace(/[​-‍⁠﻿]/g, '').replace(/[।॥]/g, ' ');
  const pick = (dflt) => (scriptHint === 'deva' ? DEVA : scriptHint === 'beng' ? BENG : dflt);
  s = s.replace(DEVA_RUN, (w) => translitWord(w, pick(DEVA)));
  return s.replace(BENG_RUN, (w) => translitWord(w, pick(BENG)));
}

const isNative = (s) => /[ऀ-৿]/.test(s);

// Light key: long vowels folded only. Safe enough for short function words (kaa -> ka).
const lightKey = (tok) => String(tok).toLowerCase().replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a');

// Loose key for ASR / transliteration variance. Collides a lot by design: callers must reject ambiguous hits.
function canonicalKey(tok) {
  let s = String(tok || '').normalize('NFC').replace(/[​-‍⁠﻿]/g, '').replace(/[।॥.,!?'"`:;()\-]/g, '');
  if (isNative(s)) s = toLatin(s);
  return lightKey(s).replace(/o/g, 'a').replace(/sh/g, 's').replace(/w/g, 'v').replace(/z/g, 'j')
    .replace(/(.)\1+/g, '$1').replace(/(.)[aeiou]$/, '$1');
}

module.exports = { toLatin, canonicalKey, lightKey, isNative };
