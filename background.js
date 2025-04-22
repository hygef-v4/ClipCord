// background.js (v1.7 - Added Persistence)

console.log("Background service worker started (v1.7 - Persistence).");

// --- State Storage ---
// Structure: { tabId: { urls: [...], pageUrl: "...", timestamp: ... }, ... }
let scanResultsByTab = {};

// --- Helper: Sanitize Folder Name ---
function sanitizeFolderName(name) {
    if (!name || typeof name !== 'string') return 'InvalidFolderName';
    let sanitized = name.trim().replace(/^[./\\ ]+/, '').replace(/[./\\ ]+$/, '');
    sanitized = sanitized.replace(/[<>:"/\\|?*~]/g, '_');
    sanitized = sanitized.replace(/\.\./g, '_');
    const MAX_LEN = 50;
    sanitized = sanitized.substring(0, MAX_LEN);
    return sanitized || 'SanitizedFolderName';
}

// --- Helper: Generate Base Filename ---
function generateBaseFilename(url) {
    let baseFilename = `clip-${Date.now()}-${Math.random().toString(16).substring(2, 8)}`;
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        let potentialFilename = pathParts.pop() || '';
        potentialFilename = potentialFilename.split('?')[0];
        const seemsValid = potentialFilename.length > 1 && potentialFilename.includes('.') && !potentialFilename.startsWith('.');
        if (potentialFilename && seemsValid) {
            const decoded = decodeURIComponent(potentialFilename);
            const sanitizedFilename = decoded.replace(/[<>:"/\\|?*]/g, '_');
            const MAX_FILENAME_LEN = 100;
            baseFilename = sanitizedFilename.substring(0, MAX_FILENAME_LEN);
        }
    } catch (e) {
        console.warn("Could not parse URL for base filename:", url, e);
    }
    const urlMatch = url.match(/\.(mp4|webm|mkv|avi|mov|flv|wmv)(\?|$)/i);
    if (urlMatch && urlMatch[1]) {
        const detectedExt = `.${urlMatch[1].toLowerCase()}`;
        if (!baseFilename.toLowerCase().endsWith(detectedExt)) {
            baseFilename = baseFilename.replace(/\.[^.]+$/, '') + detectedExt;
        }
    } else if (!/\.(mp4|webm|mkv|avi|mov|flv|wmv)$/i.test(baseFilename)) {
        baseFilename += '.mp4';
    }
    return baseFilename;
}

// --- Persistence Helpers ---
function clearTabResults(tabId) {
    if (scanResultsByTab[tabId]) {
        console.log(`[Persistence] Clearing stored results for tab ${tabId}`);
        delete scanResultsByTab[tabId];
    }
}

function isDiscordChannelUrl(url) {
    return url && typeof url === 'string' && url.includes("discord.com/channels/");
}

// --- Listener for messages ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log(`Background received message: ${msg.type}`, "from", sender.tab ? `tab ${sender.tab.id}` : "popup/other");
    let messageHandledAsync = false;

    switch (msg.type) {
        case 'START_SCAN': // Message FROM popup
            if (msg.tabId) {
                const targetTabId = msg.tabId;
                console.log(`[Persistence] Clearing old results for tab ${targetTabId} before new scan.`);
                clearTabResults(targetTabId); // Clear results before new scan

                console.log(`Attempting to inject content script into tab ${targetTabId}`);
                chrome.scripting.executeScript({
                    target: { tabId: targetTabId },
                    files: ['content-script.js']
                }, (injectionResults) => {
                    if (chrome.runtime.lastError) {
                        console.error(`Script injection failed for tab ${targetTabId}:`, chrome.runtime.lastError.message);
                        chrome.runtime.sendMessage({ type: 'SCAN_ERROR', message: `Script injection failed: ${chrome.runtime.lastError.message}` })
                            .catch(e => console.log("Popup likely closed when sending SCAN_ERROR:", e.message));
                    } else {
                        console.log(`Content script injected successfully into tab ${targetTabId}. Waiting for results...`);
                        // Notify popup that injection started (optional, popup already shows spinner)
                         chrome.runtime.sendMessage({ type: 'SCAN_STARTED' })
                              .catch(e => console.log("Popup likely closed when sending SCAN_STARTED:", e.message));
                    }
                });
                // No need to sendResponse here, popup manages its state based on SCAN_STARTED/SCAN_COMPLETE/SCAN_ERROR
                // Return true because executeScript callback is async
                messageHandledAsync = true;
            } else {
                console.error("START_SCAN message missing tabId");
                sendResponse({ status: 'error', message: 'Missing tabId' }); // Send error back immediately
            }
            break;

        case 'DISCORD_CLIP_URLS': // Message FROM content script
            if (sender.tab && sender.tab.id && sender.tab.url) {
                const tabId = sender.tab.id;
                const pageUrl = sender.tab.url;
                const urls = msg.urls || [];
                console.log(`[Persistence] Storing ${urls.length} URLs for tab ${tabId} (${pageUrl})`);
                // --- Store the results ---
                scanResultsByTab[tabId] = {
                    urls: urls,
                    pageUrl: pageUrl,
                    timestamp: Date.now()
                };
                // Forward results to popup with SCAN_COMPLETE type
                chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', urls: urls })
                    .catch(error => console.log("Could not send SCAN_COMPLETE to popup:", error.message));
            } else {
                console.error("Received DISCORD_CLIP_URLS without proper sender info.");
            }
            // No sendResponse needed here
            break;

        case 'CONTENT_SCRIPT_ERROR': // Message FROM content script
             if (sender.tab && sender.tab.id) {
                // Optional: Clear potentially partial/stale results if content script failed
                // clearTabResults(sender.tab.id);
             }
             console.error("Error reported from content script:", msg.message);
             chrome.runtime.sendMessage({ type: 'SCAN_ERROR', message: msg.message || 'Unknown error in content script.'})
                 .catch(error => console.log("Could not send SCAN_ERROR to popup:", error.message));
             // No sendResponse needed here
             break;

        case 'GET_RESULTS_FOR_TAB': // Message FROM popup asking for stored data
            if (msg.tabId) {
                const targetTabId = msg.tabId;
                const storedData = scanResultsByTab[targetTabId];
                if (storedData) {
                    // Validate the tab still exists and is on the SAME URL
                    chrome.tabs.get(targetTabId, (currentTabInfo) => {
                        if (chrome.runtime.lastError) {
                            console.warn(`[Persistence] Error checking tab ${targetTabId}, clearing results:`, chrome.runtime.lastError.message);
                            clearTabResults(targetTabId);
                            sendResponse({ status: "not_found", reason: "Tab inaccessible" });
                            return;
                        }
                        if (currentTabInfo && currentTabInfo.url === storedData.pageUrl) {
                            console.log(`[Persistence] Found valid stored results for tab ${targetTabId}.`);
                            sendResponse({ status: "found", data: storedData });
                        } else {
                            console.log(`[Persistence] Stored results for tab ${targetTabId} are stale (URL mismatch or tab closed). Clearing.`);
                            clearTabResults(targetTabId);
                            sendResponse({ status: "not_found", reason: "URL mismatch" });
                        }
                    });
                    messageHandledAsync = true; // Indicate async response via tabs.get callback
                } else {
                    console.log(`[Persistence] No stored results found for tab ${targetTabId}.`);
                    sendResponse({ status: "not_found", reason: "No data stored" });
                }
            } else {
                console.error("GET_RESULTS_FOR_TAB message missing tabId");
                sendResponse({ status: 'error', message: 'Missing tabId' });
            }
            break;


        // --- Download Handlers (Unchanged from your provided code) ---
        case 'DOWNLOAD_SINGLE_URL':
            if (msg.url && typeof msg.folder === 'string') {
                const downloadUrl = msg.url;
                const rawFolderName = msg.folder;
                const sanitizedFolderName = sanitizeFolderName(rawFolderName);
                const baseFilename = generateBaseFilename(downloadUrl);
                const fullDownloadPath = `${sanitizedFolderName}/${baseFilename}`;
                console.log(`Initiating single download: ${downloadUrl} as ${fullDownloadPath}`);
                try {
                    chrome.downloads.download({
                        url: downloadUrl, filename: fullDownloadPath, conflictAction: 'uniquify'
                    }, (downloadId) => {
                        if (chrome.runtime.lastError) {
                            console.error(`Single download failed for ${fullDownloadPath}:`, chrome.runtime.lastError.message);
                            sendResponse({ status: 'error', message: chrome.runtime.lastError.message });
                        } else if (downloadId !== undefined) {
                            console.log(`Single download ${downloadId} started successfully.`);
                            sendResponse({ status: 'success' });
                        } else {
                            console.error(`Single download failed for ${fullDownloadPath}: No downloadId returned and no error.`);
                            sendResponse({ status: 'error', message: 'Download initiation failed (no ID).' });
                        }
                    });
                    messageHandledAsync = true;
                } catch (e) {
                    console.error("Error calling chrome.downloads.download (single):", e);
                    sendResponse({ status: 'error', message: `Download error: ${e.message}` });
                }
            } else {
                console.error("DOWNLOAD_SINGLE_URL message missing URL or Folder Name (or folder is not a string)");
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
                console.log(`Initiating bulk download for ${urlsToDownload.length} URLs into folder "${sanitizedFolderName}".`);
                urlsToDownload.forEach((url, index) => {
                    if (!url || typeof url !== 'string') {
                        console.warn(`Skipping invalid URL at index ${index}:`, url);
                        errorCount++; return;
                    }
                    try {
                        const baseFilename = generateBaseFilename(url);
                        const fullDownloadPath = `${sanitizedFolderName}/${baseFilename}`;
                        chrome.downloads.download({ url: url, filename: fullDownloadPath, conflictAction: 'uniquify' }, (downloadId) => {
                            if (chrome.runtime.lastError) console.warn(`Bulk download item failed (${fullDownloadPath}): ${chrome.runtime.lastError.message}`);
                        });
                        initiatedCount++;
                    } catch (e) {
                        console.error(`Error initiating download for URL #${index} (${url}):`, e);
                        errorCount++;
                    }
                });
                console.log(`Initiated ${initiatedCount} downloads, encountered ${errorCount} errors during initiation.`);
                if (initiatedCount > 0) sendResponse({ status: 'success', count: initiatedCount });
                else sendResponse({ status: 'error', message: `Failed to initiate any downloads (${errorCount} errors).` });
            } else {
                console.error("DOWNLOAD_ALL_URLS message missing/invalid URLs array or Folder Name (or folder is not a string)");
                sendResponse({ status: 'error', message: 'Invalid URLs array or Folder Name' });
            }
            break;

        default:
             console.log("Background received unhandled message type:", msg.type);
             break;
    }

    return messageHandledAsync; // Crucial for async sendResponse
});

// --- Tab Event Listeners for Persistence ---

// Clear results when a tab is closed
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    console.log(`Tab ${tabId} removed.`);
    clearTabResults(tabId);
});

// Clear results when a relevant tab navigates away or changes URL significantly
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const storedData = scanResultsByTab[tabId];
    if (!storedData) return; // No data stored for this tab

    // Check if URL changed to something different from stored OR if it's no longer a Discord channel
    if ( (changeInfo.url && changeInfo.url !== storedData.pageUrl) ||
         (changeInfo.status === 'complete' && tab.url && !isDiscordChannelUrl(tab.url)) )
    {
        console.log(`[Persistence] Tab ${tabId} navigated or changed URL significantly. Clearing results.`);
        clearTabResults(tabId);
    }
});

// --- Service Worker Lifecycle Logs ---
chrome.runtime.onStartup.addListener(() => {
  console.log("[LifeCycle] Extension started on browser startup.");
});
chrome.runtime.onInstalled.addListener((details) => {
  console.log(`[LifeCycle] Extension installed/updated (${details.reason}). Version: ${chrome.runtime.getManifest().version}`);
  // Clear all stored results on update? Maybe not ideal, depends on need.
  // scanResultsByTab = {};
});