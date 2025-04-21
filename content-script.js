// Wrap in an async IIFE (Immediately Invoked Function Expression)
(async () => {
    console.log("Discord Clip Downloader: Content script activated.");

    // Function to send messages back to the background script
    function sendMessage(message) {
        try {
            // Content scripts don't expect responses, so just send.
            chrome.runtime.sendMessage(message);
        } catch (error) {
            // This might happen if the extension context is invalidated (e.g., update/reload)
            console.error("Content Script: Failed to send message:", error);
        }
    }

    try {
        // 1) Find Discord’s message‐scroll container
        const container = document.querySelector('div[class^="scrollerInner-"] > div[class^="messagesWrapper-"]') // Primary target
                       || document.querySelector('main div[class^="scroller-"]') // Alt layout
                       || document.querySelector('div[class*="chatContent-"]') // Another possible container
                       || document.querySelector('[aria-label*="Messages"]') // Accessibility fallback
                       || document.scrollingElement; // Last resort

        if (!container) {
             throw new Error('Could not find a suitable scrollable message container.');
        }
         if (container === document.scrollingElement) {
             console.warn('Using document scroll. This might be less reliable for finding all clips.');
         }

        console.log("Scroll container found:", container);

        // --- Scrolling and Scraping Logic ---
        const urls = new Set();
        const step = window.innerHeight * 0.8; // Scroll slightly less than full height
        const pauseMs = 450; // Time in milliseconds to wait for content loading after scroll
        const pause = ms => new Promise(r => setTimeout(r, ms));
        const maxScrollAttempts = 5; // Max attempts if scroll position doesn't change
        let lastScrollTop = -1;
        let attempts = 0;

        console.log("Starting scroll...");
        container.scrollTo({ top: 0, behavior: 'instant' }); // Start at the top
        await pause(500); // Initial pause

        let currentScrollHeight = container.scrollHeight;
        let currentScrollTop = container.scrollTop;

        // Scroll loop
        while (true) {
            // Collect videos in the current view first
             document.querySelectorAll('video').forEach(v => {
                const sourceSrc = v.querySelector('source')?.src;
                const videoSrc = v.src;
                const src = sourceSrc || videoSrc;
                if (src && (src.startsWith('http:') || src.startsWith('https:') || src.startsWith('blob:'))) {
                    urls.add(src);
                }
            });

            // Scroll down
            lastScrollTop = container.scrollTop;
            container.scrollTo(0, lastScrollTop + step);
            await pause(pauseMs);

            currentScrollTop = container.scrollTop;
            currentScrollHeight = container.scrollHeight; // Update height after potential loading

            console.log(`Scrolled to: ${Math.round(currentScrollTop)} / ${currentScrollHeight}, Found URLs: ${urls.size}`);

            // Check termination conditions
            const isAtBottom = currentScrollTop + container.clientHeight >= currentScrollHeight - 20; // Generous tolerance for bottom
            const stuck = Math.abs(currentScrollTop - lastScrollTop) < 10; // Didn't scroll much

            if (isAtBottom) {
                 console.log("Reached approximate bottom.");
                 await pause(pauseMs); // Final pause at bottom
                 // Final collection pass
                  document.querySelectorAll('video').forEach(v => {
                     const sourceSrc = v.querySelector('source')?.src;
                     const videoSrc = v.src;
                     const src = sourceSrc || videoSrc;
                      if (src && (src.startsWith('http:') || src.startsWith('https:'))) {
                         urls.add(src);
                     }
                  });
                 break; // Exit loop
            }

            if (stuck) {
                attempts++;
                console.log(`Scroll position seems stuck, attempt ${attempts}/${maxScrollAttempts}`);
                if (attempts >= maxScrollAttempts) {
                    console.warn("Scroll position stuck. Assuming end of loadable content or issue.");
                     // Collect one last time before breaking
                     document.querySelectorAll('video').forEach(v => {
                        const sourceSrc = v.querySelector('source')?.src;
                        const videoSrc = v.src;
                        const src = sourceSrc || videoSrc;
                         if (src && (src.startsWith('http:') || src.startsWith('https:'))) {
                            urls.add(src);
                        }
                     });
                    break; // Exit loop if stuck
                }
            } else {
                attempts = 0; // Reset attempts if scroll moved
            }
        } // End while loop

        // Scroll back up smoothly (optional, good UX)
        console.log("Scrolling back to top...");
        container.scrollTo({ top: 0, behavior: 'smooth' });

        console.log(`Finished scanning. Found ${urls.size} unique video URLs.`);

        // 3) Send the list of URLs back to the background script
        sendMessage({
            type: 'DISCORD_CLIP_URLS',
            urls: Array.from(urls)
        });

    } catch (error) {
        console.error('Content Script Error:', error);
        // Send error details back to the background script
        sendMessage({
            type: 'CONTENT_SCRIPT_ERROR',
            message: error.message || 'An unknown error occurred in the content script.'
        });
    }
})(); // Execute the async function