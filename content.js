// content.js — Ureddit DOM Scraper
// Handles both new Reddit (shreddit) and old Reddit layouts.
//
// TEAM NOTE:
//   This file owns DOM scraping only.
//   Classification logic lives in insights.js (window.UredditInsights).
//   After a successful scrape, call window.UredditInsights.run(comments)
//   to trigger the sidebar — no other changes needed here.

'use strict';

// Guard against double injection
if (window.__uredditInjected) {
  // Already active — just re-register listener
} else {
  window.__uredditInjected = true;
}

// ── Listen for scrape command from popup ──────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'UREDDIT_SCRAPE') return;

  const options = message.options || {};
  scrapeThread(options)
    .then(payload => {
      // ── INSIGHT LAYER: trigger sidebar after successful scrape ──
      if (payload.data && payload.data.comments && window.UredditInsights) {
        window.UredditInsights.run(payload.data.comments);
      }

      chrome.runtime.sendMessage({ type: 'UREDDIT_RESULT', payload });
    })
    .catch(err => {
      chrome.runtime.sendMessage({
        type:    'UREDDIT_RESULT',
        payload: { error: err.message || 'Scraping failed' },
      });
    });

  sendResponse({ ack: true });
  return true;
});

// ── Main scraper orchestrator ─────────────────────────────────────────────────
async function scrapeThread(options) {
  const { limit = 50, includeReplies = true } = options;

  // Detect which Reddit layout we're on
  const layout = detectLayout();

  let post     = {};
  let comments = [];

  if (layout === 'new') {
    post     = scrapePostNew();
    comments = scrapeCommentsNew(limit, includeReplies);
  } else if (layout === 'old') {
    post     = scrapePostOld();
    comments = scrapeCommentsOld(limit, includeReplies);
  } else {
    throw new Error('Could not detect Reddit layout. Make sure you are on a post page.');
  }

  const stats = computeStats(comments);

  const data = {
    title:      post.title || document.title,
    content:    post.content || '',
    author:     post.author || '',
    upvotes:    post.upvotes || '',
    subreddit:  extractSubreddit(),
    url:        window.location.href,
    scraped_at: new Date().toISOString(),
    comments:   comments,
  };

  return { data, stats };
}

// ── Layout detection ──────────────────────────────────────────────────────────
function detectLayout() {
  // Shreddit (new Reddit 2023+)
  if (document.querySelector('shreddit-post') || document.querySelector('[data-testid="post-container"]')) {
    return 'new';
  }
  // Old Reddit
  if (document.querySelector('.thing.link') || document.querySelector('#siteTable')) {
    return 'old';
  }
  // New Reddit (pre-shreddit)
  if (document.querySelector('[data-test-id="post-content"]') || document.querySelector('.Post')) {
    return 'new';
  }
  return 'unknown';
}

function extractSubreddit() {
  const match = window.location.pathname.match(/\/r\/([^/]+)/);
  return match ? match[1] : '';
}

// ──────────────────────────────────────────────────────────────────────────────
// NEW REDDIT SCRAPERS
// ──────────────────────────────────────────────────────────────────────────────

function scrapePostNew() {
  const post = {};

  // Title — multiple selector strategies
  const titleEl =
    document.querySelector('shreddit-post h1') ||
    document.querySelector('[data-testid="post-container"] h1') ||
    document.querySelector('[data-test-id="post-content"] h1') ||
    document.querySelector('h1[slot="title"]') ||
    document.querySelector('h1');

  post.title = titleEl ? cleanText(titleEl.textContent) : '';

  // Body text
  const bodyEl =
    document.querySelector('[data-testid="post-container"] [data-click-id="text"]') ||
    document.querySelector('shreddit-post [slot="text-body"]') ||
    document.querySelector('[data-test-id="post-content"] [data-click-id="text"]') ||
    document.querySelector('.Post [data-click-id="text"]');

  post.content = bodyEl ? cleanText(bodyEl.innerText || bodyEl.textContent) : '';

  // Author
  const authorEl =
    document.querySelector('[data-testid="post_author_link"]') ||
    document.querySelector('shreddit-post a[href*="/user/"]') ||
    document.querySelector('a[data-testid="post_author_link"]');

  if (authorEl) {
    post.author = cleanText(authorEl.textContent).replace(/^u\//, '');
  }

  // Upvotes
  const upvoteEl =
    document.querySelector('[data-testid="vote-arrows"] [id*="vote-arrows"]') ||
    document.querySelector('shreddit-post faceplate-number') ||
    document.querySelector('[data-click-id="upvote"] + *') ||
    document.querySelector('[aria-label*="upvote"]');

  if (upvoteEl) post.upvotes = cleanText(upvoteEl.textContent);

  return post;
}

function scrapeCommentsNew(limit, includeReplies) {
  const comments = [];

  // Try shreddit-comment elements first (2023+ Reddit)
  let commentEls = Array.from(document.querySelectorAll('shreddit-comment[depth="0"]'));

  // Fallback: older new Reddit
  if (!commentEls.length) {
    commentEls = Array.from(document.querySelectorAll('[data-testid="comment"]'));
  }

  // Fallback: any comment div
  if (!commentEls.length) {
    commentEls = Array.from(document.querySelectorAll('.Comment, [id^="t1_"]'));
  }

  const topLevel = commentEls.slice(0, limit);

  for (const el of topLevel) {
    const comment = extractCommentNew(el, includeReplies);
    if (comment) comments.push(comment);
  }

  return comments;
}

function extractCommentNew(el, includeReplies) {
  // Get comment text body
  const bodyEl =
    el.querySelector('[data-testid="comment"] p') ||
    el.querySelector('p') ||
    el.querySelector('[slot="comment"]') ||
    el.querySelector('.RichTextJSON-root') ||
    el.querySelector('[id*="comment-body"]');

  if (!bodyEl) return null;

  const text = cleanText(bodyEl.innerText || bodyEl.textContent);
  if (!text || text.length < 2) return null;

  // Author
  let author = '';
  const authorEl =
    el.querySelector('[data-testid="comment_author_link"]') ||
    el.querySelector('a[href*="/user/"]');
  if (authorEl) author = cleanText(authorEl.textContent).replace(/^u\//, '');

  // Upvotes
  let upvotes = '';
  const upEl = el.querySelector('[aria-label*="upvotes"]') || el.querySelector('faceplate-number');
  if (upEl) upvotes = cleanText(upEl.textContent);

  // Timestamp
  let timestamp = '';
  const timeEl = el.querySelector('time');
  if (timeEl) timestamp = timeEl.getAttribute('datetime') || timeEl.textContent;

  const comment = { text, author, upvotes, timestamp, replies: [] };

  if (includeReplies) {
    // Shreddit nested comments
    const replyEls = Array.from(el.querySelectorAll('shreddit-comment'))
      .filter(r => r !== el && !r.closest('shreddit-comment:not(:scope)'));

    // Fallback for older Reddit
    const fallbackReplies = replyEls.length
      ? replyEls
      : Array.from(el.querySelectorAll('.Comment'));

    for (const replyEl of fallbackReplies) {
      const reply = extractCommentNew(replyEl, true);
      if (reply) comment.replies.push(reply);
    }
  }

  return comment;
}

// ──────────────────────────────────────────────────────────────────────────────
// OLD REDDIT SCRAPERS (old.reddit.com)
// ──────────────────────────────────────────────────────────────────────────────

function scrapePostOld() {
  const post = {};

  const titleEl = document.querySelector('.title.may-blank, a.title');
  post.title = titleEl ? cleanText(titleEl.textContent) : '';

  const bodyEl = document.querySelector('.usertext-body .md');
  post.content = bodyEl ? cleanText(bodyEl.innerText || bodyEl.textContent) : '';

  const authorEl = document.querySelector('.top-matter .author');
  post.author = authorEl ? cleanText(authorEl.textContent) : '';

  const upvoteEl = document.querySelector('.score.unvoted, .score.likes, .score.dislikes');
  post.upvotes = upvoteEl ? cleanText(upvoteEl.textContent) : '';

  return post;
}

function scrapeCommentsOld(limit, includeReplies) {
  const comments = [];
  const topLevelEls = Array.from(
    document.querySelectorAll('.nestedlisting > .comment')
  ).slice(0, limit);

  for (const el of topLevelEls) {
    const comment = extractCommentOld(el, includeReplies);
    if (comment) comments.push(comment);
  }

  return comments;
}

function extractCommentOld(el, includeReplies) {
  const bodyEl = el.querySelector(':scope > .entry .usertext-body .md');
  if (!bodyEl) return null;

  const text = cleanText(bodyEl.innerText || bodyEl.textContent);
  if (!text || text.length < 2) return null;

  const authorEl = el.querySelector(':scope > .entry .author');
  const author   = authorEl ? cleanText(authorEl.textContent) : '';

  const upEl    = el.querySelector(':scope > .entry .score');
  const upvotes = upEl ? cleanText(upEl.textContent) : '';

  const timeEl  = el.querySelector(':scope > .entry time');
  const timestamp = timeEl ? (timeEl.getAttribute('datetime') || '') : '';

  const comment = { text, author, upvotes, timestamp, replies: [] };

  if (includeReplies) {
    const replyEls = Array.from(el.querySelectorAll(':scope > .child .nestedlisting > .comment'));
    for (const replyEl of replyEls) {
      const reply = extractCommentOld(replyEl, true);
      if (reply) comment.replies.push(reply);
    }
  }

  return comment;
}

// ── Text cleaning ─────────────────────────────────────────────────────────────
function cleanText(raw) {
  if (!raw) return '';
  return raw
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Stats computation ─────────────────────────────────────────────────────────
function computeStats(comments) {
  let totalComments = 0;
  let totalReplies  = 0;
  let totalWords    = 0;

  function walk(nodes, depth = 0) {
    for (const c of nodes) {
      if (depth === 0) totalComments++;
      else             totalReplies++;
      totalWords += (c.text || '').split(/\s+/).filter(Boolean).length;
      if (c.replies && c.replies.length) walk(c.replies, depth + 1);
    }
  }

  walk(comments);
  return { comments: totalComments, replies: totalReplies, words: totalWords };
}
