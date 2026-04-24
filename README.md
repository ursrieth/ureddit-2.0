# 🔬 Ureddit — Market Intelligence Scraper

A Chrome Extension (Manifest V3) that transforms Reddit threads into structured JSON/CSV datasets **and** a live sidebar of classified insights — all rule-based, no AI required.

---

## ✨ Features

| Feature | Status |
|---|---|
| Scrape post title, body, author, upvotes | ✅ v1.0 |
| Extract top-level comments | ✅ v1.0 |
| Nested replies (full tree) | ✅ v1.0 |
| JSON export (auto-download) | ✅ v1.0 |
| CSV export | ✅ v1.0 |
| Comment limit control (20/50/100/All) | ✅ v1.0 |
| New Reddit layout support | ✅ v1.0 |
| Old Reddit layout support | ✅ v1.0 |
| **🔴 Problem / 💡 Idea / ❓ Demand classifier** | ✅ v1.1 |
| **Insight sidebar (auto-injects on scrape)** | ✅ v1.1 |
| **Score-ranked insights (keyword + upvote)** | ✅ v1.1 |
| **Deduplication of near-duplicate insights** | ✅ v1.1 |
| **Click-to-scroll to original comment** | ✅ v1.1 |
| **Save insight to localStorage** | ✅ v1.1 |
| **Copy insight to clipboard** | ✅ v1.1 |
| AI-powered classification | 🗺️ Roadmap |
| Dashboard UI | 🗺️ Roadmap |
| Google Sheets integration | 🗺️ Roadmap |

---

## 🏗️ Architecture & Team File Ownership

```
ureddit-extension/
├── manifest.json     ← Extension config — update load order here
├── popup.html        ← Extension popup UI
├── popup.js          ← UI events, download logic, scrape trigger
├── content.js        ← DOM scraping (new + old Reddit layouts)
├── insights.js       ← ★ Insight Layer: classifier, sidebar, scoring
├── utils.js          ← Shared helpers: flatten, sanitize, format
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### Who Owns What (Team of 3)

| Dev | Files | Focus |
|-----|-------|-------|
| **Dev A** | `content.js` | DOM scraping, Reddit layout support, selector updates |
| **Dev B** | `insights.js` | Classification rules, scoring, sidebar UI/UX |
| **Dev C** | `popup.js`, `popup.html`, `utils.js` | Popup controls, export formats, shared utilities |

> **Rule:** Never touch a file that isn't yours without a PR comment.
> The only shared coordination point is the `window.UredditInsights.run(comments)` API call in `content.js`.

---

## 🧠 How the Insight Layer Works

When you click **Scrape This Thread**:

1. `content.js` scrapes comments → builds `comments[]` array
2. Calls `window.UredditInsights.run(comments)` (defined in `insights.js`)
3. `insights.js` walks the comment tree (including replies)
4. Each comment is checked against keyword rules → tagged 🔴 / 💡 / ❓
5. Matched comments are scored, sorted, deduplicated
6. Sidebar slides in with the top insights, ready to read

### Classification Flow

```
comment.text
    │
    ▼
classifyText(text)          ← checks RULES object in insights.js
    │
    ▼
{ category, matchedKeywords }
    │
    ▼
scoreComment(comment, matches)   ← +2/keyword, +1/multi-match, +1/upvotes
    │
    ▼
sort by score → slice top 10 → deduplicateInsights()
    │
    ▼
renderInsights() → sidebar cards
```

### Scoring Weights (in `insights.js` → `SCORE_WEIGHTS`)

```js
singleKeywordMatch: 2   // per matching keyword
multipleKeywords:   1   // bonus if >1 keyword hit
hasUpvotes:         1   // bonus if comment has positive upvote count
```

---

## ✏️ Adding / Editing Classification Keywords

Open `insights.js` and find the `RULES` object near the top:

```js
const RULES = {
  problem: {
    keywords: [
      'i hate',
      'not working',
      // ← add your keyword here, lowercase
    ],
  },
  idea: { ... },
  demand: { ... },
};
```

That's it. No other file needs to change.

---

## 🚀 Installation (Developer Mode)

### Step 1 — Add placeholder icons
Create `icons/` folder with PNG images:
- `icons/icon16.png` (16×16)
- `icons/icon48.png` (48×48)
- `icons/icon128.png` (128×128)

> Quick option: generate at https://favicon.io

### Step 2 — Load in Chrome
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `ureddit-extension/` folder
5. Extension icon appears in toolbar ✅

### Step 3 — Use it
1. Open any Reddit post thread
2. Click the **Ureddit** icon in the toolbar
3. Set options (limit, replies, format)
4. Click **⚡ Scrape This Thread**
5. Sidebar slides in with classified insights
6. File downloads to `Downloads/`

---

## 📦 Output Format

### JSON
```json
{
  "title": "What's the biggest problem with SaaS onboarding?",
  "subreddit": "SaaS",
  "url": "https://www.reddit.com/r/SaaS/comments/...",
  "scraped_at": "2025-01-15T10:30:00.000Z",
  "comments": [
    {
      "text": "The biggest issue is...",
      "author": "user123",
      "upvotes": "342",
      "timestamp": "2025-01-14T08:00:00Z",
      "replies": []
    }
  ]
}
```

### CSV
Flat format: `type, depth, text, author, upvotes, timestamp`

---

## 🔌 Sidebar API (for devs)

`insights.js` exposes `window.UredditInsights`:

```js
// Run full pipeline + open sidebar
window.UredditInsights.run(comments)

// Analyse only, no UI (returns { problems, ideas, demands })
const results = window.UredditInsights.analyze(comments)

// Manual open/close
window.UredditInsights.open()
window.UredditInsights.close()
```

---

## ⚙️ Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Read the current Reddit tab |
| `scripting` | Inject content scripts on demand |
| `downloads` | Trigger file download |
| `host_permissions: reddit.com` | Limit scraping to Reddit only |

---

## 🗺️ Roadmap (v2+)

- [ ] AI classification layer (optional upgrade to rule engine)
- [ ] Keyword clustering across multiple posts
- [ ] Dashboard UI inside extension
- [ ] Clipboard copy (JSON/CSV)
- [ ] Google Sheets export
- [ ] Niche discovery mode (multi-post scraping)
- [ ] Sentiment trend tracking
- [ ] Export saved insights from localStorage

---

## ⚠️ Notes

- Operates entirely client-side — no data leaves your browser
- Reddit's DOM changes occasionally; update selectors in `content.js` if scraping breaks
- Only extracts currently visible comments — scroll to load more before scraping
- Saved insights persist in `localStorage` under key `ureddit_saved_insights`

---

## 📄 License

MIT — Free for personal and commercial use.
