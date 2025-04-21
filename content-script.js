// content-script.js
(async () => {
    // 1) Find Discord’s message‐scroll container
    const container = document.querySelector('div[class*="scrollerInner-"]')
                   || document.querySelector('[aria-label="Messages"]')
                   || document.scrollingElement;
    if (!container) {
      console.error('Couldn’t find the scrollable container. Adjust the selector.');
      return;
    }
  
    // 2) Scroll through, grabbing every <video> URL
    const urls = new Set();
    const step  = window.innerHeight;
    const pause = ms => new Promise(r => setTimeout(r, ms));
    for (let y = 0; y < container.scrollHeight; y += step) {
      container.scrollTo(0, y);
      await pause(300);  // allow Discord to lazy‐load
      document.querySelectorAll('video').forEach(v => {
        const src = v.src || v.querySelector('source')?.src;
        if (src) urls.add(src);
      });
    }
    // scroll back up
    container.scrollTo(0, 0);
  
    if (!urls.size) {
      alert('⚠️ No video clips found on this page.');
      return;
    }
  
    // 3) Send the list of URLs to background.js
    chrome.runtime.sendMessage({
      type: 'DISCORD_CLIP_URLS',
      urls: Array.from(urls)
    });
  })();
  