# Voice Khata — Gnani Voice Hackathon, PS2

## What this is
A voice ledger a kirana shopkeeper speaks to across the counter.
"Ramesh ka 340 udhaar, kal 200 diya tha" -> TWO entries (340 credit today,
200 payment yesterday) -> spoken read-back with net balance -> commits on "haan".
Corrections by voice ("nahi, 430"). Queries ("Ramesh ka total?") answered in <2s.

## HARD RULES — never violate
- STT = Gnani Prisma v3.0. TTS = Gnani Timbre v3.0. Both WebSocket streaming. No telephony.
- Orchestration is OUR custom loop. Never use a hosted end-to-end agent platform.
- NEVER invent Gnani URLs, auth headers, or event names. Read from .env, mark
  "// TODO: VERIFY FROM GNANI DOCS". Ship MOCK_VOICE=1 so everything runs without the API.
- API key server-side only, in .env, gitignored. NEVER in public/ or any client file.
- No voice cloning. Stock TTS voices only.
- Agent discloses it is an AI in its FIRST turn, in the user's language.
- No lending / interest / EMI. Reminders opt-in only, no pressure or threat language.
- Ledger + transcripts encrypted at rest or local-only; purgeable after judging.
- Synthetic customers only.

## Architecture contract
core/      = pure logic. NO network calls, NO API keys. Deterministic.
adapters/  = the ONLY place Gnani is called.
public/    = browser UI. Dumb: capture audio, play audio, display.
server.js  = WebSocket + session state machine. Joins everything.

## Coding conventions
- CommonJS (require/module.exports). NO "type":"module" in package.json.
- ALL money as INTEGER PAISE. Never floats. 340 rupees = 34000.
- credit = +receivable, payment = -receivable. Balance = signed SUM WHERE undone=0.
- Corrections = soft-delete (undone=1) + re-insert. NEVER mutate amounts in place.
- Multi-entry utterances commit in ONE atomic transaction.
- Numerals, direction, dates, guardrails = deterministic code, NOT an LLM.
  LLM is fallback only, with a 500ms abort.

## Non-negotiable correctness details
- Indic numerals 1-100 are IRREGULAR (Hindi saintis=37, Marathi sadtis=37).
  Use full 0-100 LOOKUP TABLES. Rules cannot generate them.
- Fraction idioms: sava=1.25, dedh=1.5, dhai=2.5, paune=-0.25, adha=0.5.
- Fold Unicode digits (Devanagari/Bengali/etc) to ASCII.
- "dhai kilo" = quantity, NOT money.
- Direction by case marker: "Ramesh NE 200 diya"=payment, "Ramesh KO 200 diya"=credit.
  No direction verb -> ASK, never guess.
- "kal" is bidirectional in Hindi: resolve by TENSE ("diya tha"=yesterday,
  "de dunga"=tomorrow). Marathi kal=yesterday, udya=tomorrow.
- Union lexicon across languages for PARSING. Language detection only for REPLIES.

## Latency targets
End of speech -> first audio: p50 <900ms, p95 <1.6s.
Push-to-talk release IS the endpoint (zero silence wait).
350ms pre-roll ring buffer so the first word is never clipped.

## Definition of done
npm test passes. npm start serves a working push-to-talk UI in MOCK_VOICE=1.
README with setup + Mermaid architecture diagram + Gnani services + compliance section.
