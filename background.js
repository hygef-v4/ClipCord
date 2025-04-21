// --- Helper: Generate Filename ---
function generateFilename(url) {
    let filename = `DiscordClips/clip-${Date.now()}.mp4`; // Secure default
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        let potentialFilename = pathParts.pop() || ''; // Ensure it's a string
        // Remove query string first
        potentialFilename = potentialFilename.split('?')[0];

        // Basic check for common video extensions - BE CAREFUL WITH REGEX
        const seemsValid = potentialFilename.length > 3 && potentialFilename.includes('.') && !potentialFilename.startsWith('.');
        // const seemsValid = /\.(mp4|webm|mov|avi|mkv|flv|wmv)$/i.test(potentialFilename); // Alternative stricter check

        if (potentialFilename && seemsValid) {
            // Sanitize filename (replace invalid characters) - Decode first!
            const decoded = decodeURIComponent(potentialFilename);
            const sanitized = decoded.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
             // Prevent excessively long filenames (optional)
             const MAX_LEN = 100;
             filename = `DiscordClips/${sanitized.substring(0, MAX_LEN)}`;
        } else {
             // Fallback if no valid name found in path
             filename = `DiscordClips/clip-${Date.now()}-${Math.random().toString(16).substring(2, 8)}.mp4`;
        }
    } catch (e) {
        console.warn("Could not parse URL for filename, using default:", url, e);
        // Use the secure default already set
    }
    // Ensure filename ends with a common video extension if possible, otherwise add .mp4
    if (!/\.(mp4|webm|mov|avi|mkv|flv|wmv)$/i.test(filename)) {
        filename += '.mp4';
    }
    return filename;
}

// --- Listener for messages from Popup or Content Script ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log(`Background received message: ${msg.type}`, msg);
    let messageHandledAsync = false; // Flag to indicate if sendResponse will be called asynchronously

    switch (msg.type) {
        case 'START_SCAN':
            if (msg.tabId) {
                const targetTabId = msg.tabId;
                console.log(`Attempting to inject content script into tab ${targetTabId}`);

                // Immediately acknowledge receipt before starting async operation
                // This helps prevent the "port closed" error for the START_SCAN message itself.
                sendResponse({ status: 'received' });

                // Inject the content script
                chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    files: ['content-script.js']
                }, (injectionResults) => {
                    // This callback runs LATER, AFTER sendResponse for 'received' has been sent.
                    if (chrome.runtime.lastError) {
                        console.error(`Script injection failed for tab ${targetTabId}:`, chrome.runtime.lastError.message);
                        // Send a *new* message to the popup indicating the error
                        chrome.runtime.sendMessage({ type: 'SCAN_ERROR', message: `Script injection failed: ${chrome.runtime.lastError.message}` })
                            .catch(e => console.log("Popup likely closed when sending SCAN_ERROR:", e.message));
                    } else {
                        console.log(`Content script injected successfully into tab ${targetTabId}. Waiting for results...`);
                        // Success here just means injection started. Results come via 'DISCORD_CLIP_URLS'.
                    }
                    // IMPORTANT: Do NOT call sendResponse here again for the original START_SCAN message.
                });

                // *** Crucial: Return true because executeScript's callback is asynchronous,
                // and the overall process initiated by START_SCAN will result in a later
                // message (SCAN_COMPLETE/SCAN_ERROR) being sent.
                messageHandledAsync = true;

            } else {
                console.error("START_SCAN message missing tabId");
                // Send synchronous error response
                sendResponse({ status: 'error', message: 'Missing tabId' });
                messageHandledAsync = false; // Synchronous response sent
            }
            break;

        case 'DISCORD_CLIP_URLS': // Message FROM content script
            console.log(`Background received ${msg.urls?.length ?? 0} URLs from content script.`);
            // Forward the results to the popup
            chrome.runtime.sendMessage({
                type: 'SCAN_COMPLETE',
                urls: msg.urls || [] // Ensure urls is always an array
            }).catch(error => {
                console.log("Could not send SCAN_COMPLETE to popup (likely closed):", error.message);
            });
            // No sendResponse needed here (message from content script, not popup requesting response)
            // No need to return true
            break;

        case 'CONTENT_SCRIPT_ERROR': // Message FROM content script
            console.error("Error reported from content script:", msg.message);
             // Forward the error to the popup
             chrome.runtime.sendMessage({
                 type: 'SCAN_ERROR',
                 message: msg.message || 'Unknown error in content script.'
             }).catch(error => {
                console.log("Could not send SCAN_ERROR to popup (likely closed):", error.message);
            });
            // No sendResponse needed here
            break;

        case 'DOWNLOAD_SINGLE_URL': // Message FROM popup
            if (msg.url) {
                const downloadUrl = msg.url;
                const filename = generateFilename(downloadUrl);
                console.log(`Initiating single download: ${downloadUrl} as ${filename}`);
                try {
                    chrome.downloads.download({
                        url: downloadUrl,
                        filename: filename,
                        conflictAction: 'uniquify'
                    }, (downloadId) => {
                        // This callback is asynchronous
                        if (chrome.runtime.lastError) {
                            console.error(`Single download failed for ${filename}:`, chrome.runtime.lastError.message);
                            sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
                        } else if (downloadId !== undefined) { // Check if downloadId is defined (0 is valid)
                            console.log(`Single download ${downloadId} started successfully.`);
                            sendResponse({ status: 'success' });
                        } else {
                            // This case might occur if the download is disallowed by policy, etc.
                            console.error(`Single download failed for ${filename}: No downloadId returned and no error.`);
                            sendResponse({ status: 'error', message: 'Download initiation failed (no ID).' });
                        }
                    });
                    messageHandledAsync = true; // Indicate async response via download callback
                } catch (e) {
                    console.error("Error calling chrome.downloads.download (single):", e);
                    // Send synchronous error response if the call itself fails
                    sendResponse({ status: 'error', message: `Download error: ${e.message}` });
                    messageHandledAsync = false;
                }
            } else {
                console.error("DOWNLOAD_SINGLE_URL message missing URL");
                sendResponse({ status: 'error', message: 'Missing URL' });
            }
            break;

        case 'DOWNLOAD_ALL_URLS': // Message FROM popup
            if (msg.urls && Array.isArray(msg.urls) && msg.urls.length > 0) {
                const urlsToDownload = msg.urls;
                let initiatedCount = 0;
                let errorCount = 0;
                console.log(`Initiating bulk download for ${urlsToDownload.length} URLs.`);

                urlsToDownload.forEach((url, index) => {
                    if (!url) {
                        console.warn(`Skipping invalid URL at index ${index}`);
                        errorCount++;
                        return; // Skip this iteration
                    }
                    try {
                        const filename = generateFilename(url);
                         // Fire and forget for simplicity in bulk downloads
                        chrome.downloads.download({
                            url: url,
                            filename: filename,
                            conflictAction: 'uniquify'
                        }, (downloadId) => {
                            // Optional: Log individual start/fail within the loop's async callback
                             if (chrome.runtime.lastError) {
                                console.warn(`Bulk download item failed (${filename}): ${chrome.runtime.lastError.message}`);
                             } else if (downloadId !== undefined) {
                                // console.log(`Bulk download item ${downloadId} started.`);
                             } else {
                                 console.warn(`Bulk download item failed (${filename}): No ID/error.`);
                             }
                        });
                        initiatedCount++;
                    } catch (e) {
                        console.error(`Error initiating download for URL #${index} (${url}):`, e);
                        errorCount++;
                    }
                });

                console.log(`Initiated ${initiatedCount} downloads, encountered ${errorCount} errors during initiation.`);
                // Send a single response back immediately after *attempting* to initiate all.
                if (initiatedCount > 0) {
                     sendResponse({ status: 'success', count: initiatedCount });
                } else {
                     sendResponse({ status: 'error', message: `Failed to initiate any downloads (${errorCount} errors).` });
                }
                messageHandledAsync = false; // Synchronous response sent after loop

            } else {
                console.error("DOWNLOAD_ALL_URLS message missing or invalid URLs array");
                sendResponse({ status: 'error', message: 'Invalid URLs provided.' });
            }
            break;

        default:
             console.log("Background received unhandled message type:", msg.type);
             // Optional: sendResponse({ status: 'error', message: 'Unhandled message type' });
             break;
    }

    // Return true IF any case set the async flag, otherwise return false/undefined.
    // This tells Chrome to keep the message channel open for sendResponse in async callbacks.
    return messageHandledAsync;
});

// Log when the service worker starts/restarts (for debugging)
chrome.runtime.onStartup.addListener(() => {
  console.log("Extension started on browser startup.");
});
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`Extension installed/updated (${details.reason}). Version: ${chrome.runtime.getManifest().version}`);
});
console.log("Background service worker started (v1.4 - Async Fix).");