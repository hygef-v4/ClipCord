(async()=>{
    // 1) Find Discord’s message‐scroll container (fallback to window if it fails)
    const container = document.querySelector('div[class*="scrollerInner-"]') 
                   || document.querySelector('[aria-label="Messages"]') 
                   || document.scrollingElement;
  
    if (!container) {
      return console.error('Couldn’t find the scrollable container. Inspect your DOM and adjust the selector.');
    }
  
    const urls = new Set();
    const step = window.innerHeight;       // scroll by one viewport at a time
    const pause = ms => new Promise(r => setTimeout(r, ms));
  
    // 2) Scroll through the whole thing, grabbing <video> URLs as they appear
    for (let y = 0; y < container.scrollHeight; y += step) {
      container.scrollTo(0, y);
      await pause(300);  // give Discord time to lazy‑load/react
      document.querySelectorAll('video').forEach(v => {
        const src = v.src || (v.querySelector('source')||{}).src;
        if (src) urls.add(src);
      });
    }
    // scroll back to top
    container.scrollTo(0, 0);
  
    console.log(`Found ${urls.size} videos; starting downloads…`);
  
    // 3) Download each one sequentially, naming them BlueBox_S01E01_1.mp4, _2.mp4, …
    let i = 1;
    for (const url of urls) {
      const a = document.createElement('a');
      a.href = url;
      a.download = `BlueBox_S01E01_${i++}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      await pause(200);  // slight throttle so the browser can keep up
    }
  })();
  

  