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
    fabEl.textContent = '\u{1F310}';
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

    const mode = settings.translationMode === 'bilingual' ? '\u96D9\u8A9E\u5C0D\u7167' : '\u76F4\u63A5\u66FF\u63DB';

    menuEl.innerHTML = `
      <button class="translator-menu-item" data-action="translatePage">
        <span class="icon">\u{1F4C4}</span> \u7FFB\u8B6F\u6574\u9801
      </button>
      <button class="translator-menu-item" data-action="toggleMode">
        <span class="icon">\u{1F504}</span> \u5207\u63DB\u6A21\u5F0F\uFF1A${mode}
      </button>
      <button class="translator-menu-item" data-action="restoreOriginal">
        <span class="icon">\u21A9\uFE0F</span> \u986F\u793A\u539F\u6587
      </button>
      <div class="translator-menu-divider"></div>
      <button class="translator-menu-item" data-action="openSettings">
        <span class="icon">\u2699\uFE0F</span> \u8A2D\u5B9A
      </button>
      <div class="translator-menu-footer">
        <span class="badge-lang">${getLangName(settings.targetLanguage)}</span>
        <span class="badge-model">${settings.activeModelId || '\u672A\u9078\u64C7'}</span>
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
        fabEl.textContent = '\u27F3';
        break;
      case 'done':
        fabEl.classList.add('done');
        fabEl.textContent = '\u2713';
        setTimeout(() => setFabState('idle'), 3000);
        break;
      case 'error':
        fabEl.classList.add('error');
        fabEl.textContent = '!';
        setTimeout(() => setFabState('idle'), 5000);
        break;
      default:
        fabEl.textContent = '\u{1F310}';
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
    selectionBtnEl.innerHTML = '\u{1F310} \u7FFB\u8B6F';
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
        <span class="translator-result-label">\u7FFB\u8B6F\u7D50\u679C</span>
        <button class="translator-result-close">\u2715</button>
      </div>
      <div class="translator-result-body">\u7FFB\u8B6F\u4E2D...</div>
      <div class="translator-result-footer">
        <span class="translator-result-meta"></span>
        <button class="translator-copy-btn hidden">\u{1F4CB} \u8907\u88FD</button>
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
        metaEl.textContent = msg.fromCache ? '\u5FEB\u53D6' : `${msg.model} \u00B7 ${msg.elapsed}s`;
        copyBtn.classList.remove('hidden');
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(msg.fullText);
          copyBtn.textContent = '\u2713 \u5DF2\u8907\u88FD';
          setTimeout(() => { copyBtn.textContent = '\u{1F4CB} \u8907\u88FD'; }, 1500);
        });
      } else if (msg.type === 'error') {
        bodyEl.textContent = `\u932F\u8AA4\uFF1A${msg.error}`;
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
            console.error('\u7FFB\u8B6F\u5143\u7D20\u5931\u6557:', e);
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
              block.innerHTML = `<span style="color:#ef4444;">\u7FFB\u8B6F\u5931\u6557\uFF1A${msg.error}</span>`;
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
