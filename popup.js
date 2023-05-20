document.addEventListener('DOMContentLoaded', function() {
    var translateButton = document.getElementById('translate-button');
    var textToTranslate = document.getElementById('text-to-translate');
    var translationResult = document.getElementById('translation-result');
    var targetLanguage = document.getElementById('target-language');
    var apiKeyInput = document.getElementById('api-key');
    var rememberApiKey = document.getElementById('remember-api-key');
    var targetmodel = document.getElementById('target-model');
    var createAPIKey = document.getElementById("createAPIKey");
    var apiSource = document.querySelector('input[name="api-source"]:checked').value;
    if (apiSource === "openai") {
        createAPIKey.href = "https://platform.openai.com/account/api-keys";
    } else {
    createAPIKey.href = "https://github.com/PawanOsman/ChatGPT";
    }

    const select = document.getElementById('target-language');
    languageData.forEach((lang) => {
    const option = document.createElement('option');
    option.value = lang.code;
    option.textContent = lang.name;
    select.appendChild(option);
    });


    // Load saved API key if it exists
    chrome.storage.sync.get(['apiKey', 'rememberApiKey'], function(result) {
        if (result.apiKey) {
            apiKeyInput.value = result.apiKey;
        }
        if (result.rememberApiKey) {
            rememberApiKey.checked = result.rememberApiKey;
        }
    });

    document.addEventListener('change', function() {
        var createAPIKey = document.getElementById("createAPIKey");
        var apiSource = document.querySelector('input[name="api-source"]:checked').value;
        // Set the href of createAPIKey based on the selected apiSource
        if (apiSource === "openai") {
            createAPIKey.href = "https://platform.openai.com/account/api-keys";
        } else {
        createAPIKey.href = "https://github.com/PawanOsman/ChatGPT";
        }
      });

    async function translateText(apiKey, model, language, text, apiSource) {
      let endpoint;
      if (apiSource === "openai") {
          endpoint = "https://api.openai.com/v1/chat/completions";
      } else {
          endpoint = "https://api.pawan.krd/v1/chat/completions";
      }
  
      const data = JSON.stringify({
          "model": model,
          "messages": [{"role": "user", "content": `Translate to ${language}: { ${text} }` }]
      });
  
      const response = await fetch(endpoint, {
          method: "POST",
          headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + apiKey
          },
          body: data
      });
  
      if (response.ok) {
          const jsonResponse = await response.json();
          return jsonResponse.choices[0].message.content;
      } else {
          const error = await response.json();
          throw new Error(error.error.message);
      }
  }

    async function getProcessingTranslation(apiKey, model, language, apiSource) {
      const cacheKey = `processing-${language}-${apiSource}`;

      return new Promise((resolve, reject) => {
          chrome.storage.local.get(cacheKey, async function(result) {
              if (result[cacheKey]) {
                  resolve(result[cacheKey]);
              } else {
                  try {
                      const translatedText = await translateText(apiKey, model, language, "Processing...", apiSource);
                      const storageData = {};
                      storageData[cacheKey] = translatedText;
                      chrome.storage.local.set(storageData, function() {
                          resolve(translatedText);
                      });
                  } catch (error) {
                      reject(error);
                  }
              }
          });
      });
    }

    translateButton.addEventListener('click', async function() {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "https://api.pawan.krd/v1/chat/completions");
        xhr.setRequestHeader("Content-Type", "application/json");

        // Use saved API key
        var apiKey = apiKeyInput.value;
        xhr.setRequestHeader("Authorization", "Bearer " + apiKey);

        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    var response = JSON.parse(xhr.responseText);
                    var translation = response.choices[0].message.content;
                    translationResult.innerHTML = translation;
                } else {
                    var error = JSON.parse(xhr.responseText);
                    alert("Error: " + error.error.message);
                }
            }
        };

        var language = targetLanguage.value;
        var model = targetmodel.value;
        // 獲取 API 來源選項
        var apiSource = document.querySelector('input[name="api-source"]:checked').value;

        try {
            // 翻譯 "Processing..." 文字
            const processingText = await getProcessingTranslation(apiKey, model, language, apiSource);
            translationResult.innerHTML = processingText;

            // 翻譯實際內容
            const actualTranslation = await translateText(apiKey, model, language, textToTranslate.value, apiSource);

            // 清空 "處理中..." 文字
            translationResult.innerHTML = "";

            // 每50毫秒顯示1個字，1秒內顯示20個字
            let currentIndex = 0;
            const intervalId = setInterval(function() {
                translationResult.innerHTML += actualTranslation.charAt(currentIndex);
                currentIndex++;

                if (currentIndex >= actualTranslation.length) {
                    clearInterval(intervalId);
                }
            }, 10);
        } catch (error) {
            alert("Error: " + error.message);
        }
        // Save API key if "Remember API Key" is checked
        if (rememberApiKey.checked) {
            chrome.storage.sync.set({'apiKey': apiKeyInput.value, 'rememberApiKey': true});
        } else {
            chrome.storage.sync.remove(['apiKey', 'rememberApiKey']);
        }
    });
});