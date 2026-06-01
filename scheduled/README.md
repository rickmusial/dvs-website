# Scheduled blog publishing — how it works

Auto-publishes approved blog posts on their date and fires the LinkedIn teaser
**after** the site is live — no terminal needed. Built S139 (1 June 2026).

## The flow

1. **Write + approve** a post (Rick + agent). The agent produces the full
   publish-ready HTML (gold-standard schema, OG/canonical tags — same as every
   live post) and saves it to **`scheduled/<slug>.html`**.
2. **Stage it** by adding an entry to `manifest.json` (schema below) with a
   `publishDate`. The post now sits in the queue. This is the approval gate —
   nothing publishes that isn't already approved and staged.
3. On **Mon/Fri 08:15 AEST**, the `publish-scheduled` GitHub Action runs:
   - moves every post whose `publishDate` is due into `blog/`,
   - adds its `sitemap.xml` entry and its card on `blog/index.html` (newest = featured),
   - removes it from the queue, commits, and pushes → **Vercel auto-deploys.**
4. ~90s later (after the site is live), the Action POSTs the teaser to the
   Zapier webhook → **LinkedIn teaser goes out.** Website-first, guaranteed by order.

Result: keep a buffer of approved posts staged; the cadence runs itself. Your
only recurring input is the writing.

## manifest.json entry schema

```json
{
  "slug": "founder-market-fit-is-two-different-things",
  "publishDate": "2026-06-05",
  "category": "Founder Intelligence",
  "readTime": "5 min read",
  "title": "Founder-market fit is two different things",
  "description": "One-line summary for the blog index card.",
  "linkedinTeaser": "The teaser text for the publish-day LinkedIn post. The article link is attached automatically as a rich preview.",
  "featured": true
}
```
`featured` defaults to `true` (newest post becomes the index hero; the prior hero is demoted). The matching HTML must already exist at `scheduled/<slug>.html`.

## One-time setup (Rick)

1. **GITHUB_TOKEN — nothing to do.** The Action commits with the repo's built-in
   token (the `permissions: contents: write` line). No personal access token needed.
2. **LinkedIn webhook (optional but needed for full auto):** create a Zapier Zap —
   trigger *Webhooks by Zapier → Catch Hook*, action *LinkedIn → Create Share Update*
   (map `comment`→Comment, `url`→Content URL, `title`→Content Title, `image`→Content Image URL).
   Copy the catch-hook URL into the repo: **Settings → Secrets and variables → Actions →
   New repository secret → `ZAPIER_LINKEDIN_WEBHOOK`**. Until this exists, the blog still
   auto-publishes; you just post the teaser manually.

## Test before relying on it

- Stage a throwaway post with today's date, then **Actions → Publish scheduled posts →
  Run workflow** (`workflow_dispatch`). Confirm it publishes correctly and the site
  looks right. Delete the test post afterward.
- The `dvs-blog-publish-monfri` scheduled reminder is the **monitor**: if a Mon/Fri
  passes with nothing published, it flags a content-buffer gap.

## Caveats (honest)

- **GitHub Actions cron is UTC and best-effort** — runs can be delayed several minutes
  under load, and scheduled workflows auto-disable after **60 days of no repo activity**
  (the Mon/Fri pushes keep it alive; the monitor catches it if it ever stalls).
- The publish script is **fail-loud**: if `sitemap.xml` or `blog/index.html` ever change
  shape and an anchor isn't found, the run fails rather than corrupting a file. If that
  happens, the run just needs a quick fix — nothing is mangled.
