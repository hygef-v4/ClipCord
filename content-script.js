// Wrap in an async IIFE (Immediately Invoked Function Expression)
(async () => {
    console.log("Discord Clip Downloader: Content script activated.");

    // Function to send messages back to the background script
    function sendMessage(message) {
        try {
            chrome.runtime.sendMessage(message);
        } catch (error) {
            // This might happen if the extension context is invalidated (e.g., update/reload)
            console.error("Content Script: Failed to send message:", error);
        }
    }

    try {
        // 1) Find Discord’s message‐scroll container
        // More robust selector targeting the main scrollable area for messages
        const container = document.querySelector('div[class^="scrollerInner-"] > div[class^="messagesWrapper-"]')
                       || document.querySelector('main div[class^="scroller-"]') // More general fallback
                       || document.querySelector('[aria-label*="Messages"]') // Accessibility attribute
                       || document.scrollingElement; // Last resort: document body

        if (!container || container === document.scrollingElement) {
             console.warn('Could not find the primary message scroller. Using document scroll. This might be less reliable.');
             // If using document.scrollingElement, ensure height/scroll works as expected
             if (!container) {
                 throw new Error('Couldn’t find any scrollable container.');
             }
        }

        // --- Scrolling and Scraping Logic ---
        const urls = new Set();
        const step = window.innerHeight * 0.8; // Scroll slightly less than full height
        const pause = ms => new Promise(r => setTimeout(r, ms));
        const scrollAttempts = 5; // Max attempts to scroll down further if height hasn't changed
        let lastScrollHeight = -1;
        let attempts = 0;
        let currentScroll = 0;

        console.log("Starting scroll...");
        // Scroll to the top first to ensure we start consistently
        container.scrollTo(0, 0);
        await pause(500); // Pause after initial scroll top

        // Use scrollHeight for dynamic content loading
        while (true) {
            // Scroll down by one step
            container.scrollTo(0, container.scrollTop + step);
            await pause(400); // Increased pause for potentially slower loading

            // Collect video URLs after scrolling and pausing
            document.querySelectorAll('video').forEach(v => {
                // Prioritize the <source> tag's src if available
                const sourceSrc = v.querySelector('source')?.src;
                const videoSrc = v.src;
                const src = sourceSrc || videoSrc;
                // Ensure it's a valid URL (basic check)
                if (src && (src.startsWith('http:') || src.startsWith('https:') || src.startsWith('blob:'))) {
                    // Filter out potential non-clip sources if needed (e.g., background videos)
                    // For now, we assume all <video> tags with src are clips.
                    urls.add(src);
                }
            });

            const currentScrollHeight = container.scrollHeight;
            const currentScrollTop = container.scrollTop;
            const isAtBottom = currentScrollTop + container.clientHeight >= currentScrollHeight - 10; // Tolerance

            console.log(`Scrolled to: ${Math.round(currentScrollTop)}, Scroll Height: ${currentScrollHeight}, Found URLs: ${urls.size}`);


            if (isAtBottom) {
                 console.log("Reached approximate bottom.");
                 // Sometimes content loads slightly after reaching the bottom, do one last check
                 await pause(500);
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

             // Check if scroll height stopped increasing (might indicate end or loading issue)
            if (currentScrollHeight === lastScrollHeight) {
                attempts++;
                console.log(`Scroll height hasn't changed, attempt ${attempts}/${scrollAttempts}`);
                if (attempts >= scrollAttempts) {
                    console.warn("Scroll height stopped increasing. Assuming end of loadable content.");
                    break; // Exit loop if stuck
                }
            } else {
                attempts = 0; // Reset attempts if height changed
                lastScrollHeight = currentScrollHeight;
            }
        }

        // Scroll back up smoothly (optional, good UX)
        console.log("Scrolling back to top...");
        container.scrollTo({ top: 0, behavior: 'smooth' });

        console.log(`Found ${urls.size} unique video URLs.`);

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