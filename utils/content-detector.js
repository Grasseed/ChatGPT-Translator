// utils/content-detector.js
// 智慧偵測頁面正文段落，排除導航、頁尾、程式碼等非正文

const ContentDetector = {
  TRANSLATABLE_TAGS: ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION', 'DT', 'DD'],
  SKIP_TAGS: ['NAV', 'HEADER', 'FOOTER', 'ASIDE', 'SCRIPT', 'STYLE', 'CODE', 'PRE', 'SVG', 'NOSCRIPT', 'IFRAME', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'],
  MIN_TEXT_LENGTH: 5,

  _isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  },

  _isInSkipParent(el) {
    let parent = el.parentElement;
    while (parent) {
      if (this.SKIP_TAGS.includes(parent.tagName)) return true;
      if (parent.getAttribute('aria-hidden') === 'true') return true;
      if (parent.id === 'chatgpt-translator-root') return true;
      parent = parent.parentElement;
    }
    return false;
  },

  _getTextContent(el) {
    return (el.textContent || '').trim();
  },

  _isTranslatableText(text) {
    if (text.length < this.MIN_TEXT_LENGTH) return false;
    // 排除純數字/符號
    if (/^[\d\s\W]+$/.test(text)) return false;
    return true;
  },

  getContentRoot() {
    const selectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '.article-content'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.body;
  },

  getTranslatableElements() {
    const root = this.getContentRoot();
    const selector = this.TRANSLATABLE_TAGS.map(t => t.toLowerCase()).join(', ');
    const candidates = root.querySelectorAll(selector);
    const results = [];

    for (const el of candidates) {
      if (!this._isVisible(el)) continue;
      if (this._isInSkipParent(el)) continue;
      const text = this._getTextContent(el);
      if (!this._isTranslatableText(text)) continue;
      // 排除已翻譯的元素
      if (el.dataset.translatorProcessed) continue;
      results.push(el);
    }

    return results;
  },

  // 按視窗可見度排序 — 可見區域的元素優先
  sortByVisibility(elements) {
    const viewportTop = window.scrollY;
    const viewportBottom = viewportTop + window.innerHeight;

    return [...elements].sort((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      const aTop = aRect.top + window.scrollY;
      const bTop = bRect.top + window.scrollY;

      const aVisible = aTop >= viewportTop && aTop <= viewportBottom;
      const bVisible = bTop >= viewportTop && bTop <= viewportBottom;

      if (aVisible && !bVisible) return -1;
      if (!aVisible && bVisible) return 1;
      return aTop - bTop;
    });
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.ContentDetector = ContentDetector;
}
