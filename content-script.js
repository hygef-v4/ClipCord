// content-script.js
(() => {
  chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
    if (msg.type === "START_SCAN") {
      const scanType = msg.scanType || "video";
      try {
        // 1) Scroll container lookup
        const container =
          document.querySelector('div[class^="scrollerInner-"] > div[class^="messagesWrapper-"]') ||
          document.querySelector('main div[class^="scroller-"]') ||
          document.querySelector('div[class*="chatContent-"]') ||
          document.querySelector('[aria-label*="Messages"]') ||
          document.scrollingElement;
        if (!container) throw new Error("No scroll container found.");

        // 2) Scroll to bottom to load everything
        const pause = ms => new Promise(r => setTimeout(r, ms));
        const step = window.innerHeight * 0.8;
        let lastY = -1, stuck = 0;
        while (true) {
          container.scrollTo(0, container.scrollTop + step);
          await pause(400);
          const y = container.scrollTop;
          if (y === lastY) {
            if (++stuck >= 4) break;
          } else {
            stuck = 0;
          }
          lastY = y;
          if (y + container.clientHeight >= container.scrollHeight - 10) break;
        }
        container.scrollTo({ top: 0, behavior: "auto" });

        // 3) Scrape URLs
        const urls = new Set();
        const videoExt = /\.(mp4|webm|mkv|avi|mov)(?:\?|$)/i;
        const imageExt = /\.(png|jpe?g|gif|webp|bmp|svg)(?:\?|$)/i;

        if (scanType === "video") {
          document.querySelectorAll("video").forEach(v => {
            const src = v.src || v.querySelector("source")?.src;
            if (src && videoExt.test(src)) urls.add(src);
          });
          document
            .querySelectorAll('a[href*="cdn.discordapp.com/attachments/"]')
            .forEach(a => {
              const u = a.href;
              if (videoExt.test(u)) urls.add(u);
            });
        } else if (scanType === "image") {
          document.querySelectorAll("img").forEach(img => {
            const src = img.src;
            if (src && imageExt.test(src)) urls.add(src);
          });
          document
            .querySelectorAll('a[href*="cdn.discordapp.com/attachments/"]')
            .forEach(a => {
              const u = a.href;
              if (imageExt.test(u)) urls.add(u);
            });
        }

        if (urls.size === 0) {
          sendResponse({ status: "empty" });
          return true;
        }

        sendResponse({ status: "success", urls: Array.from(urls) });
      } catch (err) {
        sendResponse({ status: "error", message: err.message });
      }
      return true;
    }
  });
})();
