// queue-runway-guard.mjs — the empty-queue check (S247).
//
// WHY THIS EXISTS. On 18 Sep 2026 the blog publish workflow ran exactly on time,
// read `"queue": []`, published nothing and exited 0. A success with nothing in it
// is the one state none of the studio's instruments watch for: publish-scheduled.mjs
// is fail-loud on a corrupt anchor and silent by design on an empty queue, the
// Mon/Fri monitor named in its own header watches only FAILED runs, the close gate
// cannot tell an unqueued post from a clean tree, and dvs_absence_sentinel.sh sees
// only registered plans. The post was ten hours late. Specified that evening,
// carried as S247 agenda item 2, built here.
//
// WHY IT IS A SEPARATE STEP AND NOT A BRANCH INSIDE publish-scheduled.mjs.
// publish-scheduled.yml runs that script inside a multi-line `run:` block and then
// writes PUBLISHED_OUT to $GITHUB_ENV on the next line. A non-zero exit from the
// script would abort the block, skip that write, and fail the step — breaking the
// publish path to report on it. So the guard runs as its OWN step, LAST, under
// `if: always()`. It reads the manifest AFTER publish-scheduled.mjs has rewritten
// it, so it counts what is genuinely left. It cannot block or alter a publish.
//
// EXIT CODES — deliberately the same vocabulary as post-linkedin-queue.mjs's
// runwayGuard (P-050: one shape across both queue-driven publishers):
//   0 = runway is fine.
//   2 = HOUSEKEEPING — the queue is empty or down to its last slot. Nothing broke.
// GitHub prints "Process completed with exit code N" in the annotation and the
// failure email, which is the whole point: exit 2 makes the run visible TONIGHT
// rather than at the next open. A ::warning alone would not send an email.
//
// KNOWN LIMIT, stated rather than assumed away: this proves the QUEUE has entries.
// It does not prove those entries are any good, that their HTML exists, or that
// anyone approved them. It answers "is there anything to publish", nothing more.

import fs from 'node:fs';

const MANIFEST = process.env.MANIFEST || 'scheduled/manifest.json';
const LOW_RUNWAY = Number(process.env.BLOG_LOW_RUNWAY ?? 1);

function stepSummary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

let queue;
try {
  queue = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).queue;
} catch (e) {
  console.error(`⛔ Could not read ${MANIFEST}: ${e.message}`);
  console.log(`::warning title=Blog queue guard could not run::${MANIFEST} unreadable — ${e.message}`);
  process.exit(2);          // could-not-run is NOT a pass (P-101)
}
if (!Array.isArray(queue)) {
  console.error(`⛔ ${MANIFEST} has no "queue" array.`);
  process.exit(2);
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
const remaining = queue.length;
const next = queue.map(e => e.publishDate).filter(Boolean).sort()[0] ?? null;

if (remaining > LOW_RUNWAY) {
  console.log(`Blog queue runway OK — ${remaining} post(s) staged, next ${next}. (today ${today} AEST)`);
  process.exit(0);
}

const empty = remaining === 0;
const headline = empty
  ? '📭 HOUSEKEEPING — the blog queue is EMPTY'
  : `📭 HOUSEKEEPING — the blog queue is down to its last ${remaining} post (next ${next})`;

console.log(`::warning title=Blog queue needs topping up::${headline}`);
console.error(
  `${headline} (today ${today} AEST). Nothing failed and nothing is broken — the next ` +
  `Mon/Fri slot has nothing to publish. Add an entry to ${MANIFEST} with its HTML in ` +
  `scheduled/<slug>.html. Exiting 2 (housekeeping), not 1 (incident).`
);
stepSummary(
  `### ${headline}\n\n**No post failed. There is simply nothing queued for the next slot.**\n\n` +
  `Staged posts remaining: **${remaining}** (alarm threshold ${LOW_RUNWAY}).\n` +
  `Publish slots: **Monday and Friday, 08:15 AEST** (\`15 22 * * 0,4\`).\n\n` +
  `_Exit code 2 = housekeeping. Exit code 1 would mean a publish actually failed._\n` +
  `_Origin: 18 Sep 2026 — the workflow ran on time, read an empty queue, published nothing and exited 0._\n`
);
process.exit(2);
