// post-linkedin-queue.mjs
// The "I never have to remember" engine. Run on a schedule by
// .github/workflows/linkedin-scheduled.yml. Reads a queue of PRE-APPROVED posts
// and publishes any whose date is due, then commits the updated queue back.
// Spec: DVS-LPS-2026-001 v2.0 §5 (the optional `schedule:` half).
//
// Queue file: scheduled/linkedin-queue.json — an array of entries:
//   {
//     "id": "go-looking-for-the-no",   // unique, human-readable
//     "date": "2026-06-21",            // date on/after which it may post (AEST, YYYY-MM-DD)
//     "visibility": "PUBLIC",          // PUBLIC | CONNECTIONS
//     "status": "ready",               // ready | held | posted | failed
//     "text": "...",                   // the full, pre-approved post body
//     "firstComment": "..."            // OPTIONAL (S168): pre-approved first-comment text
//                                      //   (e.g. the blog/Touchstone link). Posted as a
//                                      //   comment on the share after it goes live. Omit
//                                      //   for pure text-only cuts (the best-reaching format).
//   }
// Only entries with status "ready" AND date <= today (AEST) are posted. After a
// successful post the entry becomes { status:"posted", urn, postedAt } (+ commentUrn
// if a first comment was posted). A SHARE failure becomes { status:"failed", lastError }
// and is NEVER auto-retried (no double-post risk) — Rick re-arms it by setting status
// back to "ready". "held" is never posted.
//
// FIRST-COMMENT semantics (S168): the SHARE is authoritative. If the share posts but
// its first comment fails, the entry stays "posted" (never re-armed → no double-post),
// records commentError, and the run still FAILS LOUDLY so Rick is emailed to add that
// one comment by hand. The share is never re-sent.
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

// ── Credential-failure auto-recovery (DVS-SHC-2026-001 Layer 2, added S224) ──
// The standing rule is that a SHARE failure is NEVER auto-retried — correct,
// because a double post is unrecoverable. But that blanket rule treats a content
// failure and a CREDENTIAL failure as the same animal, and they are not.
// On 20 Aug 2026 a post failed HTTP 401 EXPIRED_ACCESS_TOKEN, was never retried,
// and sat dead for five days while the queue ran dry.
//
// So the rule is NARROWED, not removed: re-arm ONLY when the failure was a 401 /
// expired token AND this run has just minted a fresh credential (Layer 1 sets
// LINKEDIN_TOKEN_FRESHLY_MINTED=1). The old token could not have posted it, so
// there is no double-post risk. EVERY other failure stays manual, forever.
const freshlyMinted = process.env.LINKEDIN_TOKEN_FRESHLY_MINTED === '1';
const CREDENTIAL_FAILURE = /\b401\b|EXPIRED_ACCESS_TOKEN|REVOKED_ACCESS_TOKEN/i;
let reArmed = 0;
if (freshlyMinted) {
  for (const e of entries) {
    if (e?.status === 'failed' && CREDENTIAL_FAILURE.test(String(e.lastError || ''))) {
      console.log(`Re-arming ${e.id} — previous failure was a credential error and a fresh token was minted this run.`);
      e.status = 'ready';
      delete e.lastError;
      reArmed++;
    }
  }
  if (reArmed) {
    fs.writeFileSync(QUEUE, JSON.stringify(entries, null, 2) + '\n');
    console.log(`${reArmed} entr${reArmed === 1 ? 'y' : 'ies'} re-armed after token refresh.`);
  }
}

const due = entries.filter(e => e && e.status === 'ready' && typeof e.date === 'string' && e.date <= today);

// ── Foolproof runway alarm (added S178) ──────────────────────────────────────
// The one failure mode the poster couldn't see was an EMPTY queue: with nothing
// "ready", it exited 0 (clean no-op) and a silent gap only showed up on LinkedIn
// after the fact. This guard FAILS LOUDLY (non-zero exit → GitHub emails Rick) when
// the queue is empty or running low, so you're warned to top up BEFORE a gap happens.
const LOW_RUNWAY = Number(process.env.LINKEDIN_LOW_RUNWAY || 3);
function runwayGuard(readyCount, context) {
  if (readyCount === 0) {
    console.error(`❌ LinkedIn queue is EMPTY — 0 posts queued (${context}). No post can go ` +
      `out until you add entries to scheduled/linkedin-queue.json ("status":"ready" + a "date"). ` +
      `Failing loudly so you're emailed now, not surprised on LinkedIn later.`);
    process.exit(1);
  }
  if (readyCount <= LOW_RUNWAY) {
    console.error(`⚠️ LinkedIn queue RUNNING LOW — only ${readyCount} "ready" post(s) left ` +
      `(${context}; threshold ${LOW_RUNWAY}). Top up scheduled/linkedin-queue.json soon so the ` +
      `daily slot never runs dry. (Any post due today still went out — this is a heads-up.)`);
    process.exit(1);
  }
}

if (due.length === 0) {
  const ready = entries.filter(e => e?.status === 'ready').length;
  console.log(`Nothing due today (${today} AEST). ${ready} future "ready" item(s) waiting.`);
  runwayGuard(ready, 'nothing due today');
  process.exit(0);
}

const summary = [];
let failures = 0;          // SHARE failures (entry marked "failed", re-arm to retry)
let commentFailures = 0;   // comment-only failures (share is up; add comment by hand)

for (const e of due) {
  try {
    const { urn, commentUrn, commentError } = await postToLinkedIn({
      text: e.text,
      visibility: (e.visibility || 'PUBLIC').toUpperCase(),
      firstComment: e.firstComment || '',
    });
    e.status = 'posted';
    e.urn = urn;
    e.postedAt = new Date().toISOString();
    delete e.lastError;
    const url = `https://www.linkedin.com/feed/update/${urn}/`;
    if (commentUrn) { e.commentUrn = commentUrn; delete e.commentError; }
    if (commentError) {
      // Share is live; only the comment failed. Do NOT re-arm — record + count it.
      e.commentError = commentError;
      commentFailures++;
      console.error(`⚠️ POSTED [${e.id}] → ${urn} — but first comment FAILED: ${commentError}`);
      summary.push(`- ⚠️ \`${e.id}\` → ${url} (share LIVE; first comment FAILED — add manually: ${commentError})`);
    } else {
      console.log(`POSTED [${e.id}] → ${urn}${commentUrn ? ' (+ first comment)' : ''}`);
      summary.push(`- ✅ \`${e.id}\` → ${url}${commentUrn ? ' (+ 💬 first comment)' : ''}`);
    }
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
    `### LinkedIn scheduled run (${today} AEST)\n\n${summary.join('\n')}\n`);
}

// Fail loudly if anything didn't fully land — GitHub emails Rick. A post must never
// fail silently (the entire reason for this build). Share failures AND comment
// failures both make the run red; the message distinguishes them so Rick knows
// whether to re-arm (share) or just add a comment by hand (comment).
if (failures > 0 || commentFailures > 0) {
  if (failures > 0) {
    console.error(`${failures} SHARE(s) FAILED — re-arm by setting status back to "ready" after fixing.`);
  }
  if (commentFailures > 0) {
    console.error(`${commentFailures} first comment(s) FAILED — the shares are LIVE (do NOT re-post); add those comments manually.`);
  }
  process.exit(1);
}
const readyRemaining = entries.filter(e => e?.status === 'ready').length;
console.log(`Done — ${due.length} post(s) published. ${readyRemaining} "ready" item(s) left.`);
runwayGuard(readyRemaining, `after publishing ${due.length}`);
