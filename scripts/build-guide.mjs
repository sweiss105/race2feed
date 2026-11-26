#!/usr/bin/env node
/**
 * Builds docs/PRC-User-Guide.pdf from docs/user-guide.md and the screenshots in docs/guide/images.
 *
 *   npm run guide:pdf   (or `npm run guide` to retake the screenshots first)
 *
 * The markdown is converted with `marked`, laid out as a printable manual (cover, contents, one role per
 * chapter) and printed with Playwright's Chromium. It renders twice: the first pass reads the page each
 * heading landed on from the PDF's outline, and the second fills those page numbers into the contents.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { Marked } from 'marked';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const SOURCE = join(DOCS, 'user-guide.md');
const OUTPUT = join(DOCS, 'PRC-User-Guide.pdf');
const SITE = 'r2f.weiss-audio.com';
const ACCENT = '#D71920';

// ── Markdown → HTML ─────────────────────────────────────────────────────────

const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** GitHub-style heading ids, so the guide's own `#links` work in the PDF too. */
function slugger() {
  const seen = new Map();
  return (text) => {
    const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

function toHtml(markdown) {
  const slug = slugger();
  const headings = [];
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens);
        const text = plain(html);
        const id = slug(text);
        headings.push({ depth, id, text });
        return `<h${depth} id="${id}">${html}</h${depth}>\n`;
      },
    },
  });
  return { html: marked.parse(markdown), headings };
}

// ── Images ──────────────────────────────────────────────────────────────────

/** Pixel size of a PNG or JPEG, read from its header. */
function imageSize(file) {
  const b = readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  let i = 2;
  while (i < b.length) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    i += 2 + len;
  }
  throw new Error(`Cannot read the size of ${file}`);
}

/** Screenshots are taken at 2× so they stay sharp in print; this is their size in CSS pixels. */
function figure(src, alt) {
  const file = join(DOCS, src);
  const { width, height } = imageSize(file);
  const name = src.split('/').pop();
  const cssWidth = Math.round(width / 2);
  const kind = name.startsWith('phone-') ? 'phone'
    : name.startsWith('projector-') ? 'wide'
    : name.startsWith('referee-') && cssWidth >= 1000 ? 'tablet'
    : cssWidth >= 1400 ? 'console'
    : 'natural';
  // Crops are shown at 70% of their on-screen size, close to the scale of the full-window shots.
  const style = kind === 'natural' ? ` style="max-width:min(100%, ${Math.round(cssWidth * 0.7)}px)"` : '';
  return `<figure class="shot ${kind}"><img src="${pathToFileURL(file).href}" alt="${escapeHtml(alt)}" width="${width}" height="${height}"${style}>`
    + `<figcaption>${escapeHtml(alt)}</figcaption></figure>`;
}

/** Paragraphs that hold only images become figures (side by side when there are two). */
function figures(html) {
  return html.replace(/<p>((?:\s*<img [^>]*>\s*)+)<\/p>/g, (_, imgs) => {
    const items = [...imgs.matchAll(/<img src="([^"]+)" alt="([^"]*)"[^>]*>/g)].map(([, src, alt]) => figure(src, plain(alt)));
    return items.length > 1 ? `<div class="figrow">${items.join('')}</div>` : items[0];
  });
}

// ── Page ────────────────────────────────────────────────────────────────────

function contents(headings, pages) {
  const rows = headings.filter((h) => h.depth === 2 || h.depth === 3).map((h) => {
    const page = pages?.get(h.id) ?? '00';
    return `<li class="toc-${h.depth}"><a href="#${h.id}"><span class="toc-text">${escapeHtml(h.text)}</span>`
      + `<span class="toc-dots"></span><span class="toc-page">${page}</span></a></li>`;
  });
  return `<nav class="toc" aria-label="Contents"><h2 class="toc-title">Contents</h2><ol>${rows.join('')}</ol></nav>`;
}

function pageHtml({ title, intro, body, headings, pages, generated }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}: Event Staff Guide</title>
<style>
  @page { size: Letter; margin: 0.8in 0.85in 0.85in; }
  @page :first { margin: 0; }
  :root {
    --accent: ${ACCENT};
    --label: #1d1d1f;
    --secondary: #6e6e73;
    --hairline: #d2d2d7;
    --fill: #f5f5f7;
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: var(--label);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 10pt; line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  /* Cover */
  .cover { background: #fff; height: 11in; padding: 1.1in 0.95in 0.9in; display: flex; flex-direction: column; break-after: page; position: relative; overflow: hidden; }
  .cover::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 0.22in; background: var(--accent); }
  .cover .kicker { font-size: 11pt; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
  .cover h1 { font-size: 54pt; line-height: 1.02; letter-spacing: -0.035em; font-weight: 800; margin: 0.18in 0 0; }
  .cover .subtitle { font-size: 24pt; font-weight: 500; letter-spacing: -0.02em; color: var(--secondary); margin-top: 0.12in; }
  .cover .hero { margin-top: auto; display: flex; gap: 0.25in; align-items: flex-end; }
  .cover .hero img { display: block; border-radius: 10px; border: 0.5pt solid var(--hairline); box-shadow: 0 6px 24px rgba(0,0,0,0.12); }
  .cover .hero .console { width: 4.75in; }
  .cover .hero .phone { width: 1.35in; border-radius: 14px; }
  .cover .meta { margin-top: 0.5in; padding-top: 0.18in; border-top: 0.75pt solid var(--hairline); display: flex; justify-content: space-between; font-size: 10.5pt; color: var(--secondary); }
  .cover .meta strong { color: var(--label); font-weight: 600; }

  /* Intro and contents */
  .intro { margin-bottom: 0.35in; }
  .intro h2 { font-size: 16pt; letter-spacing: -0.02em; margin: 0 0 0.1in; padding: 0; border: 0; break-before: auto; }
  .intro + h2 { break-before: auto; }
  .toc-title { font-size: 26pt; letter-spacing: -0.03em; margin: 0 0 0.2in; break-before: auto; }
  .toc { break-after: page; }
  .toc ol { list-style: none; margin: 0; padding: 0; }
  .toc a { display: flex; align-items: baseline; color: inherit; text-decoration: none; }
  .toc-dots { flex: 1; border-bottom: 0.75pt dotted #b8b8bd; margin: 0 0.08in; transform: translateY(-0.25em); }
  .toc-page { font-variant-numeric: tabular-nums; min-width: 1.6em; text-align: right; color: var(--secondary); }
  .toc-2 { font-weight: 600; font-size: 10pt; margin-top: 0.08in; }
  .toc-2 .toc-page { color: var(--label); }
  .toc-3 { padding-left: 0.22in; font-size: 9pt; line-height: 1.32; color: #3a3a3c; }
  .toc-2 + .toc-2 { margin-top: 0.06in; }

  /* Body */
  h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
  h2 { break-before: page; font-size: 26pt; line-height: 1.1; letter-spacing: -0.03em; font-weight: 800; margin: 0 0 0.2in; padding-bottom: 0.12in; border-bottom: 2pt solid var(--accent); }
  h3 { font-size: 14pt; letter-spacing: -0.015em; font-weight: 700; margin: 0.32in 0 0.08in; }
  h4 { font-size: 11pt; margin: 0.2in 0 0.05in; }
  p { margin: 0 0 0.1in; orphans: 3; widows: 3; }
  /* Keep a lead-in line ("For example:", "It's refused when…") with what it introduces. */
  p:has(+ table), p:has(+ pre), p:has(+ ul), p:has(+ ol), p:has(+ .figrow), p:has(+ figure) { break-after: avoid; page-break-after: avoid; }
  a { color: var(--accent); text-decoration: none; }
  strong { font-weight: 650; }
  hr { display: none; }
  code { font-family: "SF Mono", ui-monospace, Menlo, "JetBrains Mono", Consolas, monospace; font-size: 0.88em; background: var(--fill); border-radius: 4px; padding: 0.05em 0.3em; }
  pre { background: var(--fill); border-radius: 8px; padding: 0.1in 0.14in; white-space: pre-wrap; word-break: break-word; break-inside: avoid; margin: 0.08in 0 0.12in; }
  pre code { background: none; padding: 0; font-size: 8.8pt; line-height: 1.5; }
  blockquote { margin: 0.12in 0; padding: 0.1in 0.16in; background: var(--fill); border-left: 3pt solid var(--accent); border-radius: 0 8px 8px 0; color: #3a3a3c; break-inside: avoid; }
  blockquote p:last-child { margin-bottom: 0; }

  ul, ol { margin: 0 0 0.12in; padding-left: 0.26in; }
  li { margin: 0.03in 0; }
  li > p { margin: 0 0 0.05in; }
  ul > li::marker { color: var(--accent); }
  /* Numbered steps: red numbers in a circle. */
  ol { list-style: none; counter-reset: step; padding-left: 0.34in; }
  ol > li { counter-increment: step; position: relative; }
  ol > li::before {
    content: counter(step); position: absolute; left: -0.34in; top: 0.02em;
    width: 1.55em; height: 1.55em; border-radius: 50%; background: var(--accent); color: #fff;
    font-size: 0.8em; font-weight: 700; line-height: 1.55em; text-align: center;
  }

  table { width: 100%; border-collapse: collapse; margin: 0.08in 0 0.16in; font-size: 9.5pt; break-inside: avoid; }
  th { text-align: left; font-weight: 600; color: var(--secondary); font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; border-bottom: 1pt solid var(--label); padding: 0.05in 0.08in; }
  td { border-bottom: 0.5pt solid var(--hairline); padding: 0.06in 0.08in; vertical-align: top; }
  td code { white-space: nowrap; }

  /* Screenshots */
  figure.shot { margin: 0.14in 0 0.2in; break-inside: avoid; page-break-inside: avoid; text-align: center; }
  figure.shot img { display: block; margin: 0 auto; width: 100%; height: auto; border-radius: 8px; border: 0.5pt solid var(--hairline); box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  figure.shot figcaption { margin-top: 0.07in; font-size: 8.5pt; line-height: 1.4; color: var(--secondary); }
  figure.natural img { width: auto; }
  figure.phone { width: 40%; margin-left: auto; margin-right: auto; }
  figure.phone img { border-radius: 14px; }
  figure.tablet { width: 68%; margin-left: auto; margin-right: auto; }
  figure.console { width: 90%; margin-left: auto; margin-right: auto; }
  .figrow { display: flex; gap: 0.25in; justify-content: center; align-items: flex-start; margin: 0.14in 0 0.2in; break-inside: avoid; page-break-inside: avoid; }
  .figrow figure.shot { margin: 0; flex: 1 1 0; }
  .figrow figure.phone { flex: 0 0 40%; }
  li figure.shot { margin-left: -0.3in; }
</style>
</head>
<body>
  <section class="cover">
    <div class="kicker">Event Staff Guide</div>
    <h1>${escapeHtml(title)}</h1>
    <div class="subtitle">Packing Race Coordinator</div>
    <div class="hero">
      <img class="console" src="${pathToFileURL(join(DOCS, 'guide/images/console-race-running.jpg')).href}" alt="">
      <img class="phone" src="${pathToFileURL(join(DOCS, 'guide/images/phone-next-race.png')).href}" alt="">
    </div>
    <div class="meta"><span><strong>${SITE}</strong></span><span>Generated ${escapeHtml(generated)}</span></div>
  </section>
  ${contents(headings, pages)}
  <main><section class="intro"><h2 class="intro-title">About this guide</h2>${intro}</section>${body}</main>
</body>
</html>`;
}

// ── Page numbers from the PDF outline ───────────────────────────────────────

/** Reads the PDF's bookmarks (built from the headings) and returns the page number of each, in order. */
function outlinePages(pdf) {
  const text = pdf.toString('latin1');
  const objects = new Map();
  for (const m of text.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) objects.set(Number(m[1]), m[2]);
  // Some writers pack objects into compressed object streams; unpack those too.
  for (const body of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(body)) continue;
    const n = Number(/\/N (\d+)/.exec(body)[1]);
    const first = Number(/\/First (\d+)/.exec(body)[1]);
    const start = body.indexOf('stream') + 'stream'.length;
    const raw = Buffer.from(body.slice(start, body.lastIndexOf('endstream')).replace(/^\r?\n/, ''), 'latin1');
    const data = inflateSync(raw).toString('latin1');
    const nums = data.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) objects.set(nums[2 * i], data.slice(first + nums[2 * i + 1], i + 1 < n ? first + nums[2 * i + 3] : undefined));
  }
  const ref = (body, key) => { const m = new RegExp(`/${key}\\s+(\\d+) 0 R`).exec(body); return m ? Number(m[1]) : null; };

  const catalog = [...objects.values()].find((b) => /\/Type\s*\/Catalog/.test(b));
  const order = [];
  const walk = (id) => {
    const body = objects.get(id);
    if (/\/Type\s*\/Pages/.test(body)) for (const k of /\/Kids\s*\[([^\]]*)\]/.exec(body)[1].matchAll(/(\d+) 0 R/g)) walk(Number(k[1]));
    else order.push(id);
  };
  walk(ref(catalog, 'Pages'));
  const pageOf = new Map(order.map((id, i) => [id, i + 1]));

  const decode = (s) => {
    const hex = /^<([0-9A-Fa-f\s]*)>$/.exec(s);
    if (hex) {
      const b = Buffer.from(hex[1].replace(/\s/g, ''), 'hex');
      return b[0] === 0xfe && b[1] === 0xff ? Buffer.from(b.subarray(2)).swap16().toString('utf16le') : b.toString('latin1');
    }
    return s.slice(1, -1).replace(/\\([()\\])/g, '$1');
  };
  const entries = [];
  const visit = (id) => {
    while (id !== null) {
      const body = objects.get(id);
      const title = /\/Title\s*(<[^>]*>|\((?:\\.|[^\\)])*\))/.exec(body);
      const dest = /\/Dest\s*\[\s*(\d+) 0 R/.exec(body);
      // Chromium sometimes repeats a heading's text in its bookmark ("AdminAdmin"); keep one copy.
      let name = title ? decode(title[1]) : '';
      const half = name.length / 2;
      if (name.length % 2 === 0 && name.slice(0, half) === name.slice(half)) name = name.slice(0, half);
      entries.push({ title: name, page: dest ? pageOf.get(Number(dest[1])) : undefined });
      const child = ref(body, 'First');
      if (child !== null) visit(child);
      id = ref(body, 'Next');
    }
  };
  const outlines = ref(catalog, 'Outlines');
  if (outlines !== null) { const first = ref(objects.get(outlines), 'First'); if (first !== null) visit(first); }
  return { entries, pageCount: order.length };
}

/** Heading id → page number, matched to the outline in document order. Null if they can't be matched. */
function headingPages(pdf) {
  try {
    const entries = outlinePages(pdf).entries;
    // Chromium can garble the bookmark of a heading that wraps, so compare only the start of each title.
    const key = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 12).toLowerCase();
    const start = entries.findIndex((e) => key(e.title) === key(headings[0].text));
    if (start < 0) return null;
    const ok = headings.every((h, i) => entries[start + i] && key(entries[start + i].title) === key(h.text) && entries[start + i].page);
    return ok ? new Map(headings.map((h, i) => [h.id, entries[start + i].page])) : null;
  } catch {
    return null;
  }
}

// ── Build ───────────────────────────────────────────────────────────────────

const markdown = readFileSync(SOURCE, 'utf8');
const titleMatch = /^# (.+)$/m.exec(markdown);
const title = 'PRC';
// The intro (before the first chapter) goes before the contents; everything from the first chapter on is the body.
const firstChapter = markdown.search(/^## /m);
const introMd = markdown.slice(titleMatch ? titleMatch.index + titleMatch[0].length : 0, firstChapter).replace(/^---\s*$/gm, '');
const intro = toHtml(introMd).html;
const { html: bodyHtml, headings } = toHtml(markdown.slice(firstChapter));
const body = figures(bodyHtml);
const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

// The footer box is as tall as the page's bottom margin. The cover has no margin, so with overflow hidden
// nothing shows there.
const footer = `<style>html, body { height: 100%; margin: 0; }</style>
<div style="box-sizing:border-box; width:100%; height:100%; overflow:hidden; display:flex; align-items:flex-start; justify-content:space-between; padding:0.32in 0.85in 0; font-size:7.5pt; color:#86868b; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Arial, sans-serif;">
  <span>PRC · Event Staff Guide</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

const work = mkdtempSync(join(tmpdir(), 'r2f-guide-'));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const render = async (pages) => {
    const file = join(work, 'guide.html');
    writeFileSync(file, pageHtml({ title, intro, body, headings, pages, generated }));
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return page.pdf({
      format: 'Letter',
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footer,
      outline: true,
      tagged: true,
    });
  };

  // Pass 1: lay out with placeholder page numbers, then read where each heading landed.
  const draft = await render(null);
  const pages = headingPages(draft);
  if (!pages) console.warn('Could not read page numbers from the PDF outline; the contents will have no page numbers.');

  // Pass 2: the same layout with the real page numbers (they take no more room than the placeholders).
  const pdf = await render(pages ?? new Map(headings.map((h) => [h.id, ''])));
  const check = headingPages(pdf);
  if (pages && check && [...pages].some(([id, n]) => check.get(id) !== n)) console.warn('Warning: headings moved between passes; check the contents page numbers.');
  writeFileSync(OUTPUT, pdf);
  let count = null;
  try { count = outlinePages(pdf).pageCount; } catch { /* the size alone is reported */ }
  console.log(`Wrote ${OUTPUT.replace(`${ROOT}/`, '')}: ${count ? `${count} pages, ` : ''}${(pdf.length / 1024 / 1024).toFixed(1)} MB`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

