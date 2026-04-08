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
