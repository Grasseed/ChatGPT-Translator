// utils/storage.js
// chrome.storage 封裝，提供統一的設定讀寫介面

const DEFAULT_SETTINGS = {
  providers: [],
  activeProviderId: null,
  activeModelId: null,
  targetLanguage: 'zh-TW',
  translationMode: 'bilingual', // 'bilingual' | 'replace'
  showFloatingBall: true,
  enableSelectionTranslate: true,
  enableStreaming: true,
  enableSmartDetection: true,
  enableCache: true,
  floatingBallPosition: { bottom: 24, right: 24 }
};

const Storage = {
  async getSettings() {
    const result = await chrome.storage.sync.get('settings');
    return { ...DEFAULT_SETTINGS, ...result.settings };
  },

  async saveSettings(settings) {
    await chrome.storage.sync.set({ settings });
  },

  async updateSettings(partial) {
    const current = await this.getSettings();
    const updated = { ...current, ...partial };
    await this.saveSettings(updated);
    return updated;
  },

  async getModelCache(providerId) {
    const result = await chrome.storage.local.get(`models_${providerId}`);
    return result[`models_${providerId}`] || { models: [], lastFetched: 0 };
  },

  async setModelCache(providerId, models) {
    await chrome.storage.local.set({
      [`models_${providerId}`]: { models, lastFetched: Date.now() }
    });
  },

  async getTranslationCache(key) {
    const result = await chrome.storage.local.get(`cache_${key}`);
    return result[`cache_${key}`] || null;
  },

  async setTranslationCache(key, translation) {
    await chrome.storage.local.set({ [`cache_${key}`]: translation });
  },

  async clearTranslationCache() {
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter(k => k.startsWith('cache_'));
    if (cacheKeys.length > 0) {
      await chrome.storage.local.remove(cacheKeys);
    }
  },

  onChanged(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.settings) {
        callback(changes.settings.newValue);
      }
    });
  }
};

// 根據使用環境匯出
if (typeof globalThis !== 'undefined') {
  globalThis.Storage = Storage;
  globalThis.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
}
