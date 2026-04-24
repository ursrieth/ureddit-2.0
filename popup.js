// popup.js — Ureddit Extension Controller

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const scrapeBtn      = document.getElementById('scrapeBtn');
const btnLabel       = document.getElementById('btnLabel');
const statusDot      = document.getElementById('statusDot');
const progressWrap   = document.getElementById('progressWrap');
const progressFill   = document.getElementById('progressFill');
const progressLabel  = document.getElementById('progressLabel');
const statsRow       = document.getElementById('statsRow');
const statusMsg      = document.getElementById('statusMsg');
const pageTitle      = document.getElementById('pageTitle');
const subredditChip  = document.getElementById('subredditChip');
const readyChip      = document.getElementById('readyChip');
const mainContent    = document.getElementById('mainContent');
const notReddit      = document.getElementById('notReddit');
const commentLimit   = document.getElementById('commentLimit');
const includeReplies = document.getElementById('includeReplies');
const statComments   = document.getElementById('statComments');
const statReplies    = document.getElementById('statReplies');
const statWords      = document.getElementById('statWords');
const fmtBtns        = document.querySelectorAll('.fmt-btn');

let selectedFormat = 'json';
let isScraping     = false;

// ── Format toggle ─────────────────────────────────────────────────────────────
fmtBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    fmtBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedFormat = btn.dataset.fmt;
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setDot(state) {
  statusDot.className = 'status-dot ' + state;
}

function showProgress(label) {
  progressWrap.classList.add('visible');
  progressFill.classList.add('indeterminate');
  progressLabel.textContent = label;
}

function hideProgress() {
  progressWrap.classList.remove('visible');
  progressFill.classList.remove('indeterminate');
}

function showStatus(msg, type = 'info') {
  statusMsg.textContent = msg;
  statusMsg.className   = `status-msg visible ${type}`;
}

function hideStatus() {
  statusMsg.className = 'status-msg';
}

function showStats(comments, replies, words) {
  statComments.textContent = comments;
  statReplies.textContent  = replies;
  statWords.textContent    = words > 999 ? (words / 1000).toFixed(1) + 'k' : words;
  statsRow.classList.add('visible');
}

function setBusy(busy) {
  isScraping      = busy;
  scrapeBtn.disabled = busy;
  btnLabel.textContent = busy ? 'Scraping…' : 'Scrape This Thread';
  setDot(busy ? 'working' : 'ready');
}

// ── Detect Reddit thread in active tab ────────────────────────────────────────
async function detectThread() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return false;

    const url = tab.url || '';
    const isRedditThread = /reddit\.com\/r\/[^/]+\/comments\//.test(url);

    if (!isRedditThread) {
      mainContent.style.display = 'none';
      notReddit.classList.add('visible');
      return false;
    }

    // Extract subreddit name
    const match = url.match(/reddit\.com\/r\/([^/]+)/);
    if (match) subredditChip.textContent = 'r/' + match[1];

    // Try to get page title from tab
    if (tab.title) {
      const cleanTitle = tab.title.replace(' : ' + (match ? match[1] : '') + '', '').trim();
      pageTitle.textContent = cleanTitle || 'Reddit Thread';
    }

    setDot('ready');
    return true;

  } catch (err) {
    console.error('Detection error:', err);
    return false;
  }
}

// ── Trigger scraping via content script ───────────────────────────────────────
async function runScraper() {
  if (isScraping) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  setBusy(true);
  hideStatus();
  statsRow.classList.remove('visible');
  showProgress('Injecting scraper…');

  const options = {
    limit:          parseInt(commentLimit.value, 10),
    includeReplies: includeReplies.checked,
    format:         selectedFormat,
  };

  try {
    // Ensure content script is available
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files:  ['content.js'],
    });
  } catch (_) {
    // Already injected — that's fine
  }

  // Listen for result message from content script
  const resultListener = (message, sender) => {
    if (sender.tab?.id !== tab.id) return;
    if (message.type !== 'UREDDIT_RESULT') return;

    chrome.runtime.onMessage.removeListener(resultListener);
    handleResult(message.payload);
  };

  chrome.runtime.onMessage.addListener(resultListener);

  // Send scrape command to content script
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type:    'UREDDIT_SCRAPE',
      options: options,
    });

    progressLabel.textContent = 'Extracting comments…';

    // Safety timeout
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(resultListener);
      if (isScraping) {
        setBusy(false);
        hideProgress();
        showStatus('⚠️ Scraping timed out. Try reloading the page.', 'error');
        setDot('error');
      }
    }, 30000);

  } catch (err) {
    chrome.runtime.onMessage.removeListener(resultListener);
    setBusy(false);
    hideProgress();
    showStatus('❌ Could not reach page. Reload the Reddit tab and try again.', 'error');
    setDot('error');
  }
}

// ── Handle scraping result ────────────────────────────────────────────────────
function handleResult(payload) {
  setBusy(false);
  hideProgress();

  if (!payload || payload.error) {
    showStatus('❌ ' + (payload?.error || 'Unknown error during scraping.'), 'error');
    setDot('error');
    return;
  }

  const { data, stats } = payload;
  showStats(stats.comments, stats.replies, stats.words);

  if (selectedFormat === 'csv') {
    downloadCSV(data, stats);
  } else {
    downloadJSON(data);
  }

  showStatus(
    `✅ Done! ${stats.comments} comments · ${stats.replies} replies · ${stats.words} words extracted.`,
    'success'
  );
  setDot('ready');
}

// ── Download helpers ──────────────────────────────────────────────────────────
function downloadJSON(data) {
  const jsonStr  = JSON.stringify(data, null, 2);
  const blob     = new Blob([jsonStr], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const ts       = Date.now();
  const filename = `reddit_post_${ts}.json`;

  chrome.downloads.download({
    url:      url,
    filename: filename,
    saveAs:   false,
  }, () => URL.revokeObjectURL(url));
}

function downloadCSV(data) {
  const rows = [
    ['type', 'depth', 'text', 'author', 'upvotes', 'timestamp'],
    // Post row
    ['post', '0', csvEsc(data.title + '\n' + (data.content || '')), csvEsc(data.author || ''), data.upvotes || '', csvEsc(data.scraped_at || '')],
  ];

  function flattenComments(comments, depth = 1) {
    for (const c of comments) {
      rows.push(['comment', String(depth), csvEsc(c.text), csvEsc(c.author || ''), c.upvotes || '', csvEsc(c.timestamp || '')]);
      if (c.replies && c.replies.length) {
        flattenComments(c.replies, depth + 1);
      }
    }
  }

  flattenComments(data.comments || []);

  const csv      = rows.map(r => r.join(',')).join('\n');
  const blob     = new Blob([csv], { type: 'text/csv' });
  const url      = URL.createObjectURL(blob);
  const ts       = Date.now();
  const filename = `reddit_post_${ts}.csv`;

  chrome.downloads.download({
    url:      url,
    filename: filename,
    saveAs:   false,
  }, () => URL.revokeObjectURL(url));
}

function csvEsc(str) {
  if (!str) return '';
  const s = String(str).replace(/"/g, '""');
  return `"${s}"`;
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const isThread = await detectThread();
  if (!isThread) return;

  scrapeBtn.addEventListener('click', runScraper);
})();
