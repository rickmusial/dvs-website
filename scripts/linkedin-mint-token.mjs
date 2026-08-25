/*
 * linkedin-mint-token.mjs — DVS-SHC-2026-001 Layer 1.
 *
 * Mints a SHORT-LIVED LinkedIn access token from the stored refresh token at the
 * start of every posting run, and hands it to the rest of the job through
 * GITHUB_ENV. The access token is never stored anywhere.
 *
 * WHY THIS SHAPE (S224). The obvious build was "refresh the token and write it
 * back into the repo secret." That needs a fine-grained PAT with secrets:write,
 * a libsodium sealed-box encryption step, and it hands a workflow the power to
 * rewrite its own production credentials. All of that disappears if the access
 * token is simply never persisted: mint it, use it, drop it. The only long-lived
 * secret is the refresh token (~12 months), and nothing in CI can write a secret.
 *
 * ORIGIN. LINKEDIN_TOKEN expired ~20 Aug 2026. The 20 Aug post failed
 * HTTP 401 EXPIRED_ACCESS_TOKEN, was never auto-retried (by design), the queue
 * ran dry, and the failure printed into a GitHub Actions log nobody opens for
 * five days. The README said "re-mint when it expires" and never said by whom.
 *
 * FAIL-SOFT BY DESIGN: if the refresh secrets are absent, this exits 0 and leaves
 * LINKEDIN_TOKEN exactly as it was, so the pipeline behaves as it does today.
 * It only ever adds a capability; it can never subtract one.
 *
 * Env in : LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REFRESH_TOKEN
 * Env out: LINKEDIN_TOKEN (via GITHUB_ENV, this job only)
 * Exit   : 0 always — a mint failure must not stop a run that may still have a
 *          valid hand-minted token in LINKEDIN_TOKEN. Layer 3 escalates instead.
 */

import fs from 'node:fs';

const say = (m) => console.log(`[mint] ${m}`);
const summary = (m) => {
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, m + '\n');
  }
};

// ⚑ S224 FIX — SINGLE WRITER. Every exit path below calls exportToken(): with the
// freshly minted token, or with the existing secret passed straight through. The
// poster step therefore declares NO LINKEDIN_TOKEN env of its own.
//
// WHY. The first wiring had the poster step declare `LINKEDIN_TOKEN: ${{ secrets.
// LINKEDIN_TOKEN }}` while this script wrote the minted token to GITHUB_ENV. Whether
// a step-level `env:` outranks a value written to GITHUB_ENV by an earlier step is
// NOT settled by GitHub's docs — and if it does, the minted token was silently
// discarded and this whole layer was a no-op that would only have surfaced sixty
// days later. Rather than resolve the precedence question, the wiring is now correct
// under either answer: exactly one writer, and no competing declaration.
const PASSTHROUGH = process.env.LINKEDIN_TOKEN || '';
function exportToken(value, why) {
  if (!process.env.GITHUB_ENV) return;
  if (!value) { say(`no token to export (${why}) — the poster will fail loudly.`); return; }
  fs.appendFileSync(process.env.GITHUB_ENV, `LINKEDIN_TOKEN=${value}\n`);
  say(`LINKEDIN_TOKEN exported for this job (${why}).`);
}

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REFRESH = process.env.LINKEDIN_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH) {
  say('refresh secrets not configured — skipping. The run will use LINKEDIN_TOKEN as-is.');
  say('To enable self-healing see Documents/DVS_Self_Healing_Credentials_Spec.md (DVS-SHC-2026-001).');
  exportToken(PASSTHROUGH, 'passthrough — refresh not configured');
  process.exit(0);
}

const body = new URLSearchParams({
  grant_type: 'refresh_token',
  refresh_token: REFRESH,
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET,
});

let res, json;
try {
  res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  json = await res.json().catch(() => ({}));
} catch (e) {
  say(`network error contacting LinkedIn: ${e.message}`);
  summary(`- ⚠️ LinkedIn token mint FAILED (network): ${e.message}`);
  fs.writeFileSync('.linkedin-mint-failed', `network: ${e.message}\n`);
  exportToken(PASSTHROUGH, 'passthrough — mint unreachable');
  process.exit(0);
}

if (!res.ok || !json.access_token) {
  const detail = JSON.stringify(json).slice(0, 400);
  say(`mint FAILED — HTTP ${res.status} ${detail}`);
  // The one case a human must act on: the refresh token itself is dead.
  summary(`- ⛔ **LinkedIn token mint FAILED — HTTP ${res.status}.** The refresh token may be revoked or expired. ${detail}`);
  fs.writeFileSync('.linkedin-mint-failed', `HTTP ${res.status} ${detail}\n`);
  exportToken(PASSTHROUGH, 'passthrough — mint rejected');
  process.exit(0);
}

// Hand the fresh token to the rest of the job. Never written to disk, never a secret.
exportToken(json.access_token, 'freshly minted');
// Mask it so it can never surface in a log.
console.log(`::add-mask::${json.access_token}`);

const days = json.expires_in ? Math.round(json.expires_in / 86400) : '?';
say(`minted OK — access token good for ~${days} days (used for this run only)`);
summary(`- ✅ LinkedIn access token minted from refresh token (~${days}d validity, not persisted)`);

// ⚠ Rotation guard: if LinkedIn ever returns a DIFFERENT refresh token, the stored
// secret is now stale and the NEXT run will fail. Say so loudly rather than
// discovering it in sixty days.
if (json.refresh_token && json.refresh_token !== REFRESH) {
  say('⛔ LinkedIn ROTATED the refresh token. The stored LINKEDIN_REFRESH_TOKEN secret is now STALE.');
  summary('- ⛔ **ACTION NEEDED: LinkedIn rotated the refresh token.** Update the `LINKEDIN_REFRESH_TOKEN` secret or the next run fails.');
  fs.writeFileSync('.linkedin-refresh-rotated', 'rotated\n');
}

// Signal to the poster that a fresh credential exists in THIS run — Layer 2 uses
// this to decide whether a 401-failed queue entry may be auto-re-armed.
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `LINKEDIN_TOKEN_FRESHLY_MINTED=1\n`);
}
