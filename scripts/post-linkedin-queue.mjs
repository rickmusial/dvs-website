// post-linkedin-queue.mjs
// The "I never have to remember" engine. Run on a schedule by
// .github/workflows/linkedin-scheduled.yml. Reads a queue of PRE-APPROVED posts
// and publishes any whose date is due, then commits the updated queue back.
// Spec: DVS-LPS-2026-001 v2.0 §5 (the optional `schedule:` half).
//
// Queue file: scheduled/linkedin-queue.json — an array of entries:
//   {
//     "id": "go-looking-for-the-no",     // unique, human-readable
//     "date": "2026-06-21",              // UTC date on/after which it may post (YYYY-MM-DD)
//     "visibility": "PUBLIC",            // PUBLIC | CONNECTIONS
//     "status": "ready",                 // ready | held | posted | failed
//     "text": "..."                      // the full, pre-approved post body
//   }
// Only entries with status "ready" AND date <= today (UTC) are posted. After a
// successful post the entry becomes { status:"posted", urn, postedAt }. A failure
// becomes { status:"failed", lastError } and is NEVER auto-retried (no double-post
// risk) — Rick re-arms it by setting status back to "ready". "held" is never posted.
//
// AUTHORSHIP STAYS HUMAN: entries are written/approved ahead of time by Rick (or
// the agent in-session, Reader-Tested). This engine only ships what's queued.

import fs from 'node:fs';
import path from 'node:path';
import { postToLinkedIn } from './post-linkedin.mjs';

const QUEUE = path.resolve('scheduled/linkedin-queue.json');

if (!fs.existsSync(QUEUE)) {
  console.log(`No queue file at ${QUEUE} — nothing to do.`);
  process.exit(0);
}

let entries;
try {
  entries = JSON.parse(fs.readFileSync(QUEUE, 'utf8'));
  if (!Array.isArray(entries)) throw new Error('queue is not a JSON array');
} catch (e) {
  console.error(`Queue file is invalid JSON: ${e.message}`);
  process.exit(1);
}

// "Today" in Australia/Sydney (AEST/AEDT, DST-safe), NOT UTC — the cron fires at
// 08:30 AEST when the UTC date is still the day before. en-CA → YYYY-MM-DD.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
const due = entries.filter(e => e && e.status === 'ready' && typeof e.date === 'string' && e.date <= today);

if (due.length === 0) {
  console.log(`Nothing due today (${today} UTC). ${entries.filter(e => e?.status === 'ready').length} future "ready" item(s) waiting.`);
  process.exit(0);
}

const summary = [];
let failures = 0;

for (const e of due) {
  try {
    const { urn } = await postToLinkedIn({ text: e.text, visibility: (e.visibility || 'PUBLIC').toUpperCase() });
    e.status = 'posted';
    e.urn = urn;
    e.postedAt = new Date().toISOString();
    delete e.lastError;
    const url = `https://www.linkedin.com/feed/update/${urn}/`;
    console.log(`POSTED [${e.id}] → ${urn}`);
    summary.push(`- ✅ \`${e.id}\` → ${url}`);
  } catch (err) {
    failures++;
    e.status = 'failed';
    e.lastError = err.message;
    console.error(`FAILED [${e.id}]: ${err.message}`);
    summary.push(`- ❌ \`${e.id}\` — ${err.message}`);
  }
}

// Persist queue state (the workflow commits this; contents: write).
fs.writeFileSync(QUEUE, JSON.stringify(entries, null, 2) + '\n');

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### LinkedIn scheduled run (${today} UTC)\n\n${summary.join('\n')}\n`);
}

// Fail loudly if anything didn't land — GitHub emails Rick. A post must never
// fail silently (the entire reason for this build).
if (failures > 0) {
  console.error(`${failures} post(s) FAILED — see above. Re-arm by setting status back to "ready" after fixing.`);
  process.exit(1);
}
console.log(`Done — ${due.length} post(s) published.`);
