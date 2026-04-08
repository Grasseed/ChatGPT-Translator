// utils/cache.js
// 翻譯快取管理 — 使用 chrome.storage.local

const Cache = {
  _hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash.toString(36);
  },

  makeKey(url, text, targetLang, model) {
    const textHash = this._hashText(text);
    const urlHash = this._hashText(url);
    return `${urlHash}_${textHash}_${targetLang}_${model}`;
  },

  async get(url, text, targetLang, model) {
    const key = this.makeKey(url, text, targetLang, model);
    return Storage.getTranslationCache(key);
  },

  async set(url, text, targetLang, model, translation) {
    const key = this.makeKey(url, text, targetLang, model);
    await Storage.setTranslationCache(key, translation);
  },

  async clear() {
    await Storage.clearTranslationCache();
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.Cache = Cache;
}
