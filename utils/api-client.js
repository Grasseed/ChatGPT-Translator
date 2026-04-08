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
