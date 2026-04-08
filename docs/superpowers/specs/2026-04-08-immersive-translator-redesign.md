# ChatGPT Translator v2.0 — 沉浸式翻譯重設計

## 概要

將 ChatGPT Translator 從簡單的 popup 翻譯工具，重構為沉浸式網頁翻譯擴展。核心體驗：懸浮球觸發整頁翻譯、劃詞冒泡翻譯、雙語對照/直接替換可切換。支援 OpenAI 相容 API 端點（OpenAI、Ollama、LM Studio、Groq 等），動態模型列表。UI 套用 Vercel / Geist 設計系統。

## 決策記錄

| 決定 | 選擇 | 理由 |
|------|------|------|
| API 供應商架構 | OpenAI 相容端點統一格式 | Ollama/LM Studio 本身就是 OpenAI 相容，一套 client 通吃 |
| UI 整合模式 | Content Script 注入 (非 popup) | 與網頁內容視覺融合，支援行內翻譯 |
| 翻譯顯示 | 雙語對照 + 直接替換，可切換 | 使用者自由選擇 |
| 互動方式 | 懸浮球 + 劃詞冒泡 | 沉浸式翻譯核心模式 |
| 側邊面板 | 不需要 | 保持簡潔，懸浮球 + 行內翻譯足夠 |
| 設定管理 | 獨立 Options 頁面 | 設定複雜度高，需要完整頁面 |
| OpenAI 認證 | API Key 手動輸入 | OpenAI OAuth 未開放第三方，Session Token 違反 ToS |
| 設計風格 | Vercel / Geist 設計系統 | 依據 DESIGN.md 規範 |
| 下拉選單 | 自訂 CSS dropdown | 不使用瀏覽器原生 select |
| 語言支援 | 完整 i18n 語言列表 + 搜尋篩選 | AI 可翻譯任何語系 |

---

## 1. 系統架構

### 1.1 模組總覽

```
Chrome Extension (Manifest V3)
├── background.js (Service Worker)
│   ├── API 呼叫集中處理
│   ├── SSE 串流轉發
│   ├── 模型列表快取
│   └── 設定讀寫 (chrome.storage)
│
├── content.js (Content Script，每個頁面注入)
│   ├── Shadow DOM 容器 (CSS 完全隔離)
│   │   ├── 懸浮球元件
│   │   ├── 懸浮球展開選單
│   │   ├── 劃詞冒泡按鈕
│   │   └── 劃詞翻譯結果卡片
│   ├── 頁面內容偵測與擷取
│   ├── DOM 操作（插入雙語譯文 / 替換原文）
│   └── 文字選取監聽
│
├── options.html + options.js + options.css
│   ├── API 供應商 CRUD
│   ├── 動態模型選擇
│   ├── 翻譯偏好設定
│   ├── 顯示設定
│   └── 快捷鍵設定
│
├── content.css (注入 Shadow DOM 內)
├── language-data.js (完整 i18n 語言列表)
└── manifest.json (Manifest V3)
```

### 1.2 通訊流程

1. **Content Script → Background**：`chrome.runtime.sendMessage` 發送翻譯請求（含文字、目標語言、供應商/模型資訊）
2. **Background → API**：`fetch` 呼叫 OpenAI 相容端點，支援 SSE streaming（`stream: true`）
3. **Background → Content Script**：透過 `chrome.runtime.connect` (Port) 回傳串流翻譯結果，逐 token 推送
4. **Options ↔ chrome.storage**：設定變更寫入 `chrome.storage.sync`，Content Script 監聽 `chrome.storage.onChanged`

### 1.3 為什麼 API 呼叫放在 Background

- Content Script 受頁面 CSP 限制，可能無法直接呼叫外部 API
- Background Service Worker 不受 CSP 限制
- 集中管理 API Key，避免在每個頁面的 Content Script 中暴露

---

## 2. API 供應商層

### 2.1 資料模型

```javascript
// 供應商設定儲存在 chrome.storage.sync（不含 models 快取）
// models 快取儲存在 chrome.storage.local（避免 sync 100KB 上限）
{
  providers: [
    {
      id: "uuid",
      name: "LM Studio",
      baseUrl: "http://localhost:1234/v1",
      apiKey: "",          // 選填，本地模型不需要
      isActive: true,      // 目前使用中的供應商
      models: [],          // 快取的模型列表
      modelsLastFetched: 0 // 上次取得模型列表的時間戳
    }
  ],
  activeProviderId: "uuid",
  activeModelId: "qwen2.5-7b"
}
```

### 2.2 模型動態取得

- 呼叫 `GET {baseUrl}/models` 取得可用模型列表
- 解析回應中的 `data[].id` 欄位
- 快取模型列表，每次開啟 Options 頁面時自動重新整理
- 提供手動「重新整理模型列表」按鈕
- 支援手動輸入模型名稱（fallback）

### 2.3 預設供應商範本

新增供應商時提供快速範本：

| 範本 | Base URL | 需要 API Key |
|------|----------|-------------|
| OpenAI | `https://api.openai.com/v1` | 是 |
| Ollama | `http://localhost:11434/v1` | 否 |
| LM Studio | `http://localhost:1234/v1` | 否 |
| Groq | `https://api.groq.com/openai/v1` | 是 |
| Together AI | `https://api.together.xyz/v1` | 是 |
| 自訂 | 手動輸入 | 選填 |

### 2.4 連線測試

- 「測試連線」按鈕呼叫 `GET {baseUrl}/models`
- 成功：顯示綠色 ✓ + 可用模型數量
- 失敗：顯示紅色 ✗ + 錯誤訊息（網路錯誤、認證失敗等）

---

## 3. Content Script 元件

### 3.1 CSS 隔離策略

所有 UI 元件注入到一個 Shadow DOM 容器中：

```javascript
const host = document.createElement('div');
host.id = 'chatgpt-translator-root';
const shadow = host.attachShadow({ mode: 'closed' });
// 所有 CSS 和 UI 元件在 shadow 內，不受宿主頁面影響
document.body.appendChild(host);
```

使用 `closed` mode 防止宿主頁面存取內部 DOM。

### 3.2 懸浮球

**收合狀態：**
- 固定於頁面右下角（`position: fixed; bottom: 24px; right: 24px;`）
- 44×44px 圓形按鈕，背景 `#171717`，白色 🌐 圖示
- `box-shadow: 0 4px 12px rgba(0,0,0,0.15)`
- 可拖曳移動（記住位置到 chrome.storage.local，跨網站一致）
- hover 時微放大 `scale(1.08)`

**展開選單：**
- 從懸浮球上方展開，寬 220px
- 白色背景，`border-radius: 12px`
- Shadow stack: `rgba(0,0,0,0.08) 0px 0px 0px 1px, 0 8px 30px rgba(0,0,0,0.12)`
- 選單項目：
  - 📄 翻譯整頁
  - 🔄 切換模式：雙語對照 / 直接替換
  - ⚙️ 設定（開啟 Options 頁面）
- 底部顯示當前語言 badge（藍色 pill）+ 模型 badge（灰色 monospace pill）

**狀態變化：**
- 待命：黑色 `#171717`，🌐 圖示
- 翻譯中：藍色 `#0072f5`，旋轉圖示 + 脈衝動畫
- 完成：綠色 `#17a34a`，✓ 圖示（3 秒後恢復待命）
- 錯誤：紅色 `#ef4444`，! 圖示

### 3.3 劃詞翻譯

**觸發冒泡：**
- 監聽 `mouseup` 事件
- 檢查 `window.getSelection()` 是否有選取文字
- 在選取範圍上方顯示小型翻譯按鈕：黑色 pill（`#171717`），「🌐 翻譯」文字
- `border-radius: 8px`，底部三角箭頭指向選取區域

**翻譯結果卡片：**
- 點擊冒泡按鈕後，替換為白色結果卡片
- 寬 320px，`border-radius: 12px`
- Shadow: `rgba(0,0,0,0.08) 0px 0px 0px 1px, 0 8px 30px rgba(0,0,0,0.12)`
- 頂部：藍色 `翻譯結果` 標籤 + ✕ 關閉按鈕
- 中間：翻譯結果文字（支援串流逐字顯示）
- 底部：模型名稱 + 耗時資訊（monospace 灰色）+ 📋 複製按鈕

**關閉行為：**
- 點擊 ✕ 按鈕
- 點擊頁面其他位置
- 按 Escape 鍵

### 3.4 整頁翻譯

#### 3.4.1 智慧內容偵測

擷取頁面正文段落的策略：

1. 優先使用 `<article>`、`<main>`、`[role="main"]` 定位主要內容區域
2. 在內容區域中選取翻譯目標：`p`, `h1-h6`, `li`, `td`, `th`, `blockquote`, `figcaption`
3. 排除非正文元素：`nav`, `header`, `footer`, `aside`, `script`, `style`, `code`, `pre`, `[aria-hidden]`
4. 排除過短文字（< 5 字元）和純數字/符號
5. 如果找不到 `<article>` 或 `<main>`，fallback 到 `document.body` 但加強過濾

#### 3.4.2 雙語對照模式

- 在每個原文段落下方插入譯文區塊
- 譯文區塊樣式：
  - `background: #fafafa`
  - `border-left: 3px solid #0072f5`
  - `border-radius: 0 8px 8px 0`
  - `padding: 10px 14px`
  - `margin-top: 4px`
  - `font-size` 與原文相同
  - `color: #4d4d4d`（比原文稍淡）
- 左上角小型藍色標籤顯示目標語言名稱
- 載入中狀態：shimmer 動畫骨架屏

#### 3.4.3 直接替換模式

- 儲存原文到 `data-original-text` attribute
- 替換段落文字內容為譯文
- 不顯示「已翻譯」tag（懸浮球狀態即可表示）
- hover 段落時顯示原文 tooltip（可選）
- 懸浮球選單增加「顯示原文」還原按鈕，一鍵恢復所有原文

#### 3.4.4 翻譯執行策略

- 逐段落呼叫 API（非整頁一次送出）
- 使用 SSE streaming，翻譯結果逐 token 顯示
- 並行度限制：同時最多 3 個段落在翻譯
- 翻譯順序：從視窗可見區域開始，向下延伸

#### 3.4.5 翻譯快取

- 以 `URL + 段落文字 hash + 目標語言 + 模型` 為 key
- 儲存在 `chrome.storage.local`（容量較大）
- 同頁面重新翻譯時直接使用快取，不重複呼叫 API
- 可在設定中清除快取

---

## 4. Options 頁面

### 4.1 頁面結構

單頁設定，垂直滾動，最大寬度 720px 置中。

**區塊順序：**
1. API 供應商（供應商列表 + 新增表單）
2. 翻譯模型（供應商選擇 → 模型網格）
3. 翻譯偏好（目標語言、預設翻譯模式）
4. 顯示設定（toggle 開關群組）
5. 快捷鍵

### 4.2 自訂下拉選單元件

所有下拉選單使用自訂 CSS dropdown，不使用瀏覽器原生 `<select>`：

- 觸發器：模擬 select 外觀，右側自訂箭頭 SVG
- 下拉面板：`position: absolute`，白色背景
- Shadow: `rgba(0,0,0,0.08) 0px 0px 0px 1px, 0 8px 30px rgba(0,0,0,0.12)`
- `border-radius: 8px`
- 選項 hover 背景 `#f5f5f5`
- 已選取項目前方 ✓ 標記
- 支援鍵盤導航（上下鍵、Enter、Escape）

### 4.3 語言選擇器

- 使用自訂 dropdown + 搜尋篩選功能
- 頂部內建搜尋輸入框，即時篩選語言列表
- 語言列表包含完整 IETF language tags（100+ 語言）
- 顯示格式：`繁體中文 (zh-TW)` — 本地名稱 + 語言代碼
- 常用語言置頂（繁體中文、簡體中文、英文、日文、韓文）
- 分隔線後為完整字母排序列表

### 4.4 設計系統套用

完整套用 DESIGN.md 中的 Vercel 設計規範：

- **字型**：Inter（Geist 替代，同為幾何無襯線體）
- **色彩**：`#171717` 主色、`#4d4d4d` 次要文字、`#666` 說明文字
- **邊框**：shadow-as-border `rgba(0,0,0,0.08) 0px 0px 0px 1px`
- **圓角**：6px 按鈕、8px 卡片、12px 大容器、9999px pill badge
- **按鈕**：Primary 黑底白字、Secondary 白底 shadow-border、Ghost 透明
- **Focus ring**：`2px solid hsla(212, 100%, 48%, 1)`
- **Toggle 開關**：自訂實作，on 狀態 `#171717`
- **字重**：400 內文、500 互動元素、600 標題

---

## 5. Manifest V3 設定

```json
{
  "manifest_version": 3,
  "name": "ChatGPT Translator",
  "version": "2.0",
  "description": "沉浸式 AI 翻譯 — 支援 OpenAI、Ollama、LM Studio 等",
  "permissions": ["storage", "activeTab"],
  "host_permissions": [
    "https://api.openai.com/*",
    "http://localhost:*/*",
    "https://*/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": []
    }
  ],
  "options_page": "options.html",
  "action": {
    "default_icon": "translation.png"
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
  }
}
```

### 5.1 權限說明

- `storage`：儲存設定和翻譯快取
- `activeTab`：取得當前頁面資訊
- `http://localhost:*/*`：存取本地模型服務（Ollama、LM Studio）
- `https://*/*`：存取遠端 API 端點（OpenAI、Groq 等），以及在任何網頁注入 Content Script

---

## 6. 快捷鍵

| 快捷鍵 | 功能 |
|--------|------|
| `Alt+T` | 翻譯整頁 |
| `Alt+Q` | 翻譯選取文字 |
| `Alt+M` | 切換翻譯模式（雙語 ↔ 替換） |
| `Alt+B` | 顯示/隱藏懸浮球 |

`Alt+T` 和 `Alt+Q` 透過 `manifest.json` 的 `commands` 註冊為全域快捷鍵。`Alt+M` 和 `Alt+B` 在 Content Script 中透過 `keydown` 監聽實作。

---

## 7. 翻譯 Prompt 設計

```
System: You are a professional translator. Translate the following text to {targetLanguage}. 
Only output the translation, no explanations or notes.

User: {text}
```

- 使用 `system` + `user` 雙角色格式
- `temperature: 0.3`（低溫度確保翻譯一致性）
- `max_tokens` 根據原文長度動態設定（原文 token 數 × 2）

---

## 8. 檔案結構

```
ChatGPT-Translator/
├── manifest.json
├── background.js          # Service Worker
├── content.js             # Content Script 主邏輯
├── content.css            # Shadow DOM 內樣式
├── options.html           # 設定頁面 HTML
├── options.js             # 設定頁面邏輯
├── options.css            # 設定頁面樣式
├── language-data.js       # 完整 i18n 語言列表
├── components/
│   ├── dropdown.js        # 自訂下拉選單元件
│   ├── toggle.js          # Toggle 開關元件
│   └── toast.js           # Toast 通知元件
├── utils/
│   ├── api-client.js      # OpenAI 相容 API 呼叫
│   ├── content-detector.js # 智慧內容偵測
│   ├── cache.js           # 翻譯快取管理
│   └── storage.js         # chrome.storage 封裝
├── translation.png        # 擴展圖示
├── DESIGN.md              # 設計系統規範
└── README.md
```

---

## 9. 不在範圍內

以下功能不包含在此版本中：

- 翻譯歷史記錄
- 每個網站獨立翻譯規則
- 輸入框即時翻譯
- 影片字幕翻譯
- PDF / 電子書翻譯
- 右鍵選單整合
- OpenAI OAuth（未開放第三方）
- 暗色模式（可作為後續版本）
