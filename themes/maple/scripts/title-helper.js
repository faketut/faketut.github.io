// Render inline markdown inside post titles.
// Supports:  `code`,  **bold**,  *italic*
// Everything else is HTML-escaped so titles can never break the page.

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function renderInline(title) {
  if (title == null) return '';
  let out = escapeHtml(title);
  // `code`
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
  // *italic*  (avoid matching ** that already became <strong>)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_, pre, c) => `${pre}<em>${c}</em>`);
  return out;
}

function plainTitle(title) {
  // Strip the markdown punctuation for use in <title>, og:title, RSS, etc.
  if (title == null) return '';
  return String(title)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2');
}

hexo.extend.helper.register('inline_title', renderInline);
hexo.extend.helper.register('plain_title', plainTitle);
