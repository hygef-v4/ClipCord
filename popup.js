// popup.js (v1.7 - Persistence Aware)

// --- Get DOM Elements ---
const videoListContainer = document.getElementById("videoListContainer");
const videoListArea = document.getElementById("videoListArea");
const loadingOverlay = document.getElementById("loadingOverlay");
const downloadAllSection = document.getElementById("downloadAllSection");
const totalClipCountSpan = document.getElementById("totalClipCount");
const scanButton = document.getElementById("scanButton");
const folderNameInput = document.getElementById("folderNameInput");
const statusMessage = document.getElementById("statusMessage");
const spinner = document.getElementById("spinner");
const downloadAllButton = document.getElementById("downloadAllButton");

// --- State Variables ---
let currentClipUrls = []; // Still useful for Download All button
let revealTimeoutId = null;
let currentTabId = null; // Store the active tab ID

// --- Helper Functions (getFilenameFromUrl, showStatus, getTargetFolderName, handleIndividualDownload - Unchanged) ---
function getFilenameFromUrl(url) { /* ... same as before ... */
    try {
        const urlObj = new URL(url); const pathParts = urlObj.pathname.split("/");
        let potentialFilename = pathParts.pop() || pathParts.pop();
        return decodeURIComponent(potentialFilename?.split("?")[0]) || "unknown_clip";
    } catch (e) { console.error("Error parsing URL:", url, e); return "unknown_clip"; }
}
function showStatus(message, type = "info", showScanSpinner = false) { /* ... same as before ... */
    statusMessage.className = `alert alert-${type} mb-2`;
    spinner.classList.toggle("d-none", !showScanSpinner);
    statusMessage.textContent = message;
    statusMessage.classList.toggle("d-none", showScanSpinner);
}
function getTargetFolderName() { /* ... same as before ... */
    const folderName = folderNameInput.value.trim();
    return folderName || folderNameInput.placeholder || "DiscordClips";
}
function handleIndividualDownload(event) { /* ... same as before ... */
    const button = event.target.closest('button'); if (!button) return;
    const urlToDownload = button.dataset.url; if (!urlToDownload) return;
    button.disabled = true; button.textContent = "Starting...";
    const targetFolder = getTargetFolderName();
    chrome.runtime.sendMessage({ type: "DOWNLOAD_SINGLE_URL", url: urlToDownload, folder: targetFolder }, (response) => {
        const currentButton = videoListArea.querySelector(`button[data-url="${urlToDownload}"]`); if (!currentButton) return;
        if (response?.status === "success") {
            currentButton.textContent = "Done"; currentButton.classList.replace("btn-success", "btn-secondary");
        } else {
            currentButton.textContent = "Failed"; currentButton.classList.replace("btn-success", "btn-danger");
            currentButton.disabled = false; console.error("Download failed:", response?.error);
        }
    });
}

/**
 * Resets the UI to its initial state, clearing lists and hiding sections.
 */
function resetUI(showInitialMessage = true) { // Added parameter
  console.log("Resetting UI");
  clearTimeout(revealTimeoutId);
  scanButton.disabled = false;
  videoListArea.innerHTML = "";
  videoListContainer.classList.add("d-none");
  loadingOverlay.classList.remove("active");
  downloadAllSection.classList.add("d-none");
  if (downloadAllButton) downloadAllButton.disabled = false;
  totalClipCountSpan.textContent = "0";
  currentClipUrls = []; // Clear local URL store
  if (showInitialMessage) {
      showStatus("Click 'Scan' to find clips.", "light"); // Initial status message
  }
}

/**
 * Populates the UI with a list of video URLs.
 * @param {string[]} urls - Array of video URLs.
 * @param {boolean} showOverlay - Whether to show the loading overlay (true for fresh scan, false for restore).
 */
function populateUI(urls, showOverlay = false) {
  console.log(`Populating UI with ${urls.length} URLs. Show overlay: ${showOverlay}`);
  currentClipUrls = urls; // Store URLs locally for Download All
  videoListArea.innerHTML = ""; // Clear previous items

  if (urls.length === 0) {
    resetUI(false); // Reset without initial message
    showStatus("Scan found 0 clips.", "warning");
    return;
  }

  // Use status to show building state, hide scan spinner
  showStatus(`Building list for ${urls.length} clip(s)...`, "info", false);

  const fragment = document.createDocumentFragment();
  urls.forEach((url, index) => {
    // --- Create List Item Elements (Same as before) ---
    const listItem = document.createElement("div");
    listItem.className = "list-group-item d-flex align-items-center justify-content-between p-2 flex-shrink-0";
    // ... (rest of listItem creation: infoContainer, videoThumbnail, textSpan, downloadBtn) ...
    const infoContainer = document.createElement('div'); infoContainer.className = "d-flex align-items-center me-2"; infoContainer.style.minWidth = '0'; infoContainer.style.flexGrow = '1';
    const videoThumbnail = document.createElement("video"); videoThumbnail.src = url; videoThumbnail.width = 80; videoThumbnail.height = 45; videoThumbnail.muted = true; videoThumbnail.preload = "metadata"; videoThumbnail.style.marginRight = '10px'; videoThumbnail.style.flexShrink = '0'; videoThumbnail.style.objectFit = 'cover';
    let playTimeout;
    listItem.addEventListener("mouseenter", () => { if (!loadingOverlay.classList.contains('active') || !showOverlay) { videoThumbnail.currentTime = 0; videoThumbnail.play().catch((e) => {}); clearTimeout(playTimeout); playTimeout = setTimeout(() => videoThumbnail.pause(), 1500); } });
    listItem.addEventListener("mouseleave", () => { if (!loadingOverlay.classList.contains('active') || !showOverlay) { clearTimeout(playTimeout); videoThumbnail.pause(); videoThumbnail.currentTime = 0; } });
    const textSpan = document.createElement("span"); textSpan.className = "clip-name text-truncate"; textSpan.style.whiteSpace = 'nowrap'; textSpan.style.overflow = 'hidden'; textSpan.style.textOverflow = 'ellipsis'; const filename = getFilenameFromUrl(url); textSpan.textContent = filename; textSpan.title = filename;
    const downloadBtn = document.createElement("button"); downloadBtn.className = "btn btn-success btn-sm btn-download-single ms-auto flex-shrink-0"; downloadBtn.textContent = "Download"; downloadBtn.dataset.url = url; downloadBtn.addEventListener("click", handleIndividualDownload);
    infoContainer.appendChild(videoThumbnail); infoContainer.appendChild(textSpan); listItem.appendChild(infoContainer); listItem.appendChild(downloadBtn); fragment.appendChild(listItem);
    // --- End List Item Creation ---
  });

  // 1. Add items to the list area
  videoListArea.appendChild(fragment);

  // 2. Make the container visible
  videoListContainer.classList.remove("d-none");

  // 3. Show download section and update count
  downloadAllSection.classList.remove("d-none");
  totalClipCountSpan.textContent = urls.length;

  // 4. Handle Overlay & Final Status
  if (showOverlay) {
    loadingOverlay.classList.add("active"); // Show overlay for fresh scans
    showStatus(`Loading ${urls.length} previews...`, "info", false);
    const revealDelay = 4500; // Delay for fresh scans
    clearTimeout(revealTimeoutId);
    revealTimeoutId = setTimeout(() => {
      loadingOverlay.classList.remove("active");
      showStatus(`Loaded ${urls.length} clips. Ready!`, "success", false);
      scanButton.disabled = false;
      if (downloadAllButton) downloadAllButton.disabled = false;
    }, revealDelay);
  } else {
    // No overlay needed (restoring state)
    loadingOverlay.classList.remove("active"); // Ensure overlay is hidden
    showStatus(`Restored ${urls.length} clips. Ready!`, "success", false);
    scanButton.disabled = false; // Enable scan button immediately
    if (downloadAllButton) downloadAllButton.disabled = false;
  }
}

// --- Event Listeners ---

/**
 * Scan Button Click Handler: Tells background to start a *new* scan.
 */
scanButton.addEventListener("click", () => {
  if (!currentTabId) {
      showStatus("Could not get active tab ID.", "danger");
      return;
  }
  // Reset UI visually *before* sending message for responsiveness
  resetUI(false); // Reset without the initial 'click scan' message
  scanButton.disabled = true;
  showStatus("Starting scan...", "info", true); // Show spinner

  // Tell background to start scan (it will clear its cache first)
  chrome.runtime.sendMessage({ type: "START_SCAN", tabId: currentTabId });
  // We don't need to handle response here, status will be updated by other messages
});

/**
 * Message Listener: Handles messages FROM background script.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("Popup received message:", msg.type);

  switch (msg.type) {
    case "SCAN_COMPLETE": // Received results (fresh scan) from background
      populateUI(msg.urls, true); // Show overlay for fresh results
      break;

    case "SCAN_ERROR": // Received error from background (injection or content script)
      showStatus(`Error: ${msg.message || 'Unknown scan error'}`, "danger");
      resetUI(false); // Reset without initial msg
      scanButton.disabled = false; // Re-enable scan button on error
      break;

    case "SCAN_STARTED": // Optional: Background confirms injection started
        showStatus("Scanning page for clips...", "info", true); // Ensure spinner stays
        break;

    // Note: NO_CLIPS_FOUND/CONTENT_SCRIPT_ERROR are now handled via SCAN_COMPLETE/SCAN_ERROR
    // Add other message type handlers if needed
  }
  // Return true if you might use sendResponse asynchronously (not needed here currently)
  // return true;
});

/**
 * Download All Button Click Handler (remains the same)
 */
if (downloadAllButton) { /* ... same as before ... */
    downloadAllButton.addEventListener("click", () => {
        if (currentClipUrls.length === 0) { showStatus("No clips to download.", "warning"); return; }
        downloadAllButton.disabled = true; downloadAllButton.textContent = `Starting ${currentClipUrls.length}...`;
        showStatus(`Initiating download of ${currentClipUrls.length} clips...`, "info");
        const targetFolder = getTargetFolderName();
        chrome.runtime.sendMessage({ type: "DOWNLOAD_ALL_URLS", urls: currentClipUrls, folder: targetFolder }, (response) => {
            downloadAllButton.disabled = false; downloadAllButton.textContent = "Download All";
            if (response?.status === "success") {
                showStatus(`Download started for ${response.count || currentClipUrls.length} clips. Check browser downloads.`, "success");
                videoListArea.querySelectorAll('.btn-download-single.btn-success').forEach(btn => { btn.textContent = "Done"; btn.classList.replace("btn-success", "btn-secondary"); btn.disabled = true; });
            } else {
                showStatus(`Failed to start 'Download All': ${response?.error || 'Unknown error'}`, "danger");
            }
        });
    });
}

// --- Initialisation ---
/**
 * Function to run when the popup opens. Checks for stored state.
 */
async function initializePopup() {
  console.log("Initializing popup...");
  let tab;
  try {
       [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (e) {
       console.error("Error querying tabs:", e);
       resetUI(false);
       showStatus("Error accessing tabs.", "danger");
       return;
  }


  if (!tab?.id || !tab.url) {
      console.error("Could not get active tab info.");
      resetUI(false);
      showStatus("Cannot access current tab info.", "danger");
      return;
  }

  currentTabId = tab.id; // Store tab ID for scan button

  // Check if it's a valid Discord page before asking for results
  if (!tab.url.includes("discord.com/channels/")) {
     console.log("Not a Discord channel page.");
     resetUI(true); // Show normal initial message
     // scanButton.disabled = true; // Optionally disable scan if not on discord
     return;
  }

  console.log(`Requesting stored results for tab ${currentTabId}`);
  // Ask background script for stored results for this tab
  chrome.runtime.sendMessage({ type: "GET_RESULTS_FOR_TAB", tabId: currentTabId }, (response) => {
    if (chrome.runtime.lastError){
        // This often happens if the background script was updated/restarted
        console.warn("Error requesting stored results (might be background restart):", chrome.runtime.lastError.message);
        resetUI(true); // Start fresh if communication failed
        return;
    }

    if (response?.status === "found" && response.data?.urls) {
      console.log("Found stored results. Populating UI without overlay.");
      // Found valid stored data, populate UI without overlay
      populateUI(response.data.urls, false);
    } else {
      console.log(`No valid stored results found (Status: ${response?.status}, Reason: ${response?.reason}). Resetting UI.`);
      // No stored data or it's stale, reset to initial state
      resetUI(true); // Show 'Click Scan' message
    }
  });
}

// Run initialization when the popup DOM is loaded
document.addEventListener('DOMContentLoaded', initializePopup);