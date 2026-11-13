'use strict';
// Deterministic guardrails. Code, not prompt instructions. Each returns {ok, reason, safeReply}.
const { render } = require('./langpacks');

const aiDisclosure = (lang = 'hi') => ({ ok: true, reason: null, safeReply: render(lang, 'disclosure') });

// Threat, shaming, pressure or lending language that must never reach a customer.
const THREAT = [
  /\bpolice\b/, /\bpolis\b/, /\bpulish\b/, /\bthana\b/, /\bcourt\b/, /\bcase\b/, /\bjail\b/, /\bwarna\b/, /\bnahi\s+to\b/,
  /\bnahitar\b/, /\bnoile\b/, /\bdekh\s+l(ena|unga|enge)\b/, /\bbura\s+hoga\b/, /\bdhamki\b/, /\bbadnaam\b/, /\bizzat\b/,
  /\bsharam\b/, /\bghar\s+aa/, /\bwarning\b/, /\blegal\b/, /\bconsequences?\b/, /\bpenalty\b/, /\bfine\b/, /\bjurmana\b/,
  /\bbyaa?j\b/, /\bvyaj\b/, /\bsud\b/, /\binterest\b/, /\bturant\b/, /\babhi\s+ke\s+abhi\b/, /\bimmediately\b/,
  /\bor\s+else\b/, /\bthreat/, /\bshame/,
];

function lintReminder(text, lang = 'hi', vars = {}) {
  const s = String(text || '').toLowerCase();
  const hits = THREAT.filter((r) => r.test(s)).map((r) => r.source);
  if (!hits.length) return { ok: true, reason: null, safeReply: text };
  return { ok: false, reason: `pressure_language:${hits.join(',')}`, safeReply: render(lang, 'reminder', vars) };
}

function requireOptIn(customer, lang = 'hi') {
  const ok = !!customer && (customer.reminder_opt_in === true || Number(customer.reminder_opt_in) === 1);
  return ok ? { ok, reason: null, safeReply: null }
    : { ok, reason: 'no_opt_in', safeReply: render(lang, 'reminder_no_optin', { name: (customer && customer.name) || '' }) };
}

const refuseLending = (lang = 'hi') => ({ ok: false, reason: 'lending', safeReply: render(lang, 'refused_lending') });
const refuseDiagnosis = (lang = 'hi') => ({ ok: false, reason: 'diagnosis', safeReply: render(lang, 'refused_diagnosis') });

module.exports = { aiDisclosure, lintReminder, requireOptIn, refuseLending, refuseDiagnosis };
