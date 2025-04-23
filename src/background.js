// background.js (v1.8 - Enhanced Download Logging & Robustness)

console.log("Background service worker started (v1.8).");

// --- State Storage ---
// Structure: { tabId: { urls: [...], pageUrl: "...", timestamp: ... }, ... }
let scanResultsByTab = {};

// --- Helper: Sanitize Folder Name ---
// Ensures the folder name is safe for filesystem use.
function sanitizeFolderName(name) {
    if (!name || typeof name !== 'string') return 'InvalidFolderName';
    // Trim leading/trailing whitespace, dots, slashes
    let sanitized = name.trim().replace(/^[./\\ ]+/, '').replace(/[./\\ ]+$/, '');
    // Replace forbidden characters with underscores
    sanitized = sanitized.replace(/[<>:"/\\|?*~]/g, '_');
    // Prevent directory traversal
    sanitized = sanitized.replace(/\.\./g, '_');
    // Limit length
    const MAX_LEN = 50;
    sanitized = sanitized.substring(0, MAX_LEN);
    // Return a default name if sanitization results in an empty string
    return sanitized || 'SanitizedFolderName';
}

// --- Helper: Generate Base Filename ---
// Creates a suitable filename from the URL, adding extension if needed.
function generateBaseFilename(url) {
    let baseFilename = `clip-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`; // Default fallback
    try {
        const urlObj = new URL(url);
        // Get last part of the pathname, remove query string
        const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0); // Filter empty parts
        let potentialFilename = pathParts.pop() || ''; // Get the last non-empty part
        potentialFilename = potentialFilename.split('?')[0]; // Remove query parameters

        // Basic check if it looks like a real filename (has '.', not just '.', not empty)
        const seemsValid = potentialFilename.length > 1 && potentialFilename.includes('.') && !potentialFilename.startsWith('.');

        if (potentialFilename && seemsValid) {
            const decoded = decodeURIComponent(potentialFilename);
            // Sanitize characters forbidden in filenames
            const sanitizedFilename = decoded.replace(/[<>:"/\\|?*]/g, '_');
            const MAX_FILENAME_LEN = 100; // Max length for the filename part
            baseFilename = sanitizedFilename.substring(0, MAX_FILENAME_LEN);
        }
    } catch (e) {
        console.warn("Could not parse URL for base filename, using default:", url, e);
    }

    // --- Extension Handling ---
    const commonVideoExtensions = /\.(mp4|webm|mkv|avi|mov|flv|wmv)$/i;
    const urlExtMatch = url.match(commonVideoExtensions); // Check URL first

    if (urlExtMatch && urlExtMatch[1]) {
        const detectedExt = `.${urlExtMatch[1].toLowerCase()}`;
        // Add extension if baseFilename doesn't already have the *correct* one
        if (!baseFilename.toLowerCase().endsWith(detectedExt)) {
            // Remove any existing extension before adding the correct one
            baseFilename = baseFilename.replace(/\.[^.]+$/, '') + detectedExt;
        }
    } else if (!commonVideoExtensions.test(baseFilename)) {
        // If URL didn't give a clue and filename doesn't have one, default to .mp4
        baseFilename += '.mp4';
    }

    // Final check for empty filename after processing (highly unlikely)
    return baseFilename || `default-clip-${Date.now()}.mp4`;
}

// --- Persistence Helpers ---
function clearTabResults(tabId) {
    if (scanResultsByTab[tabId]) {
        console.log(`[Persistence] Clearing stored results for tab ${tabId}`);
        delete scanResultsByTab[tabId];
        // Maybe notify popup if it's open for this tab? Optional.
    }
}

function isDiscordChannelUrl(url) {
    // Basic check, might need refinement based on Discord URL structures
    return url && typeof url === 'string' && url.includes("discord.com/channels/");
}

// --- Listener for messages ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const msgSource = sender.tab ? `tab ${sender.tab.id}` : "popup/other";
    console.log(`Background received message: ${msg.type}`, "from", msgSource, msg); // Log full message for context
    let messageHandledAsync = false;

    switch (msg.type) {
        // --- Scan Flow ---
        case 'START_SCAN':
            if (msg.tabId) {
                const targetTabId = msg.tabId;
                console.log(`[Scan] Clearing old results for tab ${targetTabId} before new scan.`);
                clearTabResults(targetTabId); // Clear previous results for this tab

                console.log(`[Scan] Attempting to inject content script into tab ${targetTabId}`);
                chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    files: ['content-script.js']
                }, (injectionResults) => {
                    if (chrome.runtime.lastError) {
                        console.error(`[Scan] Script injection failed for tab ${targetTabId}:`, chrome.runtime.lastError.message);
                        // Send error to popup if it's still open
                        chrome.runtime.sendMessage({ type: 'SCAN_ERROR', message: `Script injection failed: ${chrome.runtime.lastError.message}` })
                            .catch(e => console.warn("Popup likely closed when sending SCAN_ERROR:", e.message));
                    } else if (injectionResults && injectionResults.length > 0) {
                        console.log(`[Scan] Content script injected successfully into tab ${targetTabId}. Waiting for results...`);
                        // Notify popup that scan has started (helps manage UI state)
                         chrome.runtime.sendMessage({ type: 'SCAN_STARTED' })
                              .catch(e => console.warn("Popup likely closed when sending SCAN_STARTED:", e.message));
                    } else {
                         // This case might happen if the injection completed but didn't return results (e.g., frame issues)
                         console.warn(`[Scan] Script injection reported success for tab ${targetTabId}, but no results array returned. Injection Results:`, injectionResults);
                         chrome.runtime.sendMessage({ type: 'SCAN_ERROR', message: 'Script injection finished but did not confirm execution.' })
                            .catch(e => console.warn("Popup likely closed when sending SCAN_ERROR:", e.message));
                    }
                });
                // executeScript is async, its callback handles the result.
                // No sendResponse here; popup reacts to SCAN_STARTED/SCAN_COMPLETE/SCAN_ERROR.
                messageHandledAsync = true;
            } else {
                console.error("[Scan] START_SCAN message missing tabId");
                // Can't send response if we don't know who asked, but log it.
            }
            break;

        case 'DISCORD_CLIP_URLS': // Message FROM content script
            if (sender.tab && sender.tab.id && sender.tab.url) {
                const tabId = sender.tab.id;
                const pageUrl = sender.tab.url;
                const urls = msg.urls || [];
                console.log(`[Scan Results] Storing ${urls.length} URLs for tab ${tabId} (${pageUrl})`);

                scanResultsByTab[tabId] = {
                    urls: urls,
                    pageUrl: pageUrl,
                    timestamp: Date.now()
                };

                // Forward results to popup
                chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', urls: urls })
                    .catch(error => console.warn("Could not send SCAN_COMPLETE to popup (likely closed):", error.message));
            } else {
                console.error("[Scan Results] Received DISCORD_CLIP_URLS without proper sender info (tab.id, tab.url).");
            }
            // No sendResponse needed from content script message
            break;

        case 'CONTENT_SCRIPT_ERROR': // Message FROM content script
             console.error("[Content Script Error] Received error:", msg.message);
             // Optional: Clear results if content script fails mid-scan?
             // if (sender.tab && sender.tab.id) { clearTabResults(sender.tab.id); }
             chrome.runtime.sendMessage({ type: 'SCAN_ERROR', message: msg.message || 'Unknown error in content script.'})
                 .catch(error => console.warn("Could not send SCAN_ERROR to popup (likely closed):", error.message));
            // No sendResponse needed from content script message
            break;

        // --- Popup State Request ---
        case 'GET_RESULTS_FOR_TAB': // Message FROM popup
            if (msg.tabId) {
                const targetTabId = msg.tabId;
                const storedData = scanResultsByTab[targetTabId];
                console.log(`[Popup Request] GET_RESULTS_FOR_TAB requested for ${targetTabId}. Stored data exists:`, !!storedData);

                if (storedData) {
                    // Check if the tab still exists and is on the *exact* same URL.
                    chrome.tabs.get(targetTabId, (currentTabInfo) => {
                        if (chrome.runtime.lastError) {
                            console.warn(`[Popup Request] Error checking tab ${targetTabId}, clearing results:`, chrome.runtime.lastError.message);
                            clearTabResults(targetTabId);
                            sendResponse({ status: "not_found", reason: "Tab inaccessible" });
                            return; // Exit callback early
                        }

                        if (currentTabInfo && currentTabInfo.url === storedData.pageUrl) {
                            console.log(`[Popup Request] Found valid stored results for tab ${targetTabId}. Sending to popup.`);
                            sendResponse({ status: "found", data: storedData });
                        } else {
                            console.log(`[Popup Request] Stored results for tab ${targetTabId} are stale (URL mismatch: stored='${storedData.pageUrl}', current='${currentTabInfo?.url}' or tab closed). Clearing.`);
                            clearTabResults(targetTabId);
                            sendResponse({ status: "not_found", reason: "URL mismatch or tab closed" });
                        }
                    });
                    messageHandledAsync = true; // Indicate async response via tabs.get callback
                } else {
                    console.log(`[Popup Request] No stored results found for tab ${targetTabId}.`);
                    sendResponse({ status: "not_found", reason: "No data stored" });
                }
            } else {
                console.error("[Popup Request] GET_RESULTS_FOR_TAB message missing tabId");
                sendResponse({ status: 'error', message: 'Missing tabId' });
            }
            break;

        // --- Download Handlers ---
        case 'DOWNLOAD_SINGLE_URL':
            if (msg.url && typeof msg.folder === 'string') {
                const downloadUrl = msg.url;
                const rawFolderName = msg.folder;

                console.log(`[Download Single] Received request. URL: ${downloadUrl}, Raw Folder: "${rawFolderName}"`);

                const sanitizedFolderName = sanitizeFolderName(rawFolderName);
                const baseFilename = generateBaseFilename(downloadUrl);
                const fullDownloadPath = `${sanitizedFolderName}/${baseFilename}`; // Using '/' as path separator

                console.log(`[Download Single] Sanitized Folder: "${sanitizedFolderName}"`);
                console.log(`[Download Single] Generated Filename: "${baseFilename}"`);
                console.log(`[Download Single] ---> Attempting Download Path: "${fullDownloadPath}"`); // CRITICAL LOG

                try {
                    chrome.downloads.download({
                        url: downloadUrl,
                        filename: fullDownloadPath, // The crucial parameter
                        conflictAction: 'uniquify'  // Automatically rename if file exists
                    }, (downloadId) => {
                        // This callback runs *after* the download attempt starts or fails to start.
                        if (chrome.runtime.lastError) {
                            // This is where API-level errors appear (permissions, invalid path etc.)
                            console.error(`[Download Single CB] Download initiation failed for "${fullDownloadPath}". Error:`, chrome.runtime.lastError.message);
                            sendResponse({ status: 'error', message: `Download failed: ${chrome.runtime.lastError.message}` });
                        } else if (downloadId !== undefined) {
                            console.log(`[Download Single CB] Download ${downloadId} started successfully for path: "${fullDownloadPath}".`);
                            sendResponse({ status: 'success', downloadId: downloadId });
                        } else {
                            // Should not happen if lastError is not set, but check just in case.
                            console.error(`[Download Single CB] Download failed for "${fullDownloadPath}": No downloadId returned and no error reported.`);
                            sendResponse({ status: 'error', message: 'Download initiation failed unexpectedly.' });
                        }
                    });
                    messageHandledAsync = true; // Indicate async response via download callback
                } catch (e) {
                    // This catches immediate errors calling the API function itself (rare)
                    console.error("[Download Single] Catastrophic error calling chrome.downloads.download:", e);
                    sendResponse({ status: 'error', message: `API call error: ${e.message}` });
                }
            } else {
                console.error("[Download Single] Invalid message parameters:", msg);
                sendResponse({ status: 'error', message: 'Missing URL or Invalid Folder Name' });
            }
            break;

        case 'DOWNLOAD_ALL_URLS':
            if (msg.urls && Array.isArray(msg.urls) && msg.urls.length > 0 && typeof msg.folder === 'string') {
                const urlsToDownload = msg.urls;
                const rawFolderName = msg.folder;
                const sanitizedFolderName = sanitizeFolderName(rawFolderName);
                let initiatedCount = 0;
                let errorCount = 0;

                console.log(`[Download All] Received request for ${urlsToDownload.length} URLs. Raw Folder: "${rawFolderName}", Sanitized: "${sanitizedFolderName}"`);

                urlsToDownload.forEach((url, index) => {
                    if (!url || typeof url !== 'string') {
                        console.warn(`[Download All #${index}] Skipping invalid URL:`, url);
                        errorCount++;
                        return; // Skip this iteration
                    }

                    try {
                        const baseFilename = generateBaseFilename(url);
                        const fullDownloadPath = `${sanitizedFolderName}/${baseFilename}`;

                        console.log(`[Download All #${index}] Filename: "${baseFilename}"`);
                        console.log(`[Download All #${index}] ---> Attempting Download Path: "${fullDownloadPath}"`); // CRITICAL LOG

                        chrome.downloads.download({
                            url: url,
                            filename: fullDownloadPath,
                            conflictAction: 'uniquify'
                        }, (downloadId) => {
                            // Log individual results but don't sendResponse here (response sent after loop)
                            if (chrome.runtime.lastError) {
                                console.warn(`[Download All CB #${index}] Failed for "${fullDownloadPath}":`, chrome.runtime.lastError.message);
                                // Can't reliably increment errorCount here due to async nature without more complex state management
                            } else if (downloadId !== undefined) {
                                // console.log(`[Download All CB #${index}] Started ${downloadId} for "${fullDownloadPath}"`); // Can be verbose
                            } else {
                                console.warn(`[Download All CB #${index}] Failed for "${fullDownloadPath}": No ID, no error.`);
                            }
                        });
                        initiatedCount++; // Count initiated attempts, not successes
                    } catch (e) {
                        console.error(`[Download All #${index}] Catastrophic error calling download for URL (${url}):`, e);
                        errorCount++;
                    }
                });

                console.log(`[Download All] Finished initiating loop. Attempted: ${initiatedCount}, Initial Errors: ${errorCount}.`);
                // Send a single response back to the popup after attempting all downloads
                if (initiatedCount > 0) {
                    sendResponse({ status: 'success', count: initiatedCount }); // Report how many were *attempted*
                } else {
                    sendResponse({ status: 'error', message: `Failed to initiate any downloads (${errorCount} errors during loop).` });
                }
            } else {
                 console.error("[Download All] Invalid message parameters:", msg);
                 sendResponse({ status: 'error', message: 'Invalid URLs array or Folder Name' });
            }
            break;

        default:
             console.log("[Unhandled Message] Type:", msg.type);
             // Optional: sendResponse({ status: 'unhandled', type: msg.type });
             break;
    }

    // Return true if we dispatched an async operation that will eventually call sendResponse
    // Return false/undefined otherwise, indicating sendResponse was called synchronously or not at all.
    return messageHandledAsync;
});

// --- Tab Event Listeners for Persistence ---

// Clear results when a relevant tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (scanResultsByTab[tabId]) {
        console.log(`[Tab Event] Tab ${tabId} removed. Clearing results.`);
        clearTabResults(tabId);
    }
});

// Clear results when a relevant tab navigates away or significantly changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only act if we have stored data for this tab
    if (!scanResultsByTab[tabId]) return;

    // Check for URL change or if status is complete and it's no longer a discord channel
    const urlChanged = changeInfo.url && changeInfo.url !== scanResultsByTab[tabId].pageUrl;
    const navigatedAwayFromDiscord = changeInfo.status === 'complete' && tab.url && !isDiscordChannelUrl(tab.url);

    if (urlChanged || navigatedAwayFromDiscord) {
        console.log(`[Tab Event] Tab ${tabId} updated (URL changed: ${urlChanged}, Navigated away: ${navigatedAwayFromDiscord}). Clearing results. New URL: ${changeInfo.url || tab.url}`);
        clearTabResults(tabId);
    }
    // Note: We might still keep results if only the hash changes or minor updates occur on the *same* Discord channel URL.
});

// --- Service Worker Lifecycle Logs ---
chrome.runtime.onStartup.addListener(() => {
  console.log("[LifeCycle] Extension started via browser startup.");
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[LifeCycle] Extension ${details.reason}. Version: ${chrome.runtime.getManifest().version}. Previous Version: ${details.previousVersion || 'N/A'}`);
  // Consider clearing all storage on update if state structure changes significantly
  // scanResultsByTab = {};
  // chrome.storage.local.clear(); // If using storage
});

console.log("Background script fully initialized and listeners attached.");