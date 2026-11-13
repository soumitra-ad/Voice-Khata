'use strict';
// Shared .env access for the Gnani adapters. Every URL, header and event name is read from .env.
// TODO: VERIFY FROM GNANI DOCS — values documented in .env.example come from docs.gnani.ai (checked 2026-11-13);
// confirm them against the live API with `npm run probe`.

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const pathGet = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
// Fill a JSON template: values are JSON-escaped so any text (quotes, Devanagari) stays valid JSON.
const jsonFill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => JSON.stringify(String(vars[k] ?? '')).slice(1, -1));

// Our language ids (hi/mr/bn/en) -> Gnani codes, from GNANI_LANG_MAP ("hi:hi-IN,mr:mr-IN,...").
function langCode(lang) {
  const map = Object.fromEntries(env('GNANI_LANG_MAP').split(',').filter(Boolean).map((p) => p.split(':').map((x) => x.trim())));
  return map[lang] || lang;
}

function authHeaders() {
  const name = env('GNANI_AUTH_HEADER');
  return name ? { [name]: fill(env('GNANI_AUTH_VALUE', '{key}'), { key: env('GNANI_API_KEY') }) } : {};
}

// Extra connection headers from a JSON template in .env (e.g. GNANI_STT_HEADERS), with {lang} filled. Values become strings.
function jsonHeaders(name, vars) {
  const tpl = env(name);
  if (!tpl) return {};
  const obj = JSON.parse(jsonFill(tpl, vars));
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
}

module.exports = { env, pathGet, fill, jsonFill, langCode, authHeaders, jsonHeaders };
