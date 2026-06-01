// fire-linkedin.mjs
// Runs AFTER the blog post is committed, pushed, and Vercel has deployed
// (website-first). Reads the list of just-published posts and POSTs each
// teaser + URL to a Zapier "Catch Hook" webhook, which is wired to a
// LinkedIn "Create Share Update" action.
//
// Requires repo secret ZAPIER_LINKEDIN_WEBHOOK. If it's not set, this is a
// no-op (the blog still publishes; the teaser is posted manually) — so the
// blog automation works even before the LinkedIn webhook is configured.

import fs from 'node:fs';

const webhook = process.env.ZAPIER_LINKEDIN_WEBHOOK;
const PUBLISHED_OUT = process.env.PUBLISHED_OUT || '.published.json';

if (!webhook) {
  console.log('ZAPIER_LINKEDIN_WEBHOOK not set — skipping auto LinkedIn. Post the teaser(s) manually.');
  process.exit(0);
}
if (!fs.existsSync(PUBLISHED_OUT)) {
  console.log('No published list found — nothing to post to LinkedIn.');
  process.exit(0);
}

const published = JSON.parse(fs.readFileSync(PUBLISHED_OUT, 'utf8'));
if (!published.length) {
  console.log('Published list empty — nothing to post.');
  process.exit(0);
}

for (const p of published) {
  // The Zap maps these fields → LinkedIn Create Share Update:
  //   comment = teaser text; content__submitted_url = url (rich link preview);
  //   content__title / content__description / content__submitted_image_url as configured in the Zap.
  const payload = {
    comment: p.teaser,
    url: p.url,
    title: p.title,
    image: 'https://digitalventurestudio.com/images/h1-open-graph.png',
  };
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`LinkedIn webhook failed for ${p.url}: ${res.status} ${await res.text()}`);
  console.log(`LinkedIn teaser fired for ${p.url}`);
}
