// --- Listener for messages from popup or content script ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("Background received message:", msg); // For debugging

    if (msg.type === 'START_SCAN' && msg.tabId) {
        const targetTabId = msg.tabId;
        // Inject the content script
        chrome.scripting.executeScript({
            target: { tabId: targetTabId },
            files: ['content-script.js']
        }, (injectionResults) => {
            if (chrome.runtime.lastError) {
                console.error("Script injection failed:", chrome.runtime.lastError.message);
                // Send error back to popup
                chrome.runtime.sendMessage({ type: 'SCAN_ERROR', message: chrome.runtime.lastError.message });
                // Don't send response via sendResponse here as we used chrome.runtime.sendMessage
                return; // Exit early
            }
            // If injection itself succeeded, we don't send success yet.
            // We wait for the content script to finish and send its results.
            console.log("Content script injected successfully.");
            // Acknowledge the START_SCAN message was received and injection attempted
            sendResponse({ status: 'injection_started' });
        });

        // Indicate that the response will be sent asynchronously.
        // This is crucial because executeScript is async, and we need to
        // wait for the content script to potentially send messages back later.
        // However, the immediate response to START_SCAN is just acknowledging the request.
        // The actual results come via a separate message ('DISCORD_CLIP_URLS').
        // So, returning true here might not be strictly necessary for the START_SCAN -> injection flow,
        // but it's essential for the overall message listener pattern if other async ops were present.
        // Let's return true for robustness.
        return true;

    } else if (msg.type === 'DISCORD_CLIP_URLS') {
        // This message comes from the content script
        console.log(`Background received ${msg.urls.length} URLs from content script.`);
        // Forward the results to the popup
        chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            urls: msg.urls
        }).catch(error => {
            // Catch error if popup is closed before message arrives
            console.log("Could not send SCAN_COMPLETE to popup (likely closed):", error.message);
        });
        // No sendResponse needed here as this is a message *received* from content script

    } else if (msg.type === 'CONTENT_SCRIPT_ERROR') {
        // This message comes from the content script if it encounters an error
         console.error("Error reported from content script:", msg.message);
         // Forward the error to the popup
         chrome.runtime.sendMessage({
             type: 'SCAN_ERROR',
             message: msg.message
         }).catch(error => {
            console.log("Could not send SCAN_ERROR to popup (likely closed):", error.message);
        });
       // No sendResponse needed here

    } else if (msg.type === 'DOWNLOAD_URLS' && msg.urls) {
        // This message comes from the popup
        console.log(`Background received request to download ${msg.urls.length} URLs.`);
        let downloadCount = 0;
        msg.urls.forEach((url, idx) => {
            try {
                // Basic filename extraction (can be improved)
                let filename = `DiscordClips/clip-${Date.now()}-${idx + 1}.mp4`; // Default
                try {
                    const urlObj = new URL(url);
                    const pathParts = urlObj.pathname.split('/');
                    const potentialFilename = pathParts.pop();
                    // Check if it looks like a real filename with extension
                    if (potentialFilename && potentialFilename.includes('.')) {
                         // Sanitize filename slightly (replace invalid chars)
                         const sanitized = potentialFilename.split('?')[0].replace(/[<>:"/\\|?*]/g, '_');
                         filename = `DiscordClips/${sanitized}`;
                    }
                } catch (e) {
                    console.warn("Could not parse URL for filename, using default:", url, e);
                }

                chrome.downloads.download({
                    url: url,
                    filename: filename, // Save into a subfolder
                    conflictAction: 'uniquify' // Append (1), (2), etc. if names conflict
                });
                downloadCount++;
            } catch (e) {
                console.error("Error initiating download for:", url, e);
                // Maybe notify popup of partial failure? For now, just log.
            }
        });
        console.log(`Initiated ${downloadCount} downloads.`);
        // Send confirmation back to popup
        sendResponse({ status: 'success', count: downloadCount });
    }

    // Return true if you intend to use sendResponse asynchronously.
    // In the DOWNLOAD_URLS case, sendResponse is synchronous.
    // In the START_SCAN case, sendResponse is synchronous, but the *real* result comes later.
    // In the DISCORD_CLIP_URLS / CONTENT_SCRIPT_ERROR case, we don't use sendResponse.
    // So, returning true is mainly needed for the START_SCAN path IF we considered executeScript's callback async for the *response*.
    // Let's keep 'return true' for the START_SCAN path just in case.
    if (msg.type === 'START_SCAN') {
      return true;
    }
});

// Optional: Log when the service worker starts (for debugging)
console.log("Background service worker started.");