// post-linkedin.mjs
// Direct LinkedIn poster (replaces the flaky Zapier webhook path, fire-linkedin.mjs).
// Posts a single pre-written text update to Rick's personal feed via the LinkedIn
// UGC API, using the DVS-owned OAuth app token (client 86rizvwac5rqb8, scope
// w_member_social). Spec: DVS-LPS-2026-001 v2.0 §5.
//
// S168 (1 Jul 2026): added OPTIONAL first-comment support. Many DVS cuts put the
// link in the FIRST COMMENT, not the body (keeps the post link-free for reach;
// the comment carries the blog/Touchstone CTA). If `firstComment` is supplied the
// share is posted first, then a comment is added to it. The comment is best-effort:
// the SHARE is authoritative (never un-posted / never re-armed on a comment
// failure — no double-post), but a comment failure is reported LOUDLY so Rick can
// add the one comment by hand.
//
// CREDENTIAL SPLIT (DVS rule): this code never contains a token. It reads two
// secrets from the environment, which Rick sets as repo secrets:
// LINKEDIN_TOKEN — member access token (w_member_social), ~60-day life
// LINKEDIN_AUTHOR_URN — urn:li:person:<id> (the post author)
//
// AUTHORSHIP STAYS HUMAN: this script only SHIPS text it is handed. It never
// generates content (MIF-067 — automate distribution, never authorship).
//
// SELF-VERIFY (P-066): a post is only "done" when LinkedIn returns 201 AND a
// share URN. On any share failure the process exits non-zero so the GitHub Action
// fails LOUDLY (GitHub emails Rick) — the whole point is that a post can never
// fail silently again. The daily linkedin-post-analytics-daily task remains the
// independent +24h on-destination cross-check.

const API = 'https://api.linkedin.com/v2/ugcPosts';
const COMMENTS_API = (shareUrn) =>
  `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(shareUrn)}/comments`;

/**
 * Post one text update, optionally with a first comment.
 * Returns { urn, commentUrn, commentError }. Throws only on SHARE failure.
 * @param {object} o
 * @param {string} o.text the (pre-approved) post body
 * @param {string} [o.visibility] 'PUBLIC' (default) | 'CONNECTIONS'
 * @param {string} [o.firstComment] optional pre-approved first-comment text (e.g. the link/CTA)
 */
export async function postToLinkedIn({ text, visibility = 'PUBLIC', firstComment = '' }) {
  const token = process.env.LINKEDIN_TOKEN;
  const author = process.env.LINKEDIN_AUTHOR_URN;

  if (!token) throw new Error('LINKEDIN_TOKEN is not set (repo secret missing).');
  if (!author || !author.startsWith('urn:li:person:')) {
    throw new Error('LINKEDIN_AUTHOR_URN missing or not a urn:li:person:<id>.');
  }
  if (!text || !text.trim()) throw new Error('Refusing to post empty text.');
  if (text.length > 3000) throw new Error(`Text is ${text.length} chars; LinkedIn limit is 3000.`);

  const body = {
    author,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': visibility },
  };

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  if (res.status !== 201) {
    // 401 = token expired/invalid (re-mint); 403 = scope/permission; 422 = bad body.
    throw new Error(`LinkedIn POST failed: HTTP ${res.status} — ${raw.slice(0, 500)}`);
  }

  // URN is returned in the x-restli-id header and/or the body { id }.
  let urn = res.headers.get('x-restli-id') || res.headers.get('x-linkedin-id');
  if (!urn) {
    try { urn = JSON.parse(raw).id; } catch { /* fall through */ }
  }
  if (!urn) throw new Error(`Posted (201) but no share URN returned — treat as unverified. Body: ${raw.slice(0, 300)}`);

  // Best-effort read-back. May 403 if the token lacks r_member_social — that is
  // NOT a failure (the 201 + URN is the authoritative self-verify); we only log.
  try {
    const check = await fetch(`${API}/${encodeURIComponent(urn)}`, {
      headers: { Authorization: `Bearer ${token}`, 'X-Restli-Protocol-Version': '2.0.0' },
    });
    console.log(`read-back: HTTP ${check.status}${check.ok ? ' (confirmed)' : ' (skip — likely no read scope; 201+URN stands)'}`);
  } catch (e) {
    console.log(`read-back skipped: ${e.message}`);
  }

  // Optional first comment (best-effort; the share above is authoritative).
  let commentUrn = null;
  let commentError = null;
  if (firstComment && firstComment.trim()) {
    if (firstComment.length > 3000) {
      commentError = `first comment is ${firstComment.length} chars; limit 3000 — skipped`;
      console.error(`⚠️ ${commentError}`);
    } else {
      try {
        commentUrn = await postComment({ shareUrn: urn, text: firstComment, author, token });
        console.log(`first comment posted: ${commentUrn}`);
      } catch (e) {
        commentError = e.message;
        // Loud, but NON-fatal here: the share is up. The caller reports it and
        // fails the run loudly so Rick adds the comment manually — the share is
        // never re-armed, so there is no double-post risk.
        console.error(`⚠️ share posted (${urn}) but first comment FAILED: ${e.message}`);
      }
    }
  }

  return { urn, commentUrn, commentError };
}

/**
 * Add a comment to an existing share/ugcPost. Throws on non-201.
 * LinkedIn socialActions comment API (w_member_social). Uses the same URN the
 * share POST returned for both the path and the `object` field.
 */
async function postComment({ shareUrn, text, author, token }) {
  const body = { actor: author, object: shareUrn, message: { text } };
  const res = await fetch(COMMENTS_API(shareUrn), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (res.status !== 201) {
    throw new Error(`comment POST failed: HTTP ${res.status} — ${raw.slice(0, 300)}`);
  }
  let commentUrn = res.headers.get('x-restli-id');
  if (!commentUrn) { try { const j = JSON.parse(raw); commentUrn = j.$URN || j.id; } catch { /* ignore */ } }
  return commentUrn || '(created; urn not returned)';
}

// ── CLI mode: post a single update from TEXT_B64 (base64 dodges shell quoting) ──
// Used by the ad-hoc workflow_dispatch (.github/workflows/linkedin-post.yml).
// Optional FIRST_COMMENT_B64 adds a first comment (if the ad-hoc workflow passes it).
const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const b64 = process.env.TEXT_B64;
  if (!b64) { console.error('TEXT_B64 env not set.'); process.exit(1); }
  const text = Buffer.from(b64, 'base64').toString('utf8');
  const cb64 = process.env.FIRST_COMMENT_B64;
  const firstComment = cb64 ? Buffer.from(cb64, 'base64').toString('utf8') : '';
  const visibility = (process.env.VISIBILITY || 'PUBLIC').toUpperCase();

  try {
    const { urn, commentUrn, commentError } = await postToLinkedIn({ text, visibility, firstComment });
    const url = `https://www.linkedin.com/feed/update/${urn}/`;
    console.log(`POSTED ${urn}`);
    console.log(url);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      let md = `### ✅ LinkedIn post published\n\n- URN: \`${urn}\`\n- ${url}\n`;
      if (commentUrn) md += `- 💬 first comment: \`${commentUrn}\`\n`;
      if (commentError) md += `- ⚠️ first comment FAILED (share is live; add it manually): ${commentError}\n`;
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
    }
    // Share is up. If the comment failed, exit non-zero so the run is red and Rick
    // is emailed to add the one comment by hand (the share is not re-posted).
    if (commentError) process.exit(1);
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ❌ LinkedIn post FAILED\n\n\`${e.message}\`\n`);
    }
    process.exit(1);
  }
}
