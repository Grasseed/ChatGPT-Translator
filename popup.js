document.addEventListener('DOMContentLoaded', function() {
    var translateButton = document.getElementById('translate-button');
    var textToTranslate = document.getElementById('text-to-translate');
    var translationResult = document.getElementById('translation-result');
    var targetLanguage = document.getElementById('target-language');
    var apiKeyInput = document.getElementById('api-key');
    var rememberApiKey = document.getElementById('remember-api-key');
    var targetmodel = document.getElementById('target-model');

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

    translateButton.addEventListener('click', function() {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "https://api.openai.com/v1/chat/completions");
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
        var data = JSON.stringify({
            "model": model,
            "messages": [{"role": "user", "content": "Translate to " + language + ": {"+ textToTranslate.value + " }"}]
        });

        xhr.send(data);

        // Save API key if "Remember API Key" is checked
        if (rememberApiKey.checked) {
            chrome.storage.sync.set({'apiKey': apiKeyInput.value, 'rememberApiKey': true});
        } else {
            chrome.storage.sync.remove(['apiKey', 'rememberApiKey']);
        }
    });
});