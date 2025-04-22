// --- Helper: Sanitize Folder Name ---
// Removes potentially problematic characters for filenames/paths
function sanitizeFolderName(name) {
    if (!name || typeof name !== 'string') {
        return 'InvalidFolderName'; // Fallback for non-strings
    }
    // Remove leading/trailing whitespace/dots/slashes
    let sanitized = name.trim().replace(/^[./\\ ]+/, '').replace(/[./\\ ]+$/, '');
    // Replace invalid characters with underscore
    sanitized = sanitized.replace(/[<>:"/\\|?*~]/g, '_'); // Added ~ just in case
    // Prevent ".." path traversal attempts (simple version)
    sanitized = sanitized.replace(/\.\./g, '_');
    // Limit length (optional)
    const MAX_LEN = 50;
    sanitized = sanitized.substring(0, MAX_LEN);
    // Ensure it's not empty after sanitization
    return sanitized || 'SanitizedFolderName';
}

// --- Helper: Generate Base Filename (Removed folder prefix) ---
function generateBaseFilename(url) {
    // Default base name
    let baseFilename = `clip-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`;
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        let potentialFilename = pathParts.pop() || '';
        potentialFilename = potentialFilename.split('?')[0]; // Remove query string

        // Basic check for filename validity
        const seemsValid = potentialFilename.length > 1 && potentialFilename.includes('.') && !potentialFilename.startsWith('.');

        if (potentialFilename && seemsValid) {
            const decoded = decodeURIComponent(potentialFilename);
            // Sanitize the *filename part* (different from folder sanitization)
            const sanitizedFilename = decoded.replace(/[<>:"/\\|?*]/g, '_');
            // Limit length (optional)
            const MAX_FILENAME_LEN = 100;
            baseFilename = sanitizedFilename.substring(0, MAX_FILENAME_LEN);
        }
    } catch (e) {
        console.warn("Could not parse URL for base filename, using default:", url, e);
    }
    // Ensure filename ends with a common video or image extension if possible
    const extMatch = url.match(/\.(mp4|webm|mkv|avi|mov|flv|wmv|png|jpe?g|gif|webp|bmp|svg)(\?|$)/i);
    if (extMatch && extMatch[1]) {
        const detectedExt = `.${extMatch[1].toLowerCase()}`;
        if (!baseFilename.toLowerCase().endsWith(detectedExt)) {
            baseFilename = baseFilename.replace(/\.[^.]+$/, '') + detectedExt;
        }
    } else if (!/\.(mp4|webm|mkv|avi|mov|flv|wmv|png|jpe?g|gif|webp|bmp|svg)$/i.test(baseFilename)) {
        baseFilename += '.mp4'; // Final fallback extension (for unknown types)
    }

    return baseFilename;
}

// --- Listener for messages ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log(`Background received message: ${msg.type}`, msg);
    let messageHandledAsync = false; // Flag to indicate if sendResponse will be called asynchronously

    switch (msg.type) {
        case 'START_SCAN':
            if (msg.tabId) {
                const targetTabId = msg.tabId;
                console.log(`Attempting to inject content script into tab ${targetTabId}`);

                // Immediately acknowledge receipt before starting async operation
                sendResponse({ status: 'received' });

                // Inject the content script
                chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    files: ['content-script.js']
                }, (injectionResults) => {
                    // This callback runs LATER
                    if (chrome.runtime.lastError) {
                        console.error(`Script injection failed for tab ${targetTabId}:`, chrome.runtime.lastError.message);
                        // Send a *new* message to the popup indicating the error
                        chrome.runtime.sendMessage({ type: 'SCAN_ERROR', message: `Script injection failed: ${chrome.runtime.lastError.message}` })
                            .catch(e => console.log("Popup likely closed when sending SCAN_ERROR:", e.message));
                    } else {
                        console.log(`Content script injected successfully into tab ${targetTabId}. Waiting for results...`);
                        // Success here just means injection started.
                    }
                    // Do NOT call sendResponse here again
                });

                // Crucial: Return true because executeScript's callback is async
                messageHandledAsync = true;

            } else {
                console.error("START_SCAN message missing tabId");
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
            // No sendResponse needed here
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
            if (msg.url && typeof msg.folder === 'string') { // Check type of folder
                const downloadUrl = msg.url;
                const rawFolderName = msg.folder;
                const sanitizedFolderName = sanitizeFolderName(rawFolderName); // Sanitize folder
                const baseFilename = generateBaseFilename(downloadUrl);        // Get base name
                const fullDownloadPath = `${sanitizedFolderName}/${baseFilename}`; // Combine path

                console.log(`Initiating single download: ${downloadUrl} as ${fullDownloadPath}`);
                try {
                    chrome.downloads.download({
                        url: downloadUrl,
                        filename: fullDownloadPath, // Use combined path
                        conflictAction: 'uniquify'
                    }, (downloadId) => {
                        // This callback is asynchronous
                        if (chrome.runtime.lastError) {
                            console.error(`Single download failed for ${fullDownloadPath}:`, chrome.runtime.lastError.message);
                            sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
                        } else if (downloadId !== undefined) { // Check if downloadId is defined (0 is valid)
                            console.log(`Single download ${downloadId} started successfully.`);
                            sendResponse({ status: 'success' });
                        } else {
                            console.error(`Single download failed for ${fullDownloadPath}: No downloadId returned and no error.`);
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
                console.error("DOWNLOAD_SINGLE_URL message missing URL or Folder Name (or folder is not a string)");
                sendResponse({ status: 'error', message: 'Missing URL or Invalid Folder Name' });
            }
            break;

        case 'DOWNLOAD_ALL_URLS': // Message FROM popup
            if (msg.urls && Array.isArray(msg.urls) && msg.urls.length > 0 && typeof msg.folder === 'string') { // Check folder type
                const urlsToDownload = msg.urls;
                const rawFolderName = msg.folder;
                const sanitizedFolderName = sanitizeFolderName(rawFolderName); // Sanitize once
                let initiatedCount = 0;
                let errorCount = 0;
                console.log(`Initiating bulk download for ${urlsToDownload.length} URLs into folder "${sanitizedFolderName}".`);

                urlsToDownload.forEach((url, index) => {
                    if (!url || typeof url !== 'string') {
                        console.warn(`Skipping invalid URL at index ${index}:`, url);
                        errorCount++;
                        return; // Skip this iteration
                    }
                    try {
                        const baseFilename = generateBaseFilename(url); // Get base name
                        const fullDownloadPath = `${sanitizedFolderName}/${baseFilename}`; // Combine path
                        // Fire and forget for simplicity in bulk downloads
                        chrome.downloads.download({
                            url: url,
                            filename: fullDownloadPath, // Use combined path
                            conflictAction: 'uniquify'
                        }, (downloadId) => {
                            // Optional: Log individual start/fail within the loop's async callback
                            if (chrome.runtime.lastError) {
                                console.warn(`Bulk download item failed (${fullDownloadPath}): ${chrome.runtime.lastError.message}`);
                            } else if (downloadId !== undefined) {
                                // console.log(`Bulk download item ${downloadId} started.`);
                            } else {
                                console.warn(`Bulk download item failed (${fullDownloadPath}): No ID/error.`);
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
                console.error("DOWNLOAD_ALL_URLS message missing/invalid URLs array or Folder Name (or folder is not a string)");
                sendResponse({ status: 'error', message: 'Invalid URLs array or Folder Name' });
            }
            break;

        default:
            console.log("Background received unhandled message type:", msg.type);
            // Optional: sendResponse({ status: 'error', message: 'Unhandled message type' });
            break;
    }

    // Return true IF any case set the async flag, otherwise return false/undefined.
    return messageHandledAsync;
});

// Log when the service worker starts/restarts (for debugging)
chrome.runtime.onStartup.addListener(() => {
  console.log("Extension started on browser startup.");
});
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`Extension installed/updated (${details.reason}). Version: ${chrome.runtime.getManifest().version}`);
});
console.log("Background service worker started (v1.6 - Custom Folder).");