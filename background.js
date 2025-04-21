// background.js
chrome.action.onClicked.addListener(tab => {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script.js']
    });
  });
  
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.type === 'DISCORD_CLIP_URLS') {
      msg.urls.forEach((url, idx) => {
        const filename = url.split('/').pop().split('?')[0] || `clip-${idx+1}.mp4`;
        chrome.downloads.download({
          url,
          filename: `DiscordClips/${filename}`,
          conflictAction: 'uniquify'
        });
      });
    }
  });
  