// content-script.js
(async () => {
    console.log("📥 Discord Clip Downloader: content script started");
  
    function sendMessage(msg) {
      try {
        chrome.runtime.sendMessage(msg);
      } catch (err) {
        console.error("✖️ Failed to send message:", err);
      }
    }
  
    try {
      // 1) Find the scroll container
      const container =
        document.querySelector('div[class^="scrollerInner-"] > div[class^="messagesWrapper-"]') ||
        document.querySelector('main div[class^="scroller-"]') ||
        document.querySelector('div[class*="chatContent-"]') ||
        document.querySelector('[aria-label*="Messages"]') ||
        document.scrollingElement;
  
      if (!container) {
        throw new Error("Could not find a scrollable Discord message container.");
      }
      console.log("✅ Scroll container:", container);
  
      // 2) Scroll through it to lazy‑load everything
      const pause = ms => new Promise(res => setTimeout(res, ms));
      const step = window.innerHeight * 0.8;      // scroll by 80% of viewport
      let lastY = -1, stuckCount = 0;
  
      while (true) {
        // collect in each iteration (so we don't miss anything mid‑scroll)
        container.scrollTo(0, container.scrollTop + step);
        await pause(400);
  
        // break if we've reached the bottom or we can't scroll further
        const newY = container.scrollTop;
        if (newY === lastY) {
          stuckCount++;
          if (stuckCount >= 4) break;
        } else {
          stuckCount = 0;
        }
        lastY = newY;
        if (newY + container.clientHeight >= container.scrollHeight - 10) {
          console.log("▶️ Reached bottom of scroll");
          break;
        }
      }
  
      // optional: scroll back up for neatness
      container.scrollTo({ top: 0, behavior: "auto" });
  
      // 3) Scrape URLs
      const urls = new Set();
  
      // 3a) Inline <video> URLs (mp4/webm)
      document.querySelectorAll("video").forEach(v => {
        const src = v.src || v.querySelector("source")?.src;
        if (src) urls.add(src);
      });
  
      // 3b) All “Download” anchors (covers mkv, avi, etc)
      document
        .querySelectorAll('a[aria-label^="Download"]')
        .forEach(a => {
          if (a.href) urls.add(a.href);
        });
  
      // 3c) Any attachment URL ending in a video extension
      document
        .querySelectorAll('a[href*="cdn.discordapp.com/attachments/"]')
        .forEach(a => {
          const u = a.href;
          if (/\.(mp4|webm|mkv|avi|mov)$/i.test(u)) {
            urls.add(u);
          }
        });
  
      if (urls.size === 0) {
        alert("⚠️ No video clips found on this page.");
        return;
      }
  
      console.log(`📥 Found ${urls.size} clip URLs`);
      sendMessage({
        type: "DISCORD_CLIP_URLS",
        urls: Array.from(urls)
      });
    }
    catch (err) {
      console.error("🛑 Content script failed:", err);
      alert("Error in clip‐scraper: " + err.message);
      sendMessage({
        type: "CONTENT_SCRIPT_ERROR",
        message: err.message
      });
    }
  })();
  