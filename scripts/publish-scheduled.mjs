// publish-scheduled.mjs
// Publishes any staged blog post whose publishDate is due (<= today, UTC).
// For each due post: moves scheduled/<slug>.html -> blog/<slug>.html, adds a
// sitemap entry, inserts/promotes its card in blog/index.html, and removes it
// from scheduled/manifest.json. Records published posts to $PUBLISHED_OUT so the
// workflow can fire their LinkedIn teasers AFTER the site is live (website-first).
//
// Fail-loud by design: if an expected anchor isn't found, it THROWS and the
// Action fails — better a failed run (caught by the Mon/Fri monitor) than a
// silently corrupted sitemap or index. Test via workflow_dispatch before relying on it.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SCHEDULED_DIR = path.join(ROOT, 'scheduled');
const MANIFEST = path.join(SCHEDULED_DIR, 'manifest.json');
const BLOG_DIR = path.join(ROOT, 'blog');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const INDEX = path.join(BLOG_DIR, 'index.html');
const PUBLISHED_OUT = process.env.PUBLISHED_OUT || path.join(ROOT, '.published.json');
const SITE = 'https://digitalventurestudio.com';

// "Today" in the venue's local timezone (Australia/Sydney = AEST/AEDT, DST-safe),
// NOT UTC — the cron fires at 08:15 AEST when the UTC date is still the day before,
// so a UTC compare would publish AEST-dated posts a run late. en-CA → YYYY-MM-DD.
const todayUTC = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function displayDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${d} ${months[m - 1]} ${y}`;
}

const manifest = readJSON(MANIFEST);
const queue = Array.isArray(manifest.queue) ? manifest.queue : [];
const due = queue
  .filter(e => e.publishDate && e.publishDate <= todayUTC)
  .sort((a, b) => a.publishDate.localeCompare(b.publishDate));

if (due.length === 0) {
  console.log(`No posts due as of ${todayUTC}.`);
  fs.writeFileSync(PUBLISHED_OUT, '[]');
  process.exit(0);
}

const published = [];

for (const entry of due) {
  const slug = entry.slug;
  const src = path.join(SCHEDULED_DIR, `${slug}.html`);
  const dest = path.join(BLOG_DIR, `${slug}.html`);
  if (!fs.existsSync(src)) throw new Error(`Staged file missing: scheduled/${slug}.html`);
  const url = `${SITE}/blog/${slug}.html`;

  // 1) Move the post into the live blog folder.
  fs.renameSync(src, dest);

  // 2) Sitemap: insert a <url> block before the first /legal/ entry (blog posts precede legal).
  let sitemap = fs.readFileSync(SITEMAP, 'utf8');
  const legalAnchor = `  <url>\n    <loc>${SITE}/legal/privacy</loc>`;
  if (!sitemap.includes(legalAnchor)) throw new Error('sitemap.xml anchor not found (legal/privacy <url> block). Aborting to avoid corruption.');
  const sitemapBlock =
    `  <url>\n    <loc>${url}</loc>\n    <lastmod>${entry.publishDate}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.8</priority>\n  </url>\n\n`;
  sitemap = sitemap.replace(legalAnchor, sitemapBlock + legalAnchor);
  fs.writeFileSync(SITEMAP, sitemap);

  // 3) Index: build the card; if featured (default), demote the current featured and insert at top.
  let index = fs.readFileSync(INDEX, 'utf8');
  const isFeatured = entry.featured !== false;
  const cls = isFeatured ? 'post-card featured' : 'post-card';
  const card =
`        <!-- ${slug} (${entry.publishDate}) -->
        <article class="${cls}" itemscope itemtype="https://schema.org/BlogPosting">
          <div class="post-card-body">
            <div class="post-meta">
              <span class="post-category" itemprop="articleSection">${entry.category}</span>
              <time class="post-date" itemprop="datePublished" datetime="${entry.publishDate}">${displayDate(entry.publishDate)}</time>
              <span class="post-read-time">${entry.readTime}</span>
            </div>
            <h2 itemprop="headline">
              <a href="/blog/${slug}.html">
                ${entry.title}
              </a>
            </h2>
            <p itemprop="description">
              ${entry.description}
            </p>
          </div>
          <div class="post-card-footer">
            <a href="/blog/${slug}.html" class="post-link">
              Read the article
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </a>
          </div>
        </article>
`;
  if (isFeatured) {
    // Demote the current featured card to a regular grid card (first match only).
    if (index.includes('class="post-card featured"')) {
      index = index.replace('class="post-card featured"', 'class="post-card"');
    }
  }
  const gridAnchor = '<div class="post-grid">\n';
  if (!index.includes(gridAnchor)) throw new Error('blog/index.html anchor not found (<div class="post-grid">). Aborting to avoid corruption.');
  index = index.replace(gridAnchor, gridAnchor + '\n' + card);
  fs.writeFileSync(INDEX, index);

  published.push({ url, title: entry.title, teaser: entry.linkedinTeaser || '' });
  console.log(`Published: ${slug} -> ${url}`);
}

// 4) Write the manifest back with the published entries removed.
manifest.queue = queue.filter(e => !due.includes(e));
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

// 5) Record what published so the next workflow step can fire LinkedIn after deploy.
fs.writeFileSync(PUBLISHED_OUT, JSON.stringify(published, null, 2));
console.log(`Done. ${published.length} post(s) published.`);
