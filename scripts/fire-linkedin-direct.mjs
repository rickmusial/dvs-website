// fire-linkedin-direct.mjs
// Runs AFTER a scheduled blog post is published, committed, pushed, and Vercel
// has deployed (website-first). Reads the just-published list and posts each
// post's pre-written teaser + live URL to LinkedIn via the DIRECT API poster
// (replaces the flaky Zapier path, fire-linkedin.mjs). Spec: DVS-LPS v2.0.
//
// Requires repo secrets LINKEDIN_TOKEN + LINKEDIN_AUTHOR_URN (same as the
// LinkedIn poster workflows). Fail-loud: if a teaser doesn't return 201 + URN
// the step fails and GitHub emails Rick — the blog is already live, only the
// teaser alerts. Authorship stays human: teasers are the pre-approved
// linkedinTeaser fields from scheduled/manifest.json.

import fs from 'node:fs';
import { postToLinkedIn } from './post-linkedin.mjs';

const PUBLISHED_OUT = process.env.PUBLISHED_OUT || '.published.json';

if (!fs.existsSync(PUBLISHED_OUT)) {
  console.log('No published list — nothing to post to LinkedIn.');
  process.exit(0);
}
const published = JSON.parse(fs.readFileSync(PUBLISHED_OUT, 'utf8'));
if (!published.length) {
  console.log('Published list empty — nothing to post.');
  process.exit(0);
}

let failures = 0;
const lines = [];
for (const p of published) {
  if (!p.teaser || !p.teaser.trim()) {
    console.log(`No teaser for ${p.url} — skipping (post it manually if wanted).`);
    continue;
  }
  const text = `${p.teaser}\n\n${p.url}`;
  try {
    const { urn } = await postToLinkedIn({ text });
    const postUrl = `https://www.linkedin.com/feed/update/${urn}/`;
    console.log(`Teaser posted for ${p.url} → ${urn}`);
    lines.push(`- ✅ teaser for \`${p.url}\` → ${postUrl}`);
  } catch (e) {
    failures++;
    console.error(`Teaser FAILED for ${p.url}: ${e.message}`);
    lines.push(`- ❌ teaser for \`${p.url}\` — ${e.message}`);
  }
}

if (process.env.GITHUB_STEP_SUMMARY && lines.length) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### LinkedIn teasers\n\n${lines.join('\n')}\n`);
}
if (failures > 0) process.exit(1);
