# LinkedIn auto-poster — how it works

Direct LinkedIn posting via the DVS-owned OAuth app (no Zapier, no terminal, no
"remember to post"). Spec: `Documents/DVS_Publishing_Architecture_Reconciliation_S156.md` (DVS-LPS-2026-001 v2.0 §5).

**Authorship stays human.** These tools only ship text that was written and
approved ahead of time. Nothing is generated. The automation handles the
*remembering* and the *pushing* — not the writing.

---

## Weekly content cadence (Rick, confirmed S178)

This queue holds **cuts only**, and cuts go out on **Sun / Wed / Thu**. The other
days are different content on different mechanisms — do **not** put them in this queue:

| Day | Post | Mechanism |
|-----|------|-----------|
| **Sun** | cut | **this queue** (auto 08:30 AEST) |
| **Mon** | new DVS blog post + LinkedIn teaser | `publish-scheduled` workflow (auto) |
| **Tue** | LinkedIn Article (long-form) | **manual** (or ad-hoc) |
| **Wed** | cut #1 | **this queue** |
| **Thu** | cut #2 | **this queue** |
| **Fri** | new DVS blog post + LinkedIn teaser | `publish-scheduled` workflow (auto) |
| **Sat** | LinkedIn Article (long-form) | **manual** |

So when seeding the queue: date cuts only on **Sundays, Wednesdays, Thursdays**.
Wed + Thu are typically a **pair** (cut #1 / cut #2 of one theme); Sun is a standalone
cut. Keep **at least ~2 weeks (6+) of cuts** queued so the runway alarm stays quiet.

---

## Two ways to post

### 1. Scheduled (the "I never have to remember" path)
Add a pre-approved post to `linkedin-queue.json` with a `date` and `status: "ready"`.
The **`Post to LinkedIn (scheduled queue)`** workflow runs **daily at 08:30 AEST**
(22:30 UTC) and publishes any `ready` entry whose `date` is on/before today, then
commits the updated queue. Most days nothing is due → no-op.

Entry shape:
```json
{
  "id": "go-looking-for-the-no",   // unique, human-readable
  "date": "2026-06-21",            // UTC date on/after which it may post
  "visibility": "PUBLIC",          // PUBLIC | CONNECTIONS
  "status": "ready",               // ready → will post; held → never; posted/failed set by the run
  "text": "Full pre-approved post body. Use real line breaks for paragraphs."
}
```
After a run, a posted entry becomes `{"status":"posted","urn":"...","postedAt":"..."}`.
A failure becomes `{"status":"failed","lastError":"..."}` and is **never auto-retried**
(no double-post risk) — fix it, then set `status` back to `"ready"` to re-arm.

### 2. Ad-hoc (post something right now)
Run `scripts/post-adhoc.sh "your post text"` (or point it at a text file). It
base64-encodes the text and dispatches the **`Post to LinkedIn (ad-hoc)`**
workflow, which posts immediately and prints the run URL. Or use the GitHub UI:
Actions → "Post to LinkedIn (ad-hoc)" → Run workflow.

---

## It can't fail silently
Every post must return **HTTP 201 + a share URN**. If it doesn't, the workflow
**fails** and GitHub emails you — that's the whole point of this build (the old
Zapier auto-posters failed silently for weeks).

**Empty/low-queue alarm (added S178):** the runway guard in `post-linkedin-queue.mjs`
now also **fails loudly** when the queue is **empty** or **running low (≤3 `ready`
cuts left)** — so you're emailed to top up *before* a silent gap ever happens. Tune
the threshold with the `LINKEDIN_LOW_RUNWAY` env var (default 3).

The daily `linkedin-post-analytics-daily` task is the independent +24h on-destination
check (P-066).

## One-time setup (Rick — credentials)
Repo secrets, set under Settings → Secrets and variables → Actions:
- `LINKEDIN_TOKEN` — member access token, scope `w_member_social` (DVS app `86rizvwac5rqb8`). ~60-day life; re-mint when it expires (a 401 in the run = expired).
- `LINKEDIN_AUTHOR_URN` — `urn:li:person:<your-id>`.

See the setup steps the agent provided alongside this build.
