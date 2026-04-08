# ChatGPT Translator v2.0 沉浸式翻譯重設計 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 ChatGPT Translator 從 popup 翻譯工具重構為沉浸式網頁翻譯擴展，支援懸浮球、劃詞翻譯、雙語對照/直接替換，以及多供應商動態模型。

**Architecture:** Content Script 注入 Shadow DOM UI 元件到每個頁面，Background Service Worker 集中處理 API 呼叫和串流轉發，Options 頁面管理供應商/模型/偏好設定。所有 API 呼叫使用 OpenAI 相容格式。

**Tech Stack:** Chrome Extension Manifest V3, vanilla JavaScript (no build tools), Shadow DOM, SSE streaming, chrome.storage API

**Spec:** `docs/superpowers/specs/2026-04-08-immersive-translator-redesign.md`

---

## File Structure

```
ChatGPT-Translator/
├── manifest.json              # [修改] 升級為 v2.0，新增 content_scripts、commands、options_page
├── background.js              # [新建] Service Worker — API 呼叫、串流、模型列表
├── content.js                 # [新建] Content Script — Shadow DOM UI、懸浮球、劃詞、整頁翻譯
├── content.css                # [新建] Shadow DOM 內部樣式 — Vercel 設計系統
├── options.html               # [新建] 設定頁面 HTML
├── options.js                 # [新建] 設定頁面邏輯
├── options.css                # [新建] 設定頁面樣式 — Vercel 設計系統
├── language-data.js           # [修改] 擴展為完整 i18n 語言列表 (100+)
├── utils/
│   ├── api-client.js          # [新建] OpenAI 相容 API 呼叫封裝
│   ├── content-detector.js    # [新建] 智慧頁面內容偵測
│   ├── cache.js               # [新建] 翻譯快取管理
│   └── storage.js             # [新建] chrome.storage 封裝
├── components/
│   ├── dropdown.js            # [新建] 自訂下拉選單元件
│   └── toast.js               # [新建] Toast 通知元件 (toggle 開關直接在 options.css 實作)
├── popup.html                 # [刪除] 不再使用 popup
├── popup.js                   # [刪除] 不再使用 popup
├── translation.png            # [保留] 擴展圖示
├── DESIGN.md                  # [保留] 設計系統規範
└── README.md                  # [保留]
```

---

## Task 1: 基礎設施 — manifest.json + storage 封裝 + 語言資料

**Files:**
- Modify: `manifest.json`
- Create: `utils/storage.js`
- Modify: `language-data.js`

- [ ] **Step 1: 更新 manifest.json**

```json
{
  "name": "ChatGPT Translator",
  "version": "2.0",
  "description": "沉浸式 AI 翻譯 — 支援 OpenAI、Ollama、LM Studio 等",
  "manifest_version": 3,
  "icons": {
    "16": "translation.png",
    "48": "translation.png",
    "128": "translation.png"
  },
  "permissions": ["storage", "activeTab"],
  "host_permissions": [
    "http://localhost:*/*",
    "https://*/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": [
        "language-data.js",
        "utils/storage.js",
        "utils/cache.js",
        "utils/content-detector.js",
        "content.js"
      ]
    }
  ],
  "options_page": "options.html",
  "action": {
    "default_icon": "translation.png",
    "default_title": "ChatGPT Translator"
  },
  "commands": {
    "translate-page": {
      "suggested_key": { "default": "Alt+T" },
      "description": "翻譯整頁"
    },
    "translate-selection": {
      "suggested_key": { "default": "Alt+Q" },
      "description": "翻譯選取文字"
    }
  },
  "web_accessible_resources": [
    {
      "resources": ["content.css"],
      "matches": ["<all_urls>"]
    }
  ]
}
```

- [ ] **Step 2: 建立 utils/storage.js — chrome.storage 封裝**

```javascript
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
```

- [ ] **Step 3: 擴展 language-data.js 為完整 i18n 語言列表**

將現有 32 個語言擴展為 100+ 個完整 IETF 語言列表。常用語言 `isFavorite: true` 置頂。移除重複的 Hindi 條目。

```javascript
// language-data.js
// 完整 i18n 語言列表，支援搜尋篩選

const languageData = [
  // === 常用語言 (置頂) ===
  { code: 'zh-TW', name: '繁體中文', localName: 'Traditional Chinese', isFavorite: true },
  { code: 'zh-CN', name: '简体中文', localName: 'Simplified Chinese', isFavorite: true },
  { code: 'en', name: 'English', localName: 'English', isFavorite: true },
  { code: 'ja', name: '日本語', localName: 'Japanese', isFavorite: true },
  { code: 'ko', name: '한국어', localName: 'Korean', isFavorite: true },
  // === 完整列表 (字母排序) ===
  { code: 'af', name: 'Afrikaans', localName: 'Afrikaans' },
  { code: 'sq', name: 'Shqip', localName: 'Albanian' },
  { code: 'am', name: 'አማርኛ', localName: 'Amharic' },
  { code: 'ar', name: 'العربية', localName: 'Arabic' },
  { code: 'hy', name: 'Հայերեն', localName: 'Armenian' },
  { code: 'az', name: 'Azərbaycan', localName: 'Azerbaijani' },
  { code: 'eu', name: 'Euskara', localName: 'Basque' },
  { code: 'be', name: 'Беларуская', localName: 'Belarusian' },
  { code: 'bn', name: 'বাংলা', localName: 'Bengali' },
  { code: 'bs', name: 'Bosanski', localName: 'Bosnian' },
  { code: 'bg', name: 'Български', localName: 'Bulgarian' },
  { code: 'my', name: 'မြန်မာ', localName: 'Burmese' },
  { code: 'ca', name: 'Català', localName: 'Catalan' },
  { code: 'ceb', name: 'Cebuano', localName: 'Cebuano' },
  { code: 'hr', name: 'Hrvatski', localName: 'Croatian' },
  { code: 'cs', name: 'Čeština', localName: 'Czech' },
  { code: 'da', name: 'Dansk', localName: 'Danish' },
  { code: 'nl', name: 'Nederlands', localName: 'Dutch' },
  { code: 'et', name: 'Eesti', localName: 'Estonian' },
  { code: 'fi', name: 'Suomi', localName: 'Finnish' },
  { code: 'fr', name: 'Français', localName: 'French' },
  { code: 'gl', name: 'Galego', localName: 'Galician' },
  { code: 'ka', name: 'ქართული', localName: 'Georgian' },
  { code: 'de', name: 'Deutsch', localName: 'German' },
  { code: 'el', name: 'Ελληνικά', localName: 'Greek' },
  { code: 'gu', name: 'ગુજરાતી', localName: 'Gujarati' },
  { code: 'ht', name: 'Kreyòl Ayisyen', localName: 'Haitian Creole' },
  { code: 'ha', name: 'Hausa', localName: 'Hausa' },
  { code: 'he', name: 'עברית', localName: 'Hebrew' },
  { code: 'hi', name: 'हिन्दी', localName: 'Hindi' },
  { code: 'hu', name: 'Magyar', localName: 'Hungarian' },
  { code: 'is', name: 'Íslenska', localName: 'Icelandic' },
  { code: 'ig', name: 'Igbo', localName: 'Igbo' },
  { code: 'id', name: 'Bahasa Indonesia', localName: 'Indonesian' },
  { code: 'ga', name: 'Gaeilge', localName: 'Irish' },
  { code: 'it', name: 'Italiano', localName: 'Italian' },
  { code: 'jv', name: 'Basa Jawa', localName: 'Javanese' },
  { code: 'kn', name: 'ಕನ್ನಡ', localName: 'Kannada' },
  { code: 'kk', name: 'Қазақ', localName: 'Kazakh' },
  { code: 'km', name: 'ខ្មែរ', localName: 'Khmer' },
  { code: 'rw', name: 'Kinyarwanda', localName: 'Kinyarwanda' },
  { code: 'ku', name: 'Kurdî', localName: 'Kurdish' },
  { code: 'ky', name: 'Кыргызча', localName: 'Kyrgyz' },
  { code: 'lo', name: 'ລາວ', localName: 'Lao' },
  { code: 'la', name: 'Latina', localName: 'Latin' },
  { code: 'lv', name: 'Latviešu', localName: 'Latvian' },
  { code: 'lt', name: 'Lietuvių', localName: 'Lithuanian' },
  { code: 'lb', name: 'Lëtzebuergesch', localName: 'Luxembourgish' },
  { code: 'mk', name: 'Македонски', localName: 'Macedonian' },
  { code: 'mg', name: 'Malagasy', localName: 'Malagasy' },
  { code: 'ms', name: 'Bahasa Melayu', localName: 'Malay' },
  { code: 'ml', name: 'മലയാളം', localName: 'Malayalam' },
  { code: 'mt', name: 'Malti', localName: 'Maltese' },
  { code: 'mi', name: 'Māori', localName: 'Maori' },
  { code: 'mr', name: 'मराठी', localName: 'Marathi' },
  { code: 'mn', name: 'Монгол', localName: 'Mongolian' },
  { code: 'ne', name: 'नेपाली', localName: 'Nepali' },
  { code: 'no', name: 'Norsk', localName: 'Norwegian' },
  { code: 'ny', name: 'Chichewa', localName: 'Nyanja' },
  { code: 'or', name: 'ଓଡ଼ିଆ', localName: 'Odia' },
  { code: 'ps', name: 'پښتو', localName: 'Pashto' },
  { code: 'fa', name: 'فارسی', localName: 'Persian' },
  { code: 'pl', name: 'Polski', localName: 'Polish' },
  { code: 'pt', name: 'Português', localName: 'Portuguese' },
  { code: 'pt-BR', name: 'Português (Brasil)', localName: 'Portuguese (Brazil)' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ', localName: 'Punjabi' },
  { code: 'ro', name: 'Română', localName: 'Romanian' },
  { code: 'ru', name: 'Русский', localName: 'Russian' },
  { code: 'sm', name: 'Gagana Sāmoa', localName: 'Samoan' },
  { code: 'gd', name: 'Gàidhlig', localName: 'Scottish Gaelic' },
  { code: 'sr', name: 'Српски', localName: 'Serbian' },
  { code: 'sn', name: 'Shona', localName: 'Shona' },
  { code: 'sd', name: 'سنڌي', localName: 'Sindhi' },
  { code: 'si', name: 'සිංහල', localName: 'Sinhala' },
  { code: 'sk', name: 'Slovenčina', localName: 'Slovak' },
  { code: 'sl', name: 'Slovenščina', localName: 'Slovenian' },
  { code: 'so', name: 'Soomaali', localName: 'Somali' },
  { code: 'es', name: 'Español', localName: 'Spanish' },
  { code: 'su', name: 'Basa Sunda', localName: 'Sundanese' },
  { code: 'sw', name: 'Kiswahili', localName: 'Swahili' },
  { code: 'sv', name: 'Svenska', localName: 'Swedish' },
  { code: 'tl', name: 'Tagalog', localName: 'Tagalog' },
  { code: 'tg', name: 'Тоҷикӣ', localName: 'Tajik' },
  { code: 'ta', name: 'தமிழ்', localName: 'Tamil' },
  { code: 'tt', name: 'Татар', localName: 'Tatar' },
  { code: 'te', name: 'తెలుగు', localName: 'Telugu' },
  { code: 'th', name: 'ไทย', localName: 'Thai' },
  { code: 'tr', name: 'Türkçe', localName: 'Turkish' },
  { code: 'tk', name: 'Türkmen', localName: 'Turkmen' },
  { code: 'uk', name: 'Українська', localName: 'Ukrainian' },
  { code: 'ur', name: 'اردو', localName: 'Urdu' },
  { code: 'ug', name: 'ئۇيغۇرچە', localName: 'Uyghur' },
  { code: 'uz', name: 'Oʻzbek', localName: 'Uzbek' },
  { code: 'vi', name: 'Tiếng Việt', localName: 'Vietnamese' },
  { code: 'cy', name: 'Cymraeg', localName: 'Welsh' },
  { code: 'xh', name: 'isiXhosa', localName: 'Xhosa' },
  { code: 'yi', name: 'ייִדיש', localName: 'Yiddish' },
  { code: 'yo', name: 'Yorùbá', localName: 'Yoruba' },
  { code: 'zu', name: 'isiZulu', localName: 'Zulu' },
];

if (typeof globalThis !== 'undefined') {
  globalThis.languageData = languageData;
}
```

- [ ] **Step 4: 刪除舊的 popup 檔案**

```bash
rm popup.html popup.js
```

- [ ] **Step 5: 建立目錄結構**

```bash
mkdir -p utils components
```

- [ ] **Step 6: 在瀏覽器載入擴展驗證 manifest 無錯誤**

Run: 到 `chrome://extensions/` 開啟開發者模式 → 載入未封裝項目 → 指向專案目錄
Expected: 擴展正常載入。注意：此時 content.js 尚未建立，content_scripts 會報錯，這是預期行為，將在 Task 5 解決。可暫時在 manifest 中將 content_scripts 註解掉或建立空的 content.js 佔位。

- [ ] **Step 7: Commit**

```bash
git add manifest.json utils/storage.js language-data.js
git rm popup.html popup.js
git commit -m "重構基礎設施：升級 manifest v2.0、新增 storage 封裝、擴展語言列表"
```

---

## Task 2: API Client — OpenAI 相容 API 呼叫 + 串流

**Files:**
- Create: `utils/api-client.js`

- [ ] **Step 1: 建立 utils/api-client.js**

```javascript
// utils/api-client.js
// OpenAI 相容 API 呼叫封裝，支援串流 SSE

const ApiClient = {
  async fetchModels(baseUrl, apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl}/models`, { headers });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return (data.data || []).map(m => m.id).sort();
  },

  async translate(baseUrl, apiKey, model, text, targetLanguage, onToken) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const body = {
      model,
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the following text to ${targetLanguage}. Only output the translation, no explanations or notes.`
        },
        { role: 'user', content: text }
      ],
      temperature: 0.3,
      stream: !!onToken
    };

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    // Non-streaming
    if (!onToken) {
      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || '';
    }

    // Streaming SSE
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === '[DONE]') return fullText;

        try {
          const parsed = JSON.parse(jsonStr);
          const token = parsed.choices?.[0]?.delta?.content || '';
          if (token) {
            fullText += token;
            onToken(token, fullText);
          }
        } catch (e) {
          // 忽略解析錯誤，繼續處理
        }
      }
    }

    return fullText;
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.ApiClient = ApiClient;
}
```

- [ ] **Step 2: Commit**

```bash
git add utils/api-client.js
git commit -m "新增 API client：OpenAI 相容格式、SSE 串流支援"
```

---

## Task 3: 翻譯快取 + 智慧內容偵測

**Files:**
- Create: `utils/cache.js`
- Create: `utils/content-detector.js`

- [ ] **Step 1: 建立 utils/cache.js**

```javascript
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
```

- [ ] **Step 2: 建立 utils/content-detector.js**

```javascript
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
```

- [ ] **Step 3: Commit**

```bash
git add utils/cache.js utils/content-detector.js
git commit -m "新增翻譯快取管理與智慧內容偵測"
```

---

## Task 4: Background Service Worker

**Files:**
- Create: `background.js`

- [ ] **Step 1: 建立 background.js**

```javascript
// background.js
// Service Worker — 集中處理 API 呼叫、串流轉發、快捷鍵監聽

importScripts('utils/storage.js', 'utils/api-client.js', 'utils/cache.js', 'language-data.js');

// === 訊息處理 ===
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetchModels') {
    handleFetchModels(msg).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true; // 非同步回應
  }

  if (msg.type === 'translate') {
    handleTranslate(msg, sender).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'testConnection') {
    handleTestConnection(msg).then(sendResponse).catch(e => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'getSettings') {
    Storage.getSettings().then(sendResponse);
    return true;
  }

  if (msg.type === 'updateSettings') {
    Storage.updateSettings(msg.settings).then(sendResponse);
    return true;
  }

  if (msg.type === 'openOptions') {
    chrome.runtime.openOptionsPage();
    return false;
  }
});

// === 串流翻譯（使用 Port） ===
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate-stream') return;

  port.onMessage.addListener(async (msg) => {
    try {
      const settings = await Storage.getSettings();
      const provider = settings.providers.find(p => p.id === (msg.providerId || settings.activeProviderId));
      if (!provider) {
        port.postMessage({ type: 'error', error: '未設定供應商' });
        return;
      }

      const model = msg.model || settings.activeModelId;
      const targetLang = msg.targetLanguage || settings.targetLanguage;
      const langEntry = languageData.find(l => l.code === targetLang);
      const langName = langEntry ? langEntry.name : targetLang;

      // 檢查快取
      if (settings.enableCache && msg.url) {
        const cached = await Cache.get(msg.url, msg.text, targetLang, model);
        if (cached) {
          port.postMessage({ type: 'token', token: cached, fullText: cached, fromCache: true });
          port.postMessage({ type: 'done', fullText: cached, fromCache: true });
          return;
        }
      }

      const startTime = Date.now();

      const fullText = await ApiClient.translate(
        provider.baseUrl,
        provider.apiKey,
        model,
        msg.text,
        langName,
        settings.enableStreaming
          ? (token, fullText) => {
              port.postMessage({ type: 'token', token, fullText });
            }
          : null
      );

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // 非串流模式直接回傳完整結果
      if (!settings.enableStreaming) {
        port.postMessage({ type: 'token', token: fullText, fullText });
      }

      port.postMessage({ type: 'done', fullText, elapsed, model });

      // 寫入快取
      if (settings.enableCache && msg.url) {
        await Cache.set(msg.url, msg.text, targetLang, model, fullText);
      }
    } catch (e) {
      port.postMessage({ type: 'error', error: e.message });
    }
  });
});

// === 快捷鍵 ===
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'translate-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'translatePage' });
  } else if (command === 'translate-selection') {
    chrome.tabs.sendMessage(tab.id, { type: 'translateSelection' });
  }
});

// === 處理函式 ===
async function handleFetchModels(msg) {
  const models = await ApiClient.fetchModels(msg.baseUrl, msg.apiKey);
  if (msg.providerId) {
    await Storage.setModelCache(msg.providerId, models);
  }
  return { models };
}

async function handleTestConnection(msg) {
  const models = await ApiClient.fetchModels(msg.baseUrl, msg.apiKey);
  return { success: true, modelCount: models.length };
}

async function handleTranslate(msg) {
  const settings = await Storage.getSettings();
  const provider = settings.providers.find(p => p.id === settings.activeProviderId);
  if (!provider) throw new Error('未設定供應商');

  const langEntry = languageData.find(l => l.code === settings.targetLanguage);
  const langName = langEntry ? langEntry.name : settings.targetLanguage;

  const result = await ApiClient.translate(
    provider.baseUrl,
    provider.apiKey,
    settings.activeModelId,
    msg.text,
    langName,
    null // 非串流
  );
  return { translation: result };
}
```

- [ ] **Step 2: 在 chrome://extensions 重新載入擴展，確認 Service Worker 正常註冊**

Expected: Service Worker 狀態顯示 "active" 或 "idle"，無錯誤

- [ ] **Step 3: Commit**

```bash
git add background.js
git commit -m "新增 Background Service Worker：API 呼叫、串流轉發、快捷鍵"
```

---

## Task 5: Content Script — Shadow DOM + 懸浮球

**Files:**
- Create: `content.css`
- Create: `content.js`

- [ ] **Step 1: 建立 content.css — Shadow DOM 內部樣式**

Vercel 設計系統完整實作。此檔案會注入 Shadow DOM 內，完全隔離於宿主頁面。完整 CSS 包含：

- 懸浮球（收合 + 展開選單 + 4 種狀態）
- 劃詞冒泡按鈕 + 翻譯結果卡片
- 雙語對照譯文區塊
- Shimmer 載入動畫
- Badge（語言 pill、模型 pill）
- 動畫（pulse、shimmer、fadeIn、slideUp）

```css
/* content.css — Shadow DOM 內部樣式 (Vercel Design System) */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

:host {
  all: initial;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  color: #171717;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* === 懸浮球 === */
.translator-fab {
  position: fixed;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #171717;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 2147483647;
  transition: transform 0.2s ease, background 0.3s ease, box-shadow 0.3s ease;
  user-select: none;
  border: none;
  outline: none;
}
.translator-fab:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(0,0,0,0.2); }
.translator-fab.translating { background: #0072f5; box-shadow: 0 4px 12px rgba(0,114,245,0.3); animation: pulse 1.5s infinite; }
.translator-fab.done { background: #17a34a; box-shadow: 0 4px 12px rgba(23,163,74,0.3); }
.translator-fab.error { background: #ef4444; box-shadow: 0 4px 12px rgba(239,68,68,0.3); }

/* === 懸浮球展開選單 === */
.translator-menu {
  position: fixed;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px, 0 8px 30px rgba(0,0,0,0.12);
  padding: 8px;
  width: 220px;
  z-index: 2147483647;
  animation: slideUp 0.15s ease;
}
.translator-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #171717;
  cursor: pointer;
  transition: background 0.15s;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
}
.translator-menu-item:hover { background: #f5f5f5; }
.translator-menu-item .icon { font-size: 16px; width: 20px; text-align: center; flex-shrink: 0; }
.translator-menu-divider { height: 1px; background: #f0f0f0; margin: 4px 8px; }
.translator-menu-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 4px;
  font-size: 11px;
  color: #999;
}

/* === Badges === */
.badge-lang {
  background: #ebf5ff;
  color: #0068d6;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
}
.badge-model {
  background: #f5f5f5;
  color: #666;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 500;
  font-family: 'SF Mono', ui-monospace, monospace;
}

/* === 劃詞冒泡按鈕 === */
.translator-selection-btn {
  position: fixed;
  background: #171717;
  color: #fff;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  z-index: 2147483647;
  border: none;
  animation: fadeIn 0.15s ease;
  font-family: inherit;
}
.translator-selection-btn::after {
  content: '';
  position: absolute;
  bottom: -5px;
  left: 24px;
  width: 10px;
  height: 10px;
  background: #171717;
  transform: rotate(45deg);
}

/* === 翻譯結果卡片 === */
.translator-result-card {
  position: fixed;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px, 0 8px 30px rgba(0,0,0,0.12);
  padding: 16px;
  width: 320px;
  max-height: 400px;
  overflow-y: auto;
  z-index: 2147483647;
  animation: slideUp 0.15s ease;
  font-family: inherit;
}
.translator-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.translator-result-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #0072f5;
}
.translator-result-close {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #f5f5f5;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: #666;
  cursor: pointer;
  border: none;
  transition: background 0.15s;
}
.translator-result-close:hover { background: #e8e8e8; }
.translator-result-body {
  font-size: 14px;
  line-height: 1.6;
  color: #171717;
  margin-bottom: 10px;
  word-break: break-word;
}
.translator-result-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.translator-result-meta {
  font-size: 10px;
  color: #999;
  font-family: 'SF Mono', ui-monospace, monospace;
}
.translator-copy-btn {
  background: #f5f5f5;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  color: #666;
  cursor: pointer;
  font-weight: 500;
  font-family: inherit;
  transition: background 0.15s;
}
.translator-copy-btn:hover { background: #e8e8e8; }

/* === 動畫 === */
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

/* === 隱藏 === */
.hidden { display: none !important; }
```

注意：雙語對照的譯文區塊和直接替換的效果是直接操作宿主頁面 DOM 的（不在 Shadow DOM 內），需要用 inline style 注入，在 content.js 中處理。

- [ ] **Step 2: 建立 content.js — Content Script 主邏輯**

content.js 是最大的檔案，包含：Shadow DOM 初始化、懸浮球、劃詞翻譯、整頁翻譯邏輯。

由於檔案較長，以下為完整結構和關鍵段落：

```javascript
// content.js — Content Script 主邏輯
// 注入 Shadow DOM UI 元件，處理懸浮球、劃詞翻譯、整頁翻譯

// 載入依賴的 utils（透過 manifest content_scripts 注入順序）
// 注意：需要在 manifest.json 的 content_scripts.js 陣列中按順序載入：
// ["utils/storage.js", "utils/cache.js", "utils/content-detector.js", "language-data.js", "content.js"]

(function() {
  'use strict';

  // 避免重複注入
  if (document.getElementById('chatgpt-translator-root')) return;

  let settings = null;
  let shadowRoot = null;
  let fabEl = null;
  let menuEl = null;
  let selectionBtnEl = null;
  let resultCardEl = null;
  let isMenuOpen = false;
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let translationState = 'idle'; // idle | translating | done | error

  // === 初始化 ===
  async function init() {
    settings = await chrome.runtime.sendMessage({ type: 'getSettings' });
    createShadowDOM();
    if (settings.showFloatingBall) createFAB();
    if (settings.enableSelectionTranslate) setupSelectionListener();
    setupKeyboardShortcuts();
    setupSettingsListener();
  }

  function createShadowDOM() {
    const host = document.createElement('div');
    host.id = 'chatgpt-translator-root';
    shadowRoot = host.attachShadow({ mode: 'closed' });

    // 載入 CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('content.css');
    shadowRoot.appendChild(link);

    document.body.appendChild(host);
  }

  // === 懸浮球 ===
  function createFAB() {
    fabEl = document.createElement('button');
    fabEl.className = 'translator-fab';
    fabEl.textContent = '🌐';
    fabEl.style.bottom = `${settings.floatingBallPosition?.bottom || 24}px`;
    fabEl.style.right = `${settings.floatingBallPosition?.right || 24}px`;

    fabEl.addEventListener('click', (e) => {
      if (isDragging) return;
      toggleMenu();
    });

    // 拖曳支援
    fabEl.addEventListener('mousedown', startDrag);

    shadowRoot.appendChild(fabEl);
  }

  function startDrag(e) {
    isDragging = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const startRight = parseInt(fabEl.style.right);
    const startBottom = parseInt(fabEl.style.bottom);

    function onMove(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) isDragging = true;
      if (!isDragging) return;
      fabEl.style.right = `${startRight - dx}px`;
      fabEl.style.bottom = `${startBottom + dy}px`;
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (isDragging) {
        // 儲存位置
        chrome.storage.local.set({
          floatingBallPosition: {
            bottom: parseInt(fabEl.style.bottom),
            right: parseInt(fabEl.style.right)
          }
        });
        setTimeout(() => { isDragging = false; }, 100);
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function toggleMenu() {
    if (isMenuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  function openMenu() {
    closeAllPopups();
    menuEl = document.createElement('div');
    menuEl.className = 'translator-menu';

    const fabRect = fabEl.getBoundingClientRect();
    menuEl.style.bottom = `${window.innerHeight - fabRect.top + 8}px`;
    menuEl.style.right = fabEl.style.right;

    const mode = settings.translationMode === 'bilingual' ? '雙語對照' : '直接替換';

    menuEl.innerHTML = `
      <button class="translator-menu-item" data-action="translatePage">
        <span class="icon">📄</span> 翻譯整頁
      </button>
      <button class="translator-menu-item" data-action="toggleMode">
        <span class="icon">🔄</span> 切換模式：${mode}
      </button>
      <button class="translator-menu-item" data-action="restoreOriginal">
        <span class="icon">↩️</span> 顯示原文
      </button>
      <div class="translator-menu-divider"></div>
      <button class="translator-menu-item" data-action="openSettings">
        <span class="icon">⚙️</span> 設定
      </button>
      <div class="translator-menu-footer">
        <span class="badge-lang">${getLangName(settings.targetLanguage)}</span>
        <span class="badge-model">${settings.activeModelId || '未選擇'}</span>
      </div>
    `;

    menuEl.addEventListener('click', handleMenuClick);
    shadowRoot.appendChild(menuEl);
    isMenuOpen = true;

    // 點擊外部關閉
    setTimeout(() => document.addEventListener('click', closeMenuOnOutsideClick), 10);
  }

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    isMenuOpen = false;
    document.removeEventListener('click', closeMenuOnOutsideClick);
  }

  function closeMenuOnOutsideClick(e) {
    if (!menuEl) return;
    // 檢查點擊是否在 Shadow DOM 內的 menu/fab 上
    const path = e.composedPath();
    if (path.includes(menuEl) || path.includes(fabEl)) return;
    closeMenu();
  }

  function handleMenuClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    closeMenu();

    switch (action) {
      case 'translatePage': translatePage(); break;
      case 'toggleMode': toggleTranslationMode(); break;
      case 'restoreOriginal': restoreOriginal(); break;
      case 'openSettings': chrome.runtime.sendMessage({ type: 'openOptions' }); break;
    }
  }

  async function toggleTranslationMode() {
    settings.translationMode = settings.translationMode === 'bilingual' ? 'replace' : 'bilingual';
    await chrome.runtime.sendMessage({
      type: 'updateSettings',
      settings: { translationMode: settings.translationMode }
    });
  }

  // === FAB 狀態 ===
  function setFabState(state) {
    translationState = state;
    if (!fabEl) return;
    fabEl.className = 'translator-fab';
    switch (state) {
      case 'translating':
        fabEl.classList.add('translating');
        fabEl.textContent = '⟳';
        break;
      case 'done':
        fabEl.classList.add('done');
        fabEl.textContent = '✓';
        setTimeout(() => setFabState('idle'), 3000);
        break;
      case 'error':
        fabEl.classList.add('error');
        fabEl.textContent = '!';
        setTimeout(() => setFabState('idle'), 5000);
        break;
      default:
        fabEl.textContent = '🌐';
    }
  }

  // === 劃詞翻譯 ===
  function setupSelectionListener() {
    document.addEventListener('mouseup', (e) => {
      // 忽略來自擴展自身的事件
      if (e.target.closest?.('#chatgpt-translator-root')) return;

      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || text.length < 2) {
          removeSelectionBtn();
          return;
        }

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        showSelectionBtn(rect, text);
      }, 10);
    });

    document.addEventListener('mousedown', (e) => {
      if (e.target.closest?.('#chatgpt-translator-root')) return;
      removeSelectionBtn();
      removeResultCard();
    });
  }

  function showSelectionBtn(rect, text) {
    removeSelectionBtn();
    selectionBtnEl = document.createElement('button');
    selectionBtnEl.className = 'translator-selection-btn';
    selectionBtnEl.innerHTML = '🌐 翻譯';
    selectionBtnEl.style.top = `${rect.top + window.scrollY - 40}px`;
    selectionBtnEl.style.left = `${rect.left + window.scrollX + rect.width / 2 - 40}px`;
    selectionBtnEl.style.position = 'absolute';

    selectionBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      removeSelectionBtn();
      translateSelection(text, rect);
    });

    shadowRoot.appendChild(selectionBtnEl);
  }

  function removeSelectionBtn() {
    if (selectionBtnEl) { selectionBtnEl.remove(); selectionBtnEl = null; }
  }

  function translateSelection(text, rect) {
    removeResultCard();

    resultCardEl = document.createElement('div');
    resultCardEl.className = 'translator-result-card';
    resultCardEl.style.top = `${rect.bottom + window.scrollY + 8}px`;
    resultCardEl.style.left = `${rect.left + window.scrollX}px`;
    resultCardEl.style.position = 'absolute';

    resultCardEl.innerHTML = `
      <div class="translator-result-header">
        <span class="translator-result-label">翻譯結果</span>
        <button class="translator-result-close">✕</button>
      </div>
      <div class="translator-result-body">翻譯中...</div>
      <div class="translator-result-footer">
        <span class="translator-result-meta"></span>
        <button class="translator-copy-btn hidden">📋 複製</button>
      </div>
    `;

    resultCardEl.querySelector('.translator-result-close').addEventListener('click', removeResultCard);
    shadowRoot.appendChild(resultCardEl);

    // 透過 Port 串流翻譯
    const port = chrome.runtime.connect({ name: 'translate-stream' });
    const bodyEl = resultCardEl.querySelector('.translator-result-body');
    const metaEl = resultCardEl.querySelector('.translator-result-meta');
    const copyBtn = resultCardEl.querySelector('.translator-copy-btn');

    port.postMessage({
      text,
      url: location.href,
      targetLanguage: settings.targetLanguage
    });

    port.onMessage.addListener((msg) => {
      if (!resultCardEl) { port.disconnect(); return; }
      if (msg.type === 'token') {
        bodyEl.textContent = msg.fullText;
      } else if (msg.type === 'done') {
        metaEl.textContent = msg.fromCache ? '快取' : `${msg.model} · ${msg.elapsed}s`;
        copyBtn.classList.remove('hidden');
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(msg.fullText);
          copyBtn.textContent = '✓ 已複製';
          setTimeout(() => { copyBtn.textContent = '📋 複製'; }, 1500);
        });
      } else if (msg.type === 'error') {
        bodyEl.textContent = `錯誤：${msg.error}`;
        bodyEl.style.color = '#ef4444';
      }
    });
  }

  function removeResultCard() {
    if (resultCardEl) { resultCardEl.remove(); resultCardEl = null; }
  }

  // === 整頁翻譯 ===
  async function translatePage() {
    if (translationState === 'translating') return;
    setFabState('translating');

    try {
      const elements = settings.enableSmartDetection
        ? ContentDetector.sortByVisibility(ContentDetector.getTranslatableElements())
        : Array.from(document.querySelectorAll('p, h1, h2, h3, h4, h5, h6'));

      if (elements.length === 0) {
        setFabState('idle');
        return;
      }

      // 並行翻譯，限制同時 3 個
      const concurrency = 3;
      let index = 0;

      async function processNext() {
        while (index < elements.length) {
          const el = elements[index++];
          try {
            await translateElement(el);
          } catch (e) {
            console.error('翻譯元素失敗:', e);
          }
        }
      }

      const workers = [];
      for (let i = 0; i < Math.min(concurrency, elements.length); i++) {
        workers.push(processNext());
      }
      await Promise.all(workers);

      setFabState('done');
    } catch (e) {
      console.error('Translation error:', e);
      setFabState('error');
    }
  }

  function translateElement(el) {
    return new Promise((resolve) => {
      const text = el.textContent.trim();
      if (!text) { resolve(); return; }

      el.dataset.translatorProcessed = 'true';

      if (settings.translationMode === 'bilingual') {
        // 雙語對照：在元素下方插入譯文區塊
        const block = document.createElement('div');
        block.className = 'chatgpt-translator-bilingual';
        block.dataset.translatorBlock = 'true';
        block.style.cssText = `
          margin-top: 4px; margin-bottom: 16px; padding: 10px 14px;
          background: #fafafa; border-left: 3px solid #0072f5;
          border-radius: 0 8px 8px 0; font-size: inherit;
          line-height: 1.7; color: #4d4d4d; position: relative;
        `;

        // shimmer 載入動畫
        block.innerHTML = `
          <div style="position:absolute;top:-8px;left:8px;font-size:9px;font-weight:600;
            text-transform:uppercase;letter-spacing:0.5px;color:#0072f5;
            background:#fafafa;padding:0 4px;">${getLangName(settings.targetLanguage)}</div>
          <div style="background:linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%);
            background-size:200% 100%;animation:shimmer 1.5s infinite;
            border-radius:4px;height:14px;margin-bottom:6px;width:90%;"></div>
          <div style="background:linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%);
            background-size:200% 100%;animation:shimmer 1.5s infinite;
            border-radius:4px;height:14px;width:60%;"></div>
        `;

        // 注入 shimmer keyframe 到頁面（只做一次）
        if (!document.getElementById('translator-shimmer-style')) {
          const style = document.createElement('style');
          style.id = 'translator-shimmer-style';
          style.textContent = '@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}';
          document.head.appendChild(style);
        }

        el.insertAdjacentElement('afterend', block);

        // 串流翻譯
        const port = chrome.runtime.connect({ name: 'translate-stream' });
        port.postMessage({ text, url: location.href, targetLanguage: settings.targetLanguage });

        port.onMessage.addListener((msg) => {
          if (msg.type === 'token') {
            block.innerHTML = `
              <div style="position:absolute;top:-8px;left:8px;font-size:9px;font-weight:600;
                text-transform:uppercase;letter-spacing:0.5px;color:#0072f5;
                background:#fafafa;padding:0 4px;">${getLangName(settings.targetLanguage)}</div>
              ${msg.fullText}
            `;
          } else if (msg.type === 'done' || msg.type === 'error') {
            if (msg.type === 'error') {
              block.innerHTML = `<span style="color:#ef4444;">翻譯失敗：${msg.error}</span>`;
            }
            resolve();
          }
        });
      } else {
        // 直接替換模式
        el.dataset.originalText = text;
        el.dataset.originalHtml = el.innerHTML;

        const port = chrome.runtime.connect({ name: 'translate-stream' });
        port.postMessage({ text, url: location.href, targetLanguage: settings.targetLanguage });

        port.onMessage.addListener((msg) => {
          if (msg.type === 'token') {
            el.textContent = msg.fullText;
          } else if (msg.type === 'done') {
            el.textContent = msg.fullText;
            resolve();
          } else if (msg.type === 'error') {
            el.textContent = text; // 還原
            resolve();
          }
        });
      }
    });
  }

  function restoreOriginal() {
    // 移除雙語對照區塊
    document.querySelectorAll('[data-translator-block]').forEach(el => el.remove());

    // 還原直接替換的元素
    document.querySelectorAll('[data-original-text]').forEach(el => {
      if (el.dataset.originalHtml) {
        el.innerHTML = el.dataset.originalHtml;
      }
      delete el.dataset.originalText;
      delete el.dataset.originalHtml;
      delete el.dataset.translatorProcessed;
    });

    // 清除所有 processed 標記
    document.querySelectorAll('[data-translator-processed]').forEach(el => {
      delete el.dataset.translatorProcessed;
    });

    setFabState('idle');
  }

  // === 快捷鍵 ===
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'm') {
        e.preventDefault();
        toggleTranslationMode();
      }
      if (e.altKey && e.key === 'b') {
        e.preventDefault();
        if (fabEl) {
          fabEl.classList.toggle('hidden');
          closeMenu();
        }
      }
    });

    // 來自 background 的快捷鍵
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'translatePage') translatePage();
      if (msg.type === 'translateSelection') {
        const sel = window.getSelection()?.toString().trim();
        if (sel) {
          const range = window.getSelection().getRangeAt(0);
          const rect = range.getBoundingClientRect();
          translateSelection(sel, rect);
        }
      }
    });
  }

  // === 設定監聽 ===
  function setupSettingsListener() {
    Storage.onChanged((newSettings) => {
      settings = { ...settings, ...newSettings };
      if (fabEl) {
        fabEl.classList.toggle('hidden', !settings.showFloatingBall);
      }
    });
  }

  // === 工具函式 ===
  function getLangName(code) {
    const lang = languageData.find(l => l.code === code);
    return lang ? lang.name : code;
  }

  function closeAllPopups() {
    closeMenu();
    removeSelectionBtn();
    removeResultCard();
  }

  // Escape 關閉所有彈出
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllPopups();
  });

  // === 啟動 ===
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
```

- [ ] **Step 3: 重新載入擴展，到任意網頁確認懸浮球出現**

注意：manifest.json 的 content_scripts 已在 Task 1 Step 1 中設定完整的載入順序。

Run: 到 `chrome://extensions/` 重新載入 → 開啟任何網頁
Expected: 右下角出現黑色 🌐 懸浮球

- [ ] **Step 5: Commit**

```bash
git add content.css content.js manifest.json
git commit -m "新增 Content Script：Shadow DOM、懸浮球、劃詞翻譯、整頁翻譯"
```

---

## Task 6: 自訂下拉選單元件 + Toast 通知

**Files:**
- Create: `components/dropdown.js`
- Create: `components/toast.js`

- [ ] **Step 1: 建立 components/dropdown.js**

自訂下拉選單元件，支援搜尋篩選、鍵盤導航、Vercel 風格。
用於 Options 頁面的所有下拉選單（供應商、模型、語言）。

```javascript
// components/dropdown.js
// 自訂下拉選單元件 — Vercel Design System

class CustomDropdown {
  constructor(container, options = {}) {
    this.container = container;
    this.options = [];
    this.filteredOptions = [];
    this.selectedValue = options.value || null;
    this.placeholder = options.placeholder || '請選擇...';
    this.searchable = options.searchable || false;
    this.onChange = options.onChange || (() => {});
    this.isOpen = false;
    this.highlightIndex = -1;

    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = '';
    this.container.style.position = 'relative';

    // 觸發器
    this.trigger = document.createElement('button');
    this.trigger.className = 'dropdown-trigger';
    this.trigger.type = 'button';
    this.container.appendChild(this.trigger);
    this.updateTriggerText();

    // 下拉面板
    this.panel = document.createElement('div');
    this.panel.className = 'dropdown-panel hidden';

    if (this.searchable) {
      this.searchInput = document.createElement('input');
      this.searchInput.className = 'dropdown-search';
      this.searchInput.placeholder = '搜尋...';
      this.panel.appendChild(this.searchInput);
    }

    this.listEl = document.createElement('div');
    this.listEl.className = 'dropdown-list';
    this.panel.appendChild(this.listEl);

    this.container.appendChild(this.panel);
  }

  setOptions(options) {
    this.options = options;
    this.filteredOptions = [...options];
    this.renderList();
    this.updateTriggerText();
  }

  renderList() {
    this.listEl.innerHTML = '';
    let lastGroup = null;

    this.filteredOptions.forEach((opt, i) => {
      // 群組分隔
      if (opt.group && opt.group !== lastGroup) {
        if (lastGroup !== null) {
          const divider = document.createElement('div');
          divider.className = 'dropdown-divider';
          this.listEl.appendChild(divider);
        }
        lastGroup = opt.group;
      }

      const item = document.createElement('button');
      item.className = 'dropdown-item';
      item.type = 'button';
      if (opt.value === this.selectedValue) item.classList.add('selected');
      if (i === this.highlightIndex) item.classList.add('highlighted');

      item.innerHTML = `
        <span class="dropdown-item-check">${opt.value === this.selectedValue ? '✓' : ''}</span>
        <span class="dropdown-item-label">${opt.label}</span>
        ${opt.description ? `<span class="dropdown-item-desc">${opt.description}</span>` : ''}
      `;

      item.addEventListener('click', () => this.select(opt.value));
      this.listEl.appendChild(item);
    });
  }

  select(value) {
    this.selectedValue = value;
    this.updateTriggerText();
    this.close();
    this.onChange(value);
    this.renderList();
  }

  updateTriggerText() {
    const selected = this.options.find(o => o.value === this.selectedValue);
    this.trigger.textContent = selected ? selected.label : this.placeholder;
  }

  open() {
    this.isOpen = true;
    this.panel.classList.remove('hidden');
    this.filteredOptions = [...this.options];
    this.highlightIndex = -1;
    this.renderList();
    if (this.searchInput) {
      this.searchInput.value = '';
      this.searchInput.focus();
    }
  }

  close() {
    this.isOpen = false;
    this.panel.classList.add('hidden');
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  filter(query) {
    const q = query.toLowerCase();
    this.filteredOptions = this.options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      (o.description && o.description.toLowerCase().includes(q)) ||
      (o.value && o.value.toLowerCase().includes(q))
    );
    this.highlightIndex = this.filteredOptions.length > 0 ? 0 : -1;
    this.renderList();
  }

  bindEvents() {
    this.trigger.addEventListener('click', () => this.toggle());

    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => this.filter(e.target.value));
    }

    // 鍵盤導航
    this.container.addEventListener('keydown', (e) => {
      if (!this.isOpen) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          this.open();
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          this.highlightIndex = Math.min(this.highlightIndex + 1, this.filteredOptions.length - 1);
          this.renderList();
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.highlightIndex = Math.max(this.highlightIndex - 1, 0);
          this.renderList();
          break;
        case 'Enter':
          e.preventDefault();
          if (this.highlightIndex >= 0) {
            this.select(this.filteredOptions[this.highlightIndex].value);
          }
          break;
        case 'Escape':
          e.preventDefault();
          this.close();
          break;
      }
    });

    // 點擊外部關閉
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) this.close();
    });
  }

  getValue() { return this.selectedValue; }
  setValue(value) { this.selectedValue = value; this.updateTriggerText(); this.renderList(); }
}

if (typeof globalThis !== 'undefined') {
  globalThis.CustomDropdown = CustomDropdown;
}
```

- [ ] **Step 2: 建立 components/toast.js**

```javascript
// components/toast.js
// 簡單的 Toast 通知元件

const Toast = {
  _container: null,

  _getContainer() {
    if (!this._container) {
      this._container = document.createElement('div');
      this._container.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        display: flex; flex-direction: column; gap: 8px;
      `;
      document.body.appendChild(this._container);
    }
    return this._container;
  },

  show(message, type = 'info', duration = 3000) {
    const container = this._getContainer();
    const toast = document.createElement('div');

    const colors = {
      success: { bg: '#f0fdf4', border: '#17a34a', text: '#15803d' },
      error: { bg: '#fef2f2', border: '#ef4444', text: '#dc2626' },
      info: { bg: '#f0f9ff', border: '#0072f5', text: '#0068d6' },
    };
    const c = colors[type] || colors.info;

    toast.style.cssText = `
      padding: 10px 16px; border-radius: 8px; font-size: 13px;
      font-family: 'Inter', -apple-system, sans-serif; font-weight: 500;
      background: ${c.bg}; color: ${c.text};
      box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px, 0 4px 12px rgba(0,0,0,0.1);
      border-left: 3px solid ${c.border};
      animation: slideIn 0.2s ease; max-width: 360px;
    `;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s';
      setTimeout(() => toast.remove(), 200);
    }, duration);
  }
};

if (typeof globalThis !== 'undefined') {
  globalThis.Toast = Toast;
}
```

- [ ] **Step 3: Commit**

```bash
git add components/dropdown.js components/toast.js
git commit -m "新增自訂下拉選單元件與 Toast 通知元件"
```

---

## Task 7: Options 頁面 — HTML + CSS + JS

**Files:**
- Create: `options.html`
- Create: `options.css`
- Create: `options.js`

- [ ] **Step 1: 建立 options.html**

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ChatGPT Translator 設定</title>
  <link rel="stylesheet" href="options.css">
</head>
<body>
  <div class="page">
    <div class="page-header">
      <h1>ChatGPT Translator</h1>
      <p>設定翻譯供應商、模型偏好和顯示選項</p>
    </div>

    <!-- API 供應商 -->
    <section class="settings-section">
      <div class="section-header">
        <h2>API 供應商</h2>
        <button class="btn btn-secondary btn-sm" id="btn-add-provider">+ 新增供應商</button>
      </div>
      <div class="card" id="provider-list"></div>
      <div class="card hidden" id="provider-form-card">
        <div class="provider-form" id="provider-form"></div>
      </div>
    </section>

    <!-- 翻譯模型 -->
    <section class="settings-section">
      <div class="section-header">
        <h2>翻譯模型</h2>
        <button class="btn-link" id="btn-refresh-models">🔄 重新整理模型列表</button>
      </div>
      <div class="card">
        <div class="card-body">
          <div class="form-row">
            <label class="form-label">供應商</label>
            <div id="provider-select"></div>
          </div>
          <div class="form-row">
            <label class="form-label">選擇模型 <span class="form-hint-inline">— 從 /v1/models 自動取得</span></label>
            <div class="model-grid" id="model-grid"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- 翻譯偏好 -->
    <section class="settings-section">
      <div class="section-header">
        <h2>翻譯偏好</h2>
      </div>
      <div class="card">
        <div class="card-body">
          <div class="form-row">
            <label class="form-label">目標語言</label>
            <div id="language-select"></div>
          </div>
          <div class="form-row">
            <label class="form-label">預設翻譯模式</label>
            <div id="mode-select"></div>
          </div>
        </div>
      </div>
    </section>

    <!-- 顯示設定 -->
    <section class="settings-section">
      <div class="section-header">
        <h2>顯示設定</h2>
      </div>
      <div class="card">
        <div class="card-body" id="display-settings"></div>
      </div>
    </section>

    <!-- 快捷鍵 -->
    <section class="settings-section">
      <div class="section-header">
        <h2>快捷鍵</h2>
      </div>
      <div class="card">
        <div class="card-body" id="shortcuts-display"></div>
      </div>
    </section>

    <div class="page-footer">
      <span>ChatGPT Translator v2.0</span>
      <button class="btn btn-ghost btn-sm" id="btn-clear-cache">清除翻譯快取</button>
    </div>
  </div>

  <script src="language-data.js"></script>
  <script src="utils/storage.js"></script>
  <script src="components/dropdown.js"></script>
  <script src="components/toast.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: 建立 options.css**

完整 Vercel 設計系統 CSS。此檔案包含 Options 頁面所有樣式，含 toggle 開關元件（不另建獨立 toggle.js 元件，直接用 CSS + 簡單 JS 處理）。

```css
/* options.css — Vercel Design System */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: #fff;
  color: #171717;
  -webkit-font-smoothing: antialiased;
}

/* === Page Layout === */
.page { max-width: 720px; margin: 0 auto; padding: 48px 24px 80px; }
.page-header { margin-bottom: 40px; }
.page-header h1 { font-size: 32px; font-weight: 600; letter-spacing: -1.6px; margin-bottom: 6px; }
.page-header p { font-size: 14px; color: #666; }

/* === Sections === */
.settings-section { margin-bottom: 40px; }
.section-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #f0f0f0;
}
.section-header h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.5px; }

/* === Cards === */
.card {
  background: #fff; border-radius: 8px;
  box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px;
  margin-bottom: 12px; overflow: hidden;
}
.card-body { padding: 16px 20px; }

/* === Buttons === */
.btn {
  padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500;
  cursor: pointer; border: none; transition: all 0.15s; font-family: inherit;
}
.btn-primary { background: #171717; color: #fff; }
.btn-primary:hover { background: #333; }
.btn-secondary { background: #fff; color: #171717; box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px; }
.btn-secondary:hover { background: #fafafa; }
.btn-ghost { background: transparent; color: #666; }
.btn-ghost:hover { background: #f5f5f5; color: #171717; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn-test { background: #ebf5ff; color: #0068d6; }
.btn-test:hover { background: #dbeafe; }
.btn-link {
  background: none; border: none; color: #0072f5; font-size: 13px;
  font-weight: 500; cursor: pointer; font-family: inherit;
}
.btn-link:hover { text-decoration: underline; }

/* === Forms === */
.form-row { margin-bottom: 14px; }
.form-label { font-size: 12px; font-weight: 600; color: #444; margin-bottom: 6px; display: block; }
.form-hint { font-size: 11px; color: #999; margin-top: 4px; }
.form-hint-inline { color: #999; font-weight: 400; }
.form-input {
  width: 100%; padding: 8px 12px; border: none; border-radius: 6px;
  box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px; font-size: 13px;
  font-family: inherit; background: #fff; color: #171717; outline: none;
}
.form-input:focus { box-shadow: 0 0 0 2px hsla(212, 100%, 48%, 1); }
.form-input::placeholder { color: #aaa; }
.form-input.mono { font-family: 'SF Mono', ui-monospace, monospace; font-size: 12px; }

/* === Custom Dropdown === */
.dropdown-trigger {
  width: 100%; padding: 8px 12px; border: none; border-radius: 6px;
  box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px; font-size: 13px;
  font-family: inherit; background: #fff; color: #171717; cursor: pointer;
  text-align: left; position: relative; padding-right: 32px;
}
.dropdown-trigger::after {
  content: ''; position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid #999;
}
.dropdown-trigger:focus { box-shadow: 0 0 0 2px hsla(212, 100%, 48%, 1); outline: none; }
.dropdown-panel {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: #fff; border-radius: 8px; max-height: 280px; overflow-y: auto;
  box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px, 0 8px 30px rgba(0,0,0,0.12);
  z-index: 100;
}
.dropdown-search {
  width: 100%; padding: 8px 12px; border: none; border-bottom: 1px solid #f0f0f0;
  font-size: 13px; font-family: inherit; outline: none; background: #fafafa;
  border-radius: 8px 8px 0 0;
}
.dropdown-search::placeholder { color: #aaa; }
.dropdown-list { padding: 4px; }
.dropdown-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: 6px; font-size: 13px; color: #171717; cursor: pointer;
  border: none; background: none; width: 100%; text-align: left;
  font-family: inherit; transition: background 0.1s;
}
.dropdown-item:hover, .dropdown-item.highlighted { background: #f5f5f5; }
.dropdown-item.selected { font-weight: 600; }
.dropdown-item-check { width: 16px; font-size: 12px; color: #0072f5; flex-shrink: 0; }
.dropdown-item-label { flex: 1; }
.dropdown-item-desc { font-size: 11px; color: #999; }
.dropdown-divider { height: 1px; background: #f0f0f0; margin: 4px 0; }

/* === Provider Cards === */
.provider-card {
  display: flex; align-items: center; padding: 14px 20px; gap: 14px;
  transition: background 0.15s;
}
.provider-card:hover { background: #fafafa; }
.provider-icon {
  width: 36px; height: 36px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.provider-info { flex: 1; min-width: 0; }
.provider-name { font-size: 14px; font-weight: 600; margin-bottom: 2px; }
.provider-url {
  font-size: 12px; color: #666; font-family: 'SF Mono', ui-monospace, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.provider-status { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 500; }
.status-dot { width: 7px; height: 7px; border-radius: 50%; }
.status-dot.green { background: #17a34a; }
.status-dot.gray { background: #ccc; }
.status-dot.red { background: #ef4444; }
.provider-badge {
  background: #ebf5ff; color: #0068d6; padding: 2px 8px;
  border-radius: 9999px; font-size: 10px; font-weight: 600; margin-left: 8px;
}
.provider-actions { display: flex; gap: 4px; }
.icon-btn {
  width: 28px; height: 28px; border-radius: 6px; border: none;
  background: transparent; color: #999; font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: #f5f5f5; color: #171717; }

/* === Provider Form === */
.provider-form { padding: 20px; background: #fafafa; border-top: 1px solid #f0f0f0; }
.provider-form-title { font-size: 14px; font-weight: 600; margin-bottom: 16px; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.template-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.template-btn {
  padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 500;
  background: #f5f5f5; border: none; cursor: pointer; color: #444;
  font-family: inherit; transition: all 0.15s;
}
.template-btn:hover { background: #e8e8e8; }

/* === Model Grid === */
.model-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 4px 0; }
.model-option {
  padding: 10px 14px; border-radius: 8px; cursor: pointer;
  box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px;
  transition: all 0.15s; background: #fff;
}
.model-option:hover { background: #fafafa; }
.model-option.selected { box-shadow: 0 0 0 2px #0072f5; background: #f8fbff; }
.model-name {
  font-size: 13px; font-weight: 600;
  font-family: 'SF Mono', ui-monospace, monospace; margin-bottom: 2px;
}
.model-desc { font-size: 11px; color: #888; }

/* === Toggle Switch === */
.setting-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 0; border-bottom: 1px solid #f5f5f5;
}
.setting-row:last-child { border-bottom: none; }
.setting-label { font-size: 13px; font-weight: 500; }
.setting-desc { font-size: 11px; color: #888; margin-top: 2px; }
.toggle {
  width: 36px; height: 20px; border-radius: 10px; background: #ddd;
  position: relative; cursor: pointer; transition: background 0.2s;
  border: none; padding: 0; flex-shrink: 0;
}
.toggle.on { background: #171717; }
.toggle::after {
  content: ''; position: absolute; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; top: 2px; left: 2px;
  transition: transform 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.toggle.on::after { transform: translateX(16px); }

/* === Shortcuts === */
.shortcut-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0; border-bottom: 1px solid #f5f5f5;
}
.shortcut-row:last-child { border-bottom: none; }
.shortcut-label { font-size: 13px; color: #444; }
.kbd {
  background: #f5f5f5; border-radius: 4px; padding: 3px 8px;
  font-size: 11px; font-family: 'SF Mono', ui-monospace, monospace;
  font-weight: 500; color: #444;
  box-shadow: rgba(0,0,0,0.08) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 1px 0px;
}

/* === Misc === */
.divider { height: 1px; background: #f0f0f0; }
.hidden { display: none !important; }
.page-footer {
  margin-top: 48px; padding-top: 24px; border-top: 1px solid #f0f0f0;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; color: #999;
}

/* === Toast animation === */
@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
```

- [ ] **Step 3: 建立 options.js**

完整 Options 頁面邏輯：載入設定、供應商 CRUD、模型取得、語言/模式下拉選單、toggle 開關、快捷鍵顯示。

```javascript
// options.js — Options 頁面邏輯

(function() {
  'use strict';

  let settings = null;
  let providerDropdown = null;
  let languageDropdown = null;
  let modeDropdown = null;
  let editingProviderId = null;

  const TEMPLATES = [
    { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', icon: '⚡', iconBg: '#f0f9ff', iconColor: '#0a72ef', needsKey: true },
    { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', icon: '🦙', iconBg: '#faf5ff', iconColor: '#7928ca', needsKey: false },
    { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', icon: '🖥', iconBg: '#f0fdf4', iconColor: '#17a34a', needsKey: false },
    { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', icon: '🚀', iconBg: '#fff7ed', iconColor: '#ea580c', needsKey: true },
    { name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', icon: '🤝', iconBg: '#fef2f2', iconColor: '#dc2626', needsKey: true },
  ];

  // === 初始化 ===
  async function init() {
    settings = await Storage.getSettings();
    renderProviderList();
    initModelSection();
    initLanguageDropdown();
    initModeDropdown();
    renderDisplaySettings();
    renderShortcuts();
    bindGlobalEvents();
  }

  // === 供應商列表 ===
  function renderProviderList() {
    const list = document.getElementById('provider-list');
    if (!settings.providers.length) {
      list.innerHTML = '<div class="card-body" style="text-align:center;color:#999;font-size:13px;">尚未設定任何供應商，點擊「+ 新增供應商」開始</div>';
      return;
    }

    list.innerHTML = settings.providers.map((p, i) => {
      const tpl = TEMPLATES.find(t => p.baseUrl.includes(t.baseUrl.replace('/v1', ''))) || TEMPLATES[0];
      const isActive = p.id === settings.activeProviderId;
      return `
        ${i > 0 ? '<div class="divider"></div>' : ''}
        <div class="provider-card" data-id="${p.id}">
          <div class="provider-icon" style="background:${tpl.iconBg};color:${tpl.iconColor};">${tpl.icon}</div>
          <div class="provider-info">
            <div class="provider-name">${p.name}${isActive ? '<span class="provider-badge">使用中</span>' : ''}</div>
            <div class="provider-url">${p.baseUrl}</div>
          </div>
          <div class="provider-actions">
            ${!isActive ? `<button class="btn btn-sm btn-ghost" data-action="activate" data-id="${p.id}">啟用</button>` : ''}
            <button class="icon-btn" data-action="edit" data-id="${p.id}">✏️</button>
            <button class="icon-btn" data-action="delete" data-id="${p.id}">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    list.addEventListener('click', handleProviderAction);
  }

  async function handleProviderAction(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;

    if (action === 'delete') {
      settings.providers = settings.providers.filter(p => p.id !== id);
      if (settings.activeProviderId === id) {
        settings.activeProviderId = settings.providers[0]?.id || null;
        settings.activeModelId = null;
      }
      await saveAndRefresh();
    } else if (action === 'activate') {
      settings.activeProviderId = id;
      settings.activeModelId = null;
      await saveAndRefresh();
      refreshModels();
    } else if (action === 'edit') {
      editingProviderId = id;
      const p = settings.providers.find(p => p.id === id);
      showProviderForm(p);
    }
  }

  // === 供應商表單 ===
  function showProviderForm(existing) {
    const card = document.getElementById('provider-form-card');
    const form = document.getElementById('provider-form');
    card.classList.remove('hidden');

    form.innerHTML = `
      <div class="provider-form-title">${existing ? '編輯供應商' : '新增 API 供應商'}</div>
      ${!existing ? `
        <label class="form-label">快速範本</label>
        <div class="template-btns">
          ${TEMPLATES.map(t => `<button class="template-btn" data-tpl="${t.name}">${t.icon} ${t.name}</button>`).join('')}
        </div>
      ` : ''}
      <div class="form-row">
        <label class="form-label">名稱</label>
        <input class="form-input" id="pf-name" placeholder="例如：Groq、Together AI..." value="${existing?.name || ''}">
      </div>
      <div class="form-row">
        <label class="form-label">API 端點</label>
        <input class="form-input mono" id="pf-url" placeholder="https://api.example.com/v1" value="${existing?.baseUrl || ''}">
        <div class="form-hint">支援所有 OpenAI 相容 API 格式</div>
      </div>
      <div class="form-row">
        <label class="form-label">API Key <span style="color:#999;font-weight:400;">(選填，本地模型不需要)</span></label>
        <input class="form-input mono" type="password" id="pf-key" placeholder="sk-..." value="${existing?.apiKey || ''}">
      </div>
      <div id="pf-test-result"></div>
      <div class="form-actions">
        <button class="btn btn-test btn-sm" id="pf-test">🔍 測試連線</button>
        <button class="btn btn-ghost btn-sm" id="pf-cancel">取消</button>
        <button class="btn btn-primary btn-sm" id="pf-save">儲存</button>
      </div>
    `;

    // 範本按鈕
    form.querySelectorAll('.template-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpl = TEMPLATES.find(t => t.name === btn.dataset.tpl);
        if (tpl) {
          document.getElementById('pf-name').value = tpl.name;
          document.getElementById('pf-url').value = tpl.baseUrl;
          document.getElementById('pf-key').value = '';
          if (!tpl.needsKey) document.getElementById('pf-key').placeholder = '不需要';
        }
      });
    });

    document.getElementById('pf-test').addEventListener('click', testConnection);
    document.getElementById('pf-cancel').addEventListener('click', hideProviderForm);
    document.getElementById('pf-save').addEventListener('click', saveProvider);
  }

  function hideProviderForm() {
    document.getElementById('provider-form-card').classList.add('hidden');
    editingProviderId = null;
  }

  async function testConnection() {
    const url = document.getElementById('pf-url').value.trim();
    const key = document.getElementById('pf-key').value.trim();
    const resultEl = document.getElementById('pf-test-result');
    resultEl.innerHTML = '<span style="font-size:12px;color:#666;">測試中...</span>';

    try {
      const res = await chrome.runtime.sendMessage({ type: 'testConnection', baseUrl: url, apiKey: key });
      if (res.error) throw new Error(res.error);
      resultEl.innerHTML = `<span style="font-size:12px;color:#17a34a;">✓ 連線成功 · ${res.modelCount} 個模型</span>`;
    } catch (e) {
      resultEl.innerHTML = `<span style="font-size:12px;color:#ef4444;">✗ ${e.message}</span>`;
    }
  }

  async function saveProvider() {
    const name = document.getElementById('pf-name').value.trim();
    const baseUrl = document.getElementById('pf-url').value.trim();
    const apiKey = document.getElementById('pf-key').value.trim();

    if (!name || !baseUrl) { Toast.show('請填寫名稱和 API 端點', 'error'); return; }

    if (editingProviderId) {
      const p = settings.providers.find(p => p.id === editingProviderId);
      if (p) { p.name = name; p.baseUrl = baseUrl; p.apiKey = apiKey; }
    } else {
      const id = crypto.randomUUID();
      settings.providers.push({ id, name, baseUrl, apiKey });
      if (!settings.activeProviderId) {
        settings.activeProviderId = id;
      }
    }

    await saveAndRefresh();
    hideProviderForm();
    Toast.show('供應商已儲存', 'success');
  }

  // === 模型區塊 ===
  function initModelSection() {
    providerDropdown = new CustomDropdown(document.getElementById('provider-select'), {
      value: settings.activeProviderId,
      placeholder: '選擇供應商...',
      onChange: (val) => {
        settings.activeProviderId = val;
        settings.activeModelId = null;
        Storage.updateSettings({ activeProviderId: val, activeModelId: null });
        refreshModels();
      }
    });
    updateProviderDropdownOptions();
    refreshModels();

    document.getElementById('btn-refresh-models').addEventListener('click', () => refreshModels(true));
  }

  function updateProviderDropdownOptions() {
    providerDropdown.setOptions(
      settings.providers.map(p => ({
        value: p.id,
        label: `${p.name} (${new URL(p.baseUrl).host})`
      }))
    );
  }

  async function refreshModels(force = false) {
    const grid = document.getElementById('model-grid');
    const provider = settings.providers.find(p => p.id === settings.activeProviderId);
    if (!provider) {
      grid.innerHTML = '<div style="font-size:12px;color:#999;padding:8px;">請先選擇供應商</div>';
      return;
    }

    grid.innerHTML = '<div style="font-size:12px;color:#666;padding:8px;">載入模型中...</div>';

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'fetchModels', baseUrl: provider.baseUrl, apiKey: provider.apiKey, providerId: provider.id
      });
      if (res.error) throw new Error(res.error);

      const models = res.models || [];
      grid.innerHTML = models.map(m => `
        <div class="model-option${m === settings.activeModelId ? ' selected' : ''}" data-model="${m}">
          <div class="model-name">${m}</div>
        </div>
      `).join('') + `
        <div class="model-option" data-model="__custom__">
          <div class="model-name" style="color:#999;">+ 手動輸入</div>
          <div class="model-desc">自訂模型名稱</div>
        </div>
      `;

      grid.querySelectorAll('.model-option').forEach(el => {
        el.addEventListener('click', () => selectModel(el.dataset.model));
      });
    } catch (e) {
      grid.innerHTML = `<div style="font-size:12px;color:#ef4444;padding:8px;">載入失敗：${e.message}</div>`;
    }
  }

  async function selectModel(modelId) {
    if (modelId === '__custom__') {
      const name = prompt('請輸入模型名稱：');
      if (!name) return;
      modelId = name.trim();
    }
    settings.activeModelId = modelId;
    await Storage.updateSettings({ activeModelId: modelId });
    refreshModels();
  }

  // === 語言選擇器 ===
  function initLanguageDropdown() {
    const favorites = languageData.filter(l => l.isFavorite);
    const rest = languageData.filter(l => !l.isFavorite);

    const options = [
      ...favorites.map(l => ({ value: l.code, label: `${l.name} (${l.code})`, description: l.localName, group: 'favorites' })),
      ...rest.map(l => ({ value: l.code, label: `${l.name} (${l.code})`, description: l.localName, group: 'all' })),
    ];

    languageDropdown = new CustomDropdown(document.getElementById('language-select'), {
      value: settings.targetLanguage,
      placeholder: '選擇語言...',
      searchable: true,
      onChange: async (val) => {
        settings.targetLanguage = val;
        await Storage.updateSettings({ targetLanguage: val });
      }
    });
    languageDropdown.setOptions(options);
  }

  // === 翻譯模式 ===
  function initModeDropdown() {
    modeDropdown = new CustomDropdown(document.getElementById('mode-select'), {
      value: settings.translationMode,
      onChange: async (val) => {
        settings.translationMode = val;
        await Storage.updateSettings({ translationMode: val });
      }
    });
    modeDropdown.setOptions([
      { value: 'bilingual', label: '雙語對照 — 原文 + 譯文並列' },
      { value: 'replace', label: '直接替換 — 譯文取代原文' },
    ]);
  }

  // === 顯示設定 ===
  function renderDisplaySettings() {
    const container = document.getElementById('display-settings');
    const toggles = [
      { key: 'showFloatingBall', label: '顯示懸浮球', desc: '在每個網頁右下角顯示翻譯懸浮球' },
      { key: 'enableSelectionTranslate', label: '劃詞翻譯', desc: '選取文字時自動顯示翻譯按鈕' },
      { key: 'enableStreaming', label: '串流翻譯', desc: '翻譯結果逐字顯示（需要模型支援 SSE）' },
      { key: 'enableSmartDetection', label: '智慧內容偵測', desc: '自動跳過導航列、頁尾、程式碼區塊等' },
      { key: 'enableCache', label: '翻譯快取', desc: '快取翻譯結果，避免重複呼叫 API' },
    ];

    container.innerHTML = toggles.map(t => `
      <div class="setting-row">
        <div>
          <div class="setting-label">${t.label}</div>
          <div class="setting-desc">${t.desc}</div>
        </div>
        <button class="toggle${settings[t.key] ? ' on' : ''}" data-key="${t.key}" type="button"></button>
      </div>
    `).join('');

    container.querySelectorAll('.toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        settings[key] = !settings[key];
        btn.classList.toggle('on', settings[key]);
        await Storage.updateSettings({ [key]: settings[key] });
      });
    });
  }

  // === 快捷鍵 ===
  function renderShortcuts() {
    const container = document.getElementById('shortcuts-display');
    const shortcuts = [
      { label: '翻譯整頁', keys: ['Alt', 'T'] },
      { label: '翻譯選取文字', keys: ['Alt', 'Q'] },
      { label: '切換翻譯模式', keys: ['Alt', 'M'] },
      { label: '顯示/隱藏懸浮球', keys: ['Alt', 'B'] },
    ];

    container.innerHTML = shortcuts.map(s => `
      <div class="shortcut-row">
        <span class="shortcut-label">${s.label}</span>
        <span>${s.keys.map(k => `<span class="kbd">${k}</span>`).join(' + ')}</span>
      </div>
    `).join('');
  }

  // === 全域事件 ===
  function bindGlobalEvents() {
    document.getElementById('btn-add-provider').addEventListener('click', () => {
      editingProviderId = null;
      showProviderForm(null);
    });

    document.getElementById('btn-clear-cache').addEventListener('click', async () => {
      await Storage.clearTranslationCache();
      Toast.show('翻譯快取已清除', 'success');
    });
  }

  async function saveAndRefresh() {
    await Storage.saveSettings(settings);
    renderProviderList();
    updateProviderDropdownOptions();
  }

  // === 啟動 ===
  document.addEventListener('DOMContentLoaded', init);
})();
```

- [ ] **Step 4: 到 chrome://extensions → Options 開啟設定頁面驗證**

Run: 點擊擴展的「選項」連結
Expected: 設定頁面正確載入，供應商列表可操作

- [ ] **Step 5: Commit**

```bash
git add options.html options.css options.js
git commit -m "新增 Options 設定頁面：供應商管理、模型選擇、偏好設定"
```

---

## Task 8: 整合測試 — LM Studio 連線驗證

**Files:** 無新檔案

- [ ] **Step 1: 在 Options 頁面新增 LM Studio 供應商**

1. 開啟 Options 頁面
2. 點擊「+ 新增供應商」
3. 選擇 LM Studio 範本（自動填入 `http://localhost:1234/v1`，API Key 留空）
4. 點擊「測試連線」

Expected: 綠色 ✓ + 顯示可用模型數量

- [ ] **Step 2: 選擇模型並設為使用中**

1. 在翻譯模型區塊，供應商選擇 LM Studio
2. 模型網格顯示本地可用模型
3. 選擇一個模型

Expected: 模型被選中，設定自動儲存

- [ ] **Step 3: 測試懸浮球整頁翻譯**

1. 開啟任何英文網頁（例如 Wikipedia 英文版）
2. 確認右下角懸浮球出現
3. 點擊懸浮球 → 翻譯整頁
4. 觀察：懸浮球變藍色旋轉、段落下方出現 shimmer 動畫、逐漸顯示翻譯結果

Expected: 段落下方出現雙語對照翻譯區塊，懸浮球變綠色 ✓

- [ ] **Step 4: 測試劃詞翻譯**

1. 在網頁上選取一段英文文字
2. 確認出現「🌐 翻譯」冒泡按鈕
3. 點擊按鈕
4. 觀察翻譯結果卡片

Expected: 翻譯結果卡片顯示翻譯、模型名稱、耗時

- [ ] **Step 5: 測試切換翻譯模式**

1. 點擊懸浮球 → 切換模式：雙語對照 → 直接替換
2. 重新翻譯整頁
3. 確認原文被譯文取代

Expected: 原文消失，段落內容變為翻譯結果

- [ ] **Step 6: 測試還原原文**

1. 點擊懸浮球 → 顯示原文

Expected: 所有翻譯區塊移除/還原，恢復原始頁面

- [ ] **Step 7: Commit（如有修復）**

```bash
git add -A
git commit -m "整合測試修復"
```

---

## Task 9: Chrome CDP 驗證

**Files:** 無新檔案

- [ ] **Step 1: 使用 chrome-cdp skill 連接到瀏覽器驗證**

使用 chrome-cdp skill 連接到本地 Chrome，驗證：

1. 擴展已載入且無錯誤
2. 到任意英文頁面，確認懸浮球可見
3. 點擊懸浮球展開選單
4. 執行整頁翻譯（透過 LM Studio）
5. 確認翻譯結果正確顯示
6. 測試劃詞翻譯
7. 開啟 Options 頁面確認 UI 正確

- [ ] **Step 2: 修復 CDP 驗證發現的問題**

- [ ] **Step 3: 最終 Commit**

```bash
git add -A
git commit -m "v2.0 完成：沉浸式翻譯擴展"
```
