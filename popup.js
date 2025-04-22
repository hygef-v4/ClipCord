// popup.js (v1.9 - Overlay on Restore)

// --- Get DOM Elements ---
const videoListContainer = document.getElementById("videoListContainer");
const videoListArea = document.getElementById("videoListArea");
const loadingOverlay = document.getElementById("loadingOverlay");
const downloadAllSection = document.getElementById("downloadAllSection");
const totalClipCountSpan = document.getElementById("totalClipCount");
const scanButton = document.getElementById("scanButton");
const folderNameInput = document.getElementById("folderNameInput");
const statusMessage = document.getElementById("statusMessage");
const spinner = document.getElementById("spinner"); // Scan button spinner
const downloadAllButton = document.getElementById("downloadAllButton");

// --- State Variables ---
let currentClipUrls = []; // Store URLs for Download All functionality
let revealTimeoutId = null;
let currentTabId = null; // Store the active tab ID

// --- Constants ---
const OVERLAY_DELAY_FRESH_SCAN = 4500; // ms for overlay after a new scan
const OVERLAY_DELAY_RESTORE = 600;   // ms for overlay when restoring state

// --- Helper Functions (getFilenameFromUrl, showStatus, getTargetFolderName, handleIndividualDownload - Unchanged) ---
function getFilenameFromUrl(url) { /* ... same as before ... */
    try { const urlObj = new URL(url); const pathParts = urlObj.pathname.split("/"); let potentialFilename = pathParts.pop() || pathParts.pop(); return decodeURIComponent(potentialFilename?.split("?")[0]) || "unknown_clip"; } catch (e) { console.error("Error parsing URL for filename:", url, e); return "unknown_clip"; }
}
function showStatus(message, type = "info", showScanSpinner = false) { /* ... same as before ... */
    const alertClass = `alert-${type}`; statusMessage.className = `alert ${alertClass} mb-2 status-message`; spinner.classList.toggle("d-none", !showScanSpinner); scanButton.querySelector('.button-text')?.classList.toggle('d-none', showScanSpinner); statusMessage.textContent = message; statusMessage.classList.remove("d-none"); if (showScanSpinner) { statusMessage.classList.add('d-none'); }
}
function getTargetFolderName() { /* ... same as before ... */
    const folderName = folderNameInput.value.trim(); return folderName || folderNameInput.placeholder || "DiscordClips";
}
function handleIndividualDownload(event) { /* ... same as before ... */
    const button = event.target.closest('button'); if (!button) return; const urlToDownload = button.dataset.url; if (!urlToDownload) return; button.disabled = true; button.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>`; const targetFolder = getTargetFolderName(); chrome.runtime.sendMessage({ type: "DOWNLOAD_SINGLE_URL", url: urlToDownload, folder: targetFolder }, (response) => { const currentButton = videoListArea.querySelector(`button[data-url="${urlToDownload}"]`); if (!currentButton) return; if (response?.status === "success") { currentButton.textContent = "Done"; currentButton.classList.replace("btn-success", "btn-secondary"); } else { currentButton.textContent = "Failed"; currentButton.classList.replace("btn-success", "btn-danger"); currentButton.disabled = false; console.error("Download failed:", response?.error); } });
}


/**
 * Resets the UI to its initial state.
 * @param {boolean} showInitialMessage - Whether to show the "Click Scan" message.
 */
function resetUI(showInitialMessage = true) {
    console.log("Resetting UI. Show initial message:", showInitialMessage);
    clearTimeout(revealTimeoutId);
    scanButton.disabled = false;
    spinner.classList.add("d-none");
    scanButton.querySelector('.button-text')?.classList.remove('d-none');
    videoListArea.innerHTML = "";
    videoListContainer.classList.add("d-none");
    loadingOverlay.classList.remove("active");
    downloadAllSection.classList.add("d-none");
    if (downloadAllButton) { downloadAllButton.disabled = false; downloadAllButton.textContent = "Download All"; }
    totalClipCountSpan.textContent = "0";
    currentClipUrls = [];
    if (showInitialMessage) { showStatus("Click 'Scan' to find clips.", "light"); }
    else { statusMessage.classList.add("d-none"); }
}

/**
 * Populates the UI list with video URLs.
 * @param {string[]} urls - Array of video URLs.
 * @param {number} overlayDelayMs - Duration in ms to show the overlay. 0 or less means no overlay.
 */
function populateUI(urls, overlayDelayMs = 0) { // Default to no overlay
    console.log(`Populating UI with ${urls.length} URLs. Overlay delay: ${overlayDelayMs}ms`);
    currentClipUrls = urls;
    videoListArea.innerHTML = "";

    if (urls.length === 0) {
        resetUI(false);
        showStatus("Scan found 0 clips.", "warning");
        return;
    }

    // Update status message while building
    showStatus(`Building list for ${urls.length} clip(s)...`, "info", false);

    const fragment = document.createDocumentFragment();
    urls.forEach((url) => {
        // --- Create List Item Elements (Same as before) ---
        const listItem = document.createElement("div");
        listItem.className = "list-group-item d-flex align-items-center justify-content-between p-2 flex-shrink-0";
        const infoContainer = document.createElement('div'); infoContainer.className = "d-flex align-items-center me-2"; infoContainer.style.minWidth = '0'; infoContainer.style.flexGrow = '1';
        const videoThumbnail = document.createElement("video"); videoThumbnail.src = url; videoThumbnail.width = 80; videoThumbnail.height = 45; videoThumbnail.muted = true; videoThumbnail.preload = "metadata"; videoThumbnail.style.backgroundColor = "#e9ecef";
        let playTimeout;
        // Determine if interaction is allowed based on overlay state
        const canInteractInitially = overlayDelayMs <= 0; // Can interact if no overlay requested
        listItem.addEventListener("mouseenter", () => {
            // Check current overlay state *and* initial intent
            if ((canInteractInitially || !loadingOverlay.classList.contains('active'))) {
                videoThumbnail.currentTime = 0; videoThumbnail.play().catch(() => {}); clearTimeout(playTimeout); playTimeout = setTimeout(() => videoThumbnail.pause(), 1500);
            }
        });
        listItem.addEventListener("mouseleave", () => {
             if ((canInteractInitially || !loadingOverlay.classList.contains('active'))) {
                clearTimeout(playTimeout); videoThumbnail.pause(); videoThumbnail.currentTime = 0;
            }
        });
        const textSpan = document.createElement("span"); textSpan.className = "clip-name"; const filename = getFilenameFromUrl(url); textSpan.textContent = filename; textSpan.title = filename;
        const downloadBtn = document.createElement("button"); downloadBtn.className = "btn btn-success btn-sm btn-download-single"; downloadBtn.textContent = "Download"; downloadBtn.dataset.url = url; downloadBtn.addEventListener("click", handleIndividualDownload);
        infoContainer.appendChild(videoThumbnail); infoContainer.appendChild(textSpan); listItem.appendChild(infoContainer); listItem.appendChild(downloadBtn); fragment.appendChild(listItem);
        // --- End List Item Creation ---
    });

    // --- Update UI Sections ---
    videoListArea.appendChild(fragment);
    videoListContainer.classList.remove("d-none");
    downloadAllSection.classList.remove("d-none");
    totalClipCountSpan.textContent = urls.length;

    // --- Handle Overlay and Final Status ---
    if (overlayDelayMs > 0) {
        loadingOverlay.classList.add("active"); // Show overlay
        showStatus(`Loading ${urls.length} previews...`, "info", false); // Update status text
        clearTimeout(revealTimeoutId); // Clear any existing timeout
        revealTimeoutId = setTimeout(() => {
            loadingOverlay.classList.remove("active"); // Fade out overlay
            showStatus(`Loaded ${urls.length} clips. Ready!`, "success", false); // Final success status
            scanButton.disabled = false; // Re-enable scan button
            if (downloadAllButton) downloadAllButton.disabled = false;
        }, overlayDelayMs); // Use the specified delay
    } else {
        // No overlay requested
        loadingOverlay.classList.remove("active"); // Ensure overlay is hidden
        showStatus(`Loaded ${urls.length} clips. Ready!`, "success", false); // Final status
        scanButton.disabled = false; // Re-enable scan button immediately
        if (downloadAllButton) downloadAllButton.disabled = false;
    }
}


// --- Event Listeners ---

/**
 * Scan Button Click Handler: Sends message to background to start scan.
 */
scanButton.addEventListener("click", () => {
    if (!currentTabId) { showStatus("Could not get active tab ID.", "danger"); return; }
    resetUI(false);
    scanButton.disabled = true;
    showStatus("Starting scan...", "info", true);
    chrome.runtime.sendMessage({ type: "START_SCAN", tabId: currentTabId });
});

/**
 * Message Listener: Handles messages FROM background script.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("Popup received message:", msg.type);
    switch (msg.type) {
        case "SCAN_COMPLETE": // Results received from background (fresh scan)
            // Use the longer delay for fresh scans
            populateUI(msg.urls, OVERLAY_DELAY_FRESH_SCAN);
            break;
        case "SCAN_ERROR": // Error reported from background
            showStatus(`Error: ${msg.message || 'Unknown scan error'}`, "danger");
            resetUI(false);
            scanButton.disabled = false;
            break;
        case "SCAN_STARTED": // Background confirms injection started
            showStatus("Scanning page for clips...", "info", true);
            break;
    }
});

/**
 * Download All Button Click Handler.
 */
if (downloadAllButton) { /* ... same as before ... */
    downloadAllButton.addEventListener("click", () => { if (currentClipUrls.length === 0) { showStatus("No clips to download.", "warning"); return; } downloadAllButton.disabled = true; downloadAllButton.textContent = `Starting ${currentClipUrls.length}...`; showStatus(`Initiating download of ${currentClipUrls.length} clips...`, "info"); const targetFolder = getTargetFolderName(); chrome.runtime.sendMessage({ type: "DOWNLOAD_ALL_URLS", urls: currentClipUrls, folder: targetFolder }, (response) => { downloadAllButton.disabled = false; downloadAllButton.textContent = "Download All"; if (response?.status === "success") { const count = response.count || currentClipUrls.length; showStatus(`Download started for ${count} clips. Check browser downloads.`, "success"); videoListArea.querySelectorAll('.btn-download-single.btn-success').forEach(btn => { btn.textContent = "Done"; btn.classList.replace("btn-success", "btn-secondary"); btn.disabled = true; }); } else { showStatus(`Failed to start 'Download All': ${response?.error || 'Unknown error'}`, "danger"); } }); });
}

// --- Initialisation ---
/**
 * Runs when the popup opens. Gets tab info and requests stored state.
 */
async function initializePopup() {
    console.log("Initializing popup...");
    let tab;
    try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); }
    catch (e) { console.error("Error querying tabs:", e); resetUI(false); showStatus("Error accessing tab information.", "danger"); return; }

    if (!tab?.id || !tab.url) { console.error("Could not get active tab info."); resetUI(false); showStatus("Cannot access current tab info.", "danger"); return; }
    currentTabId = tab.id;

    if (!tab.url.includes("discord.com/channels/")) { console.log("Not a Discord channel page."); resetUI(true); scanButton.disabled = true; return; }
    scanButton.disabled = false; // Enable scan button

    console.log(`Requesting stored results for tab ${currentTabId}`);
    // Show initial loading status immediately
    showStatus("Loading results...", "info");

    chrome.runtime.sendMessage({ type: "GET_RESULTS_FOR_TAB", tabId: currentTabId }, (response) => {
        if (chrome.runtime.lastError) { console.warn("Error requesting stored results:", chrome.runtime.lastError.message); resetUI(true); return; }

        if (response?.status === "found" && response.data?.urls) {
            console.log("Found stored results. Populating UI with short overlay.");
            // *** Use the shorter delay when restoring state ***
            populateUI(response.data.urls, OVERLAY_DELAY_RESTORE);
        } else {
            console.log(`No valid stored results found (Status: ${response?.status}, Reason: ${response?.reason}). Ready to scan.`);
            resetUI(true); // Show the initial 'Click Scan' message
        }
    });
}

// --- Run Initialization ---
document.addEventListener('DOMContentLoaded', initializePopup);