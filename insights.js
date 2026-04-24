// insights.js — Ureddit Insight Layer
// Rule-based comment classifier + sidebar renderer.
//
// TEAM GUIDE:
//   • Add/edit detection keywords in RULES below — no other file needs touching.
//   • Sidebar UI lives in buildSidebarHTML() + injectSidebarStyles().
//   • Scoring weights live in scoreComment().
//   • Entry point called by content.js: window.UredditInsights.run(comments)

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// 1. CLASSIFICATION RULES
//    Each category has a `keywords` array.
//    Add new phrases here freely — lowercase only, partial matches work.
// ─────────────────────────────────────────────────────────────────────────────
const RULES = {
  problem: {
    icon:  '🔴',
    label: 'Problem',
    keywords: [
      'i hate',
      'this is annoying',
      'this sucks',
      'why is it so',
      'not working',
      'too expensive',
      'frustrating',
      'bad experience',
      'terrible',
      'broken',
      "doesn't work",
      "can't figure out",
      'issue with',
      'problem with',
      'really annoying',
      'so slow',
      'keeps crashing',
      'complete garbage',
      'awful',
      'horrible',
    ],
  },

  idea: {
    icon:  '💡',
    label: 'Idea',
    keywords: [
      'they should',
      'it would be better if',
      'what if',
      'a good feature would be',
      'they need to',
      'would be nice if',
      'wish they',
      'please add',
      'feature request',
      'suggestion:',
      'it would help if',
      'i think they should',
      'how about',
      'imagine if',
    ],
  },

  demand: {
    icon:  '❓',
    label: 'Demand',
    keywords: [
      'is there a tool',
      'looking for',
      'does anyone know',
      'how do i',
      'any alternative',
      'is there an app',
      'anyone recommend',
      'what do you use',
      'help me find',
      'is there a way',
      'can anyone suggest',
      'what\'s the best way',
      'any tips on',
      'need help with',
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classify a single comment text.
 * Returns { category: 'problem'|'idea'|'demand'|null, matchedKeywords: string[] }
 */
function classifyText(text) {
  const lower = text.toLowerCase();
  let bestCategory = null;
  let bestMatches  = [];

  for (const [category, rule] of Object.entries(RULES)) {
    const matches = rule.keywords.filter(kw => lower.includes(kw));
    if (matches.length > bestMatches.length) {
      bestCategory = category;
      bestMatches  = matches;
    }
  }

  return { category: bestCategory, matchedKeywords: bestMatches };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SCORING
//    Weights are easy to tune — all in one place.
// ─────────────────────────────────────────────────────────────────────────────
const SCORE_WEIGHTS = {
  singleKeywordMatch:   2,   // base score per keyword hit
  multipleKeywords:     1,   // bonus when >1 keyword matches
  hasUpvotes:           1,   // bonus if upvote value is accessible + positive
};

function scoreComment(comment, matchedKeywords) {
  let score = 0;

  score += matchedKeywords.length * SCORE_WEIGHTS.singleKeywordMatch;

  if (matchedKeywords.length > 1) {
    score += SCORE_WEIGHTS.multipleKeywords;
  }

  const upvoteNum = parseUpvotes(comment.upvotes);
  if (upvoteNum > 0) {
    score += SCORE_WEIGHTS.hasUpvotes;
  }

  return score;
}

function parseUpvotes(raw) {
  if (!raw) return 0;
  const str = String(raw).toLowerCase().replace(/,/g, '').trim();
  if (str.endsWith('k')) return parseFloat(str) * 1000;
  const n = parseInt(str, 10);
  return isNaN(n) ? 0 : n;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. DEDUPLICATION
//    Removes near-duplicate insights by checking word overlap ratio.
// ─────────────────────────────────────────────────────────────────────────────
function deduplicateInsights(insights, threshold = 0.75) {
  const unique = [];
  for (const insight of insights) {
    const isDupe = unique.some(existing => {
      return jaccardSimilarity(insight.text, existing.text) >= threshold;
    });
    if (!isDupe) unique.push(insight);
  }
  return unique;
}

function jaccardSimilarity(a, b) {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. PIPELINE — flatten + classify + score + sort + dedupe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a flat or nested comment array into categorised insight objects.
 * Returns { problems, ideas, demands }
 */
function processComments(comments) {
  const allInsights = { problem: [], idea: [], demand: [] };

  // Walk comment tree (top-level + replies)
  function walk(nodes) {
    for (const c of nodes) {
      if (!c.text || c.text.length < 10) continue;

      const { category, matchedKeywords } = classifyText(c.text);
      if (!category) continue;

      const score = scoreComment(c, matchedKeywords);

      allInsights[category].push({
        text:     c.text,
        author:   c.author   || '',
        upvotes:  c.upvotes  || '',
        timestamp: c.timestamp || '',
        score,
        matchedKeywords,
        // We store a reference ID to scroll to later (based on author+snippet)
        refId: btoa(encodeURIComponent((c.author || '') + c.text.slice(0, 30))).slice(0, 12),
      });

      if (c.replies && c.replies.length) walk(c.replies);
    }
  }

  walk(comments);

  // Sort by score descending, keep top 10, deduplicate
  const sorted = (arr) =>
    deduplicateInsights(
      [...arr].sort((a, b) => b.score - a.score).slice(0, 10)
    );

  return {
    problems: sorted(allInsights.problem),
    ideas:    sorted(allInsights.idea),
    demands:  sorted(allInsights.demand),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SIDEBAR UI — injection + rendering
// ─────────────────────────────────────────────────────────────────────────────

const SIDEBAR_ID    = 'ureddit-insights-panel';
const STYLE_ID      = 'ureddit-insights-styles';
const SAVED_KEY     = 'ureddit_saved_insights';

function injectSidebarStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* ── Sidebar shell ── */
    #ureddit-insights-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 340px;
      height: 100vh;
      background: #0d0d0f;
      border-left: 1px solid #2a2a30;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      font-family: 'Syne', 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #f0f0f2;
      box-shadow: -8px 0 40px rgba(0,0,0,0.6);
      transform: translateX(100%);
      transition: transform 0.35s cubic-bezier(0.4,0,0.2,1);
    }
    #ureddit-insights-panel.open {
      transform: translateX(0);
    }

    /* Ambient glow */
    #ureddit-insights-panel::before {
      content: '';
      position: absolute;
      top: -40px; right: -20px;
      width: 220px; height: 180px;
      background: radial-gradient(ellipse, rgba(255,69,0,0.14) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }

    /* ── Header ── */
    #uri-header {
      position: relative;
      z-index: 1;
      padding: 16px 18px 14px;
      border-bottom: 1px solid #2a2a30;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    #uri-logo {
      width: 30px; height: 30px;
      background: linear-gradient(135deg, #ff4500, #ff6b35);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      font-size: 15px; font-weight: 800;
      box-shadow: 0 0 12px rgba(255,69,0,0.4);
      flex-shrink: 0;
    }
    #uri-title {
      font-size: 14px;
      font-weight: 800;
      letter-spacing: -0.2px;
      line-height: 1;
    }
    #uri-subtitle {
      font-size: 9px;
      color: #6b6b78;
      font-family: 'Space Mono', monospace;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }
    #uri-close {
      margin-left: auto;
      width: 26px; height: 26px;
      background: rgba(255,255,255,0.05);
      border: 1px solid #2a2a30;
      border-radius: 6px;
      cursor: pointer;
      color: #6b6b78;
      font-size: 14px;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s, color 0.2s;
      flex-shrink: 0;
    }
    #uri-close:hover { background: rgba(255,69,0,0.15); color: #ff6b35; }

    /* ── Summary bar ── */
    #uri-summary {
      position: relative; z-index: 1;
      display: flex;
      gap: 0;
      border-bottom: 1px solid #2a2a30;
      flex-shrink: 0;
    }
    .uri-sum-item {
      flex: 1;
      padding: 10px 0;
      text-align: center;
      border-right: 1px solid #2a2a30;
    }
    .uri-sum-item:last-child { border-right: none; }
    .uri-sum-count {
      font-size: 18px;
      font-weight: 800;
      font-family: 'Space Mono', monospace;
      line-height: 1;
    }
    .uri-sum-lbl {
      font-size: 8px;
      color: #6b6b78;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      margin-top: 2px;
    }

    /* ── Scroll body ── */
    #uri-body {
      flex: 1;
      overflow-y: auto;
      padding: 14px 16px 20px;
      position: relative;
      z-index: 1;
    }
    #uri-body::-webkit-scrollbar { width: 4px; }
    #uri-body::-webkit-scrollbar-track { background: transparent; }
    #uri-body::-webkit-scrollbar-thumb { background: #2a2a30; border-radius: 4px; }

    /* ── Section ── */
    .uri-section {
      margin-bottom: 22px;
    }
    .uri-section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .uri-section-icon { font-size: 16px; }
    .uri-section-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #f0f0f2;
    }
    .uri-section-count {
      margin-left: auto;
      font-size: 9px;
      font-family: 'Space Mono', monospace;
      color: #6b6b78;
      background: rgba(255,255,255,0.05);
      border: 1px solid #2a2a30;
      border-radius: 10px;
      padding: 1px 7px;
    }

    /* ── Insight card ── */
    .uri-card {
      background: #16161a;
      border: 1px solid #2a2a30;
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 6px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      position: relative;
    }
    .uri-card:hover { border-color: rgba(255,69,0,0.4); background: #1a1a20; }

    .uri-card-text {
      font-size: 11px;
      line-height: 1.55;
      color: #d0d0d8;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .uri-card-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
    }
    .uri-card-author {
      font-size: 9px;
      font-family: 'Space Mono', monospace;
      color: #6b6b78;
    }
    .uri-card-upvotes {
      font-size: 9px;
      font-family: 'Space Mono', monospace;
      color: #ff6b35;
      background: rgba(255,69,0,0.08);
      border: 1px solid rgba(255,107,53,0.2);
      border-radius: 4px;
      padding: 1px 5px;
    }
    .uri-card-score {
      margin-left: auto;
      font-size: 8px;
      font-family: 'Space Mono', monospace;
      color: #3a3a44;
    }

    /* Card action buttons */
    .uri-card-actions {
      display: flex;
      gap: 4px;
      margin-top: 8px;
    }
    .uri-action-btn {
      font-size: 9px;
      font-family: 'Space Mono', monospace;
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid #2a2a30;
      background: transparent;
      color: #6b6b78;
      cursor: pointer;
      transition: border-color 0.2s, color 0.2s, background 0.2s;
    }
    .uri-action-btn:hover {
      border-color: rgba(255,69,0,0.4);
      color: #ff6b35;
      background: rgba(255,69,0,0.06);
    }

    /* ── Empty state ── */
    .uri-empty {
      text-align: center;
      padding: 18px 10px;
      color: #3a3a44;
      font-size: 11px;
      font-family: 'Space Mono', monospace;
    }

    /* ── Loading state ── */
    #uri-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 14px;
      color: #6b6b78;
      font-family: 'Space Mono', monospace;
      font-size: 11px;
    }
    .uri-spinner {
      width: 28px; height: 28px;
      border: 2px solid #2a2a30;
      border-top-color: #ff4500;
      border-radius: 50%;
      animation: uri-spin 0.8s linear infinite;
    }
    @keyframes uri-spin { to { transform: rotate(360deg); } }

    /* ── Toggle button (floating) ── */
    #ureddit-insights-toggle {
      position: fixed;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      z-index: 999998;
      background: linear-gradient(135deg, #ff4500, #ff6b35);
      color: #fff;
      border: none;
      border-radius: 10px 0 0 10px;
      padding: 12px 8px;
      cursor: pointer;
      font-size: 18px;
      box-shadow: -3px 0 20px rgba(255,69,0,0.4);
      writing-mode: vertical-rl;
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 10px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      transition: opacity 0.2s, transform 0.2s;
      line-height: 1;
    }
    #ureddit-insights-toggle:hover {
      opacity: 0.9;
      transform: translateY(-50%) translateX(-2px);
    }
    #ureddit-insights-toggle.hidden-btn {
      display: none;
    }

    /* Highlight pulse on original comment */
    .ureddit-highlight {
      outline: 2px solid #ff4500 !important;
      outline-offset: 4px;
      border-radius: 4px;
      animation: uri-highlight-fade 2.5s ease forwards;
    }
    @keyframes uri-highlight-fade {
      0%   { outline-color: #ff4500; background: rgba(255,69,0,0.08); }
      100% { outline-color: transparent; background: transparent; }
    }

    /* Push Reddit content when sidebar is open */
    body.ureddit-sidebar-open {
      margin-right: 340px !important;
      transition: margin-right 0.35s cubic-bezier(0.4,0,0.2,1);
    }
  `;

  document.head.appendChild(style);
}

function buildSidebarHTML() {
  return `
    <div id="uri-header">
      <div id="uri-logo">U</div>
      <div>
        <div id="uri-title">Ureddit Insights</div>
        <div id="uri-subtitle">Rule-based thread analysis</div>
      </div>
      <button id="uri-close" title="Close panel">✕</button>
    </div>

    <div id="uri-summary">
      <div class="uri-sum-item">
        <div class="uri-sum-count" id="uri-count-problems" style="color:#ef4444">0</div>
        <div class="uri-sum-lbl">Problems</div>
      </div>
      <div class="uri-sum-item">
        <div class="uri-sum-count" id="uri-count-demands" style="color:#f59e0b">0</div>
        <div class="uri-sum-lbl">Demands</div>
      </div>
      <div class="uri-sum-item">
        <div class="uri-sum-count" id="uri-count-ideas" style="color:#22c55e">0</div>
        <div class="uri-sum-lbl">Ideas</div>
      </div>
    </div>

    <div id="uri-body">
      <div id="uri-loading">
        <div class="uri-spinner"></div>
        <span>Analysing comments…</span>
      </div>
    </div>
  `;
}

function renderInsights(insights) {
  const body = document.getElementById('uri-body');
  if (!body) return;

  // Update summary counts
  document.getElementById('uri-count-problems').textContent = insights.problems.length;
  document.getElementById('uri-count-demands').textContent  = insights.demands.length;
  document.getElementById('uri-count-ideas').textContent    = insights.ideas.length;

  const sections = [
    { key: 'problems', title: 'Top Problems',     icon: '🔴', items: insights.problems },
    { key: 'demands',  title: 'Most Requested',   icon: '❓', items: insights.demands  },
    { key: 'ideas',    title: 'Best Ideas',        icon: '💡', items: insights.ideas    },
  ];

  body.innerHTML = sections.map(sec => `
    <div class="uri-section" data-section="${sec.key}">
      <div class="uri-section-header">
        <span class="uri-section-icon">${sec.icon}</span>
        <span class="uri-section-title">${sec.title}</span>
        <span class="uri-section-count">${sec.items.length}</span>
      </div>
      ${sec.items.length === 0
        ? `<div class="uri-empty">No ${sec.key} detected</div>`
        : sec.items.map(item => buildCardHTML(item)).join('')
      }
    </div>
  `).join('');

  // Attach click handlers after render
  body.querySelectorAll('.uri-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Don't scroll if clicking action buttons
      if (e.target.closest('.uri-action-btn')) return;
      scrollToComment(card.dataset.text);
    });
  });

  body.querySelectorAll('.uri-btn-save').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveInsight(btn.dataset.text, btn.dataset.category);
      btn.textContent = '✓ Saved';
      btn.style.color = '#22c55e';
      btn.style.borderColor = 'rgba(34,197,94,0.4)';
    });
  });

  body.querySelectorAll('.uri-btn-copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.text).then(() => {
        btn.textContent = '✓ Copied';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      });
    });
  });
}

function buildCardHTML(item) {
  const safeText = escapeHtml(item.text);
  const author   = item.author  ? `<span class="uri-card-author">u/${escapeHtml(item.author)}</span>` : '';
  const upvotes  = item.upvotes ? `<span class="uri-card-upvotes">▲ ${escapeHtml(String(item.upvotes))}</span>` : '';

  return `
    <div class="uri-card" data-text="${safeText}" data-ref="${item.refId}">
      <div class="uri-card-text">${safeText}</div>
      <div class="uri-card-meta">
        ${author}
        ${upvotes}
        <span class="uri-card-score">score: ${item.score}</span>
      </div>
      <div class="uri-card-actions">
        <button class="uri-action-btn uri-btn-save"
          data-text="${safeText}"
          data-category="${item.category || ''}">Save</button>
        <button class="uri-action-btn uri-btn-copy"
          data-text="${safeText}">Copy</button>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. SCROLL-TO-COMMENT
// ─────────────────────────────────────────────────────────────────────────────
function scrollToComment(text) {
  if (!text) return;

  // Search visible comment text nodes
  const needle = text.slice(0, 60).toLowerCase().trim();

  const candidates = [
    ...document.querySelectorAll('shreddit-comment p'),
    ...document.querySelectorAll('[data-testid="comment"] p'),
    ...document.querySelectorAll('.Comment p'),
    ...document.querySelectorAll('.usertext-body .md p'),
  ];

  for (const el of candidates) {
    if ((el.textContent || '').toLowerCase().includes(needle)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ureddit-highlight');
      setTimeout(() => el.classList.remove('ureddit-highlight'), 2600);
      return;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. LOCAL STORAGE — SAVE INSIGHTS
// ─────────────────────────────────────────────────────────────────────────────
function saveInsight(text, category) {
  try {
    const raw     = localStorage.getItem(SAVED_KEY) || '[]';
    const saved   = JSON.parse(raw);
    const entry   = { text, category, url: window.location.href, savedAt: new Date().toISOString() };
    saved.unshift(entry);
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved.slice(0, 100))); // cap at 100
  } catch (_) {
    // localStorage not available
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. SIDEBAR LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
function createSidebar() {
  if (document.getElementById(SIDEBAR_ID)) return;

  injectSidebarStyles();

  const panel = document.createElement('div');
  panel.id = SIDEBAR_ID;
  panel.innerHTML = buildSidebarHTML();
  document.body.appendChild(panel);

  // Close button
  panel.querySelector('#uri-close').addEventListener('click', closeSidebar);

  // Floating toggle button
  const toggle = document.createElement('button');
  toggle.id = 'ureddit-insights-toggle';
  toggle.textContent = '✦ Insights';
  toggle.title = 'Open Ureddit Insights';
  toggle.addEventListener('click', openSidebar);
  document.body.appendChild(toggle);
}

function openSidebar() {
  const panel  = document.getElementById(SIDEBAR_ID);
  const toggle = document.getElementById('ureddit-insights-toggle');
  if (!panel) return;
  panel.classList.add('open');
  document.body.classList.add('ureddit-sidebar-open');
  if (toggle) toggle.classList.add('hidden-btn');
}

function closeSidebar() {
  const panel  = document.getElementById(SIDEBAR_ID);
  const toggle = document.getElementById('ureddit-insights-toggle');
  if (!panel) return;
  panel.classList.remove('open');
  document.body.classList.remove('ureddit-sidebar-open');
  if (toggle) toggle.classList.remove('hidden-btn');
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. PUBLIC API — called from content.js
// ─────────────────────────────────────────────────────────────────────────────
window.UredditInsights = {
  /**
   * Main entry point.
   * Call this after comments are scraped:
   *   window.UredditInsights.run(comments)
   */
  run(comments) {
    createSidebar();
    openSidebar();

    // Defer heavy work off the main paint
    setTimeout(() => {
      const insights = processComments(comments);
      renderInsights(insights);
    }, 80);
  },

  /**
   * Expose for popup.js or future use.
   * Returns raw categorised data without rendering.
   */
  analyze(comments) {
    return processComments(comments);
  },

  open:  openSidebar,
  close: closeSidebar,
};
