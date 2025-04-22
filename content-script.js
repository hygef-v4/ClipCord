// content-script.js
(async () => {
  console.log("ClipCord: started");

  function sendMessage(msg) {
    chrome.runtime.sendMessage(msg);
  }

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
    const step  = window.innerHeight * 0.8;
    let lastY = -1, stuck=0;
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

    // 3a) Inline <video> tags
    document.querySelectorAll("video").forEach(v => {
      const src = v.src || v.querySelector("source")?.src;
      if (src) urls.add(src);
    });

    // 3b) Attachment links ending in a video extension (with optional query)
    const videoExt = /\.(mp4|webm|mkv|avi|mov)(?:\?|$)/i;
    document
      .querySelectorAll('a[href*="cdn.discordapp.com/attachments/"]')
      .forEach(a => {
        const u = a.href;
        if (videoExt.test(u)) urls.add(u);
      });

    if (urls.size === 0) {
      alert("No video clips found.");
      return;
    }

    console.log(`Found ${urls.size} clips`);
    sendMessage({ type: "DISCORD_CLIP_URLS", urls: Array.from(urls) });
  }
  catch (err) {
    console.error("Error in content script:", err);
    alert("Error scanning clips:\n" + err.message);
    sendMessage({ type: "CONTENT_SCRIPT_ERROR", message: err.message });
  }
})();