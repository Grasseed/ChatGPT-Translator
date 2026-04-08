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
