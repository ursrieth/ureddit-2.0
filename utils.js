// utils.js — RedditLens Data Utilities

'use strict';

/**
 * Flatten a nested comment tree into a flat array
 * with depth indicators for CSV/analysis use.
 * @param {Array} comments
 * @param {number} depth
 * @returns {Array}
 */
function flattenComments(comments, depth = 0) {
  const result = [];
  for (const c of comments) {
    result.push({ ...c, depth, replies: undefined });
    if (c.replies && c.replies.length) {
      result.push(...flattenComments(c.replies, depth + 1));
    }
  }
  return result;
}

/**
 * Count total nodes in comment tree
 */
function countNodes(comments) {
  let total = 0;
  for (const c of comments) {
    total++;
    if (c.replies && c.replies.length) total += countNodes(c.replies);
  }
  return total;
}

/**
 * Extract all unique pain-point indicators from comment text
 * Simple keyword-based classifier for MVP
 */
function classifyComment(text) {
  const lower = text.toLowerCase();

  const painKeywords    = ['hate', 'frustrating', 'annoying', 'broken', 'terrible', "can't", 'issue', 'problem', 'bug', 'doesn\'t work', 'fail', 'awful', 'horrible', 'useless'];
  const requestKeywords = ['wish', 'want', 'need', 'should', 'would be nice', 'hope', 'please add', 'feature request', 'suggestion'];
  const praiseKeywords  = ['love', 'great', 'amazing', 'excellent', 'best', 'perfect', 'awesome', 'fantastic', 'wonderful'];

  const flags = [];
  if (painKeywords.some(k => lower.includes(k)))    flags.push('pain_point');
  if (requestKeywords.some(k => lower.includes(k))) flags.push('feature_request');
  if (praiseKeywords.some(k => lower.includes(k)))  flags.push('positive');

  return flags;
}

/**
 * Strip UI noise phrases commonly found in scraped Reddit text
 */
function sanitizeText(text) {
  const noise = [
    /Share\s*/gi,
    /Save\s*/gi,
    /Reply\s*/gi,
    /Report\s*/gi,
    /More replies\s*/gi,
    /Continue this thread\s*/gi,
    /level \d+\s*/gi,
    /· \d+ (mo|yr|hr|min|day)s? ago\s*/gi,
  ];

  let clean = text;
  for (const pattern of noise) {
    clean = clean.replace(pattern, '');
  }
  return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Format a timestamp string nicely
 */
function formatDate(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleString();
  } catch (_) {
    return isoString;
  }
}

// Export for use in other scripts if needed via importScripts or module pattern
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { flattenComments, countNodes, classifyComment, sanitizeText, formatDate };
}
