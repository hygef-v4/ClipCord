// popup.js (v2.0 - Header, Theme Toggle, Refresh)

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
const themeToggle = document.getElementById('themeToggle'); // Theme button
const themeIconMoon = document.getElementById('themeIconMoon'); // Moon icon
const themeIconSun = document.getElementById('themeIconSun'); // Sun icon
const refreshScanButton = document.getElementById('refreshScanButton'); // Refresh button in header

// --- State Variables ---
let currentClipUrls = []; // Store URLs for Download All functionality
let revealTimeoutId = null;
let currentTabId = null; // Store the active tab ID

// --- Constants ---
const OVERLAY_DELAY_FRESH_SCAN = 4500; // ms for overlay after a new scan
const OVERLAY_DELAY_RESTORE = 600;   // ms for overlay when restoring state
const THEME_STORAGE_KEY = 'discordClipDownloaderTheme'; // Key for storing theme preference

// --- Helper Functions ---

/**
 * Extracts a usable filename from a Discord video URL.
 * @param {string} url - The video URL.
 * @returns {string} A potential filename.
 */
function getFilenameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split("/");
        // Get the last part, removing potential query strings
        let potentialFilename = pathParts.pop() || pathParts.pop(); // Handle trailing slash
        return decodeURIComponent(potentialFilename?.split("?")[0]) || "unknown_clip";
    } catch (e) {
        console.error("Error parsing URL for filename:", url, e);
        return "unknown_clip";
    }
}

/**
 * Displays a status message in the UI.
 * @param {string} message - The text to display.
 * @param {'info'|'success'|'warning'|'danger'|'light'} type - The type of message (Bootstrap alert class).
 * @param {boolean} showScanSpinner - If true, hides the scan button text and shows its spinner.
 */
function showStatus(message, type = "info", showScanSpinner = false) {
    if (!statusMessage || !scanButton || !spinner) return; // Guard clause

    const alertClass = `alert-${type}`;
    statusMessage.className = `alert ${alertClass} mb-2 status-message`; // Use status-message for consistent styling
    statusMessage.textContent = message;
    statusMessage.classList.remove("d-none");

    // Handle scan button spinner visibility
    spinner.classList.toggle("d-none", !showScanSpinner);
    scanButton.querySelector('.button-text')?.classList.toggle('d-none', showScanSpinner);

    // Hide status message text if spinner is shown (spinner takes precedence)
    if (showScanSpinner) {
        statusMessage.classList.add('d-none');
    }
}

/**
 * Gets the target folder name from the input field or placeholder.
 * @returns {string} The target folder name.
 */
function getTargetFolderName() {
    if (!folderNameInput) return "DiscordClips"; // Default if input doesn't exist
    const folderName = folderNameInput.value.trim();
    return folderName || folderNameInput.placeholder || "DiscordClips";
}

/**
 * Handles the download of a single video URL.
 * @param {Event} event - The click event from the download button.
 */
function handleIndividualDownload(event) {
    const button = event.target.closest('button');
    if (!button) return;
    const urlToDownload = button.dataset.url;
    if (!urlToDownload) return;

    button.disabled = true;
    button.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>`; // Indicate loading

    const targetFolder = getTargetFolderName();

    // Check if chrome runtime is available
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "DOWNLOAD_SINGLE_URL", url: urlToDownload, folder: targetFolder }, (response) => {
            // Find the button again in case the list was re-rendered (though unlikely here)
            const currentButton = videoListArea?.querySelector(`button[data-url="${urlToDownload}"]`);
            if (!currentButton) return;

            if (response?.status === "success") {
                currentButton.textContent = "Done";
                currentButton.classList.remove("btn-success"); // Remove original style
                currentButton.classList.add("btn-secondary"); // Add 'done' style
            } else {
                currentButton.textContent = "Failed";
                currentButton.classList.remove("btn-success"); // Remove original style
                currentButton.classList.add("btn-danger"); // Add 'failed' style
                currentButton.disabled = false; // Re-enable on failure
                console.error("Download failed:", response?.error);
                showStatus(`Failed to download ${getFilenameFromUrl(urlToDownload)}. ${response?.error || ''}`, 'danger');
            }
        });
    } else {
        console.error("Chrome runtime context not available for download.");
        button.textContent = "Error";
        button.classList.remove("btn-success");
        button.classList.add("btn-danger");
        // button.disabled = false; // Keep disabled as the action failed fundamentally
        showStatus("Cannot initiate download: Extension context error.", "danger");
    }
}


// --- UI Functions ---

/**
 * Resets the UI to its initial state.
 * @param {boolean} showInitialMessage - Whether to show the "Click Scan" message.
 */
function resetUI(showInitialMessage = true) {
    console.log("Resetting UI. Show initial message:", showInitialMessage);
    clearTimeout(revealTimeoutId);

    // Enable buttons
    if (scanButton) scanButton.disabled = false;
    if (refreshScanButton) refreshScanButton.disabled = false; // Also reset refresh button
    if (downloadAllButton) {
        downloadAllButton.disabled = false;
        downloadAllButton.textContent = "Download All";
    }

    // Hide scan spinner, show text
    if (spinner) spinner.classList.add("d-none");
    scanButton?.querySelector('.button-text')?.classList.remove('d-none');

    // Clear list and hide containers
    if (videoListArea) videoListArea.innerHTML = "";
    videoListContainer?.classList.add("d-none");
    loadingOverlay?.classList.remove("active");
    downloadAllSection?.classList.add("d-none");

    // Reset count and URLs
    if(totalClipCountSpan) totalClipCountSpan.textContent = "0";
    currentClipUrls = [];

    // Show appropriate status message
    if (showInitialMessage && statusMessage) {
        showStatus("Scan or refresh to find clips.", "light"); // Updated initial message
    } else if (statusMessage) {
        statusMessage.classList.add("d-none");
    }
}

/**
 * Populates the UI list with video URLs.
 * @param {string[]} urls - Array of video URLs.
 * @param {number} overlayDelayMs - Duration in ms to show the overlay. 0 or less means no overlay.
 */
function populateUI(urls, overlayDelayMs = 0) {
    console.log(`Populating UI with ${urls.length} URLs. Overlay delay: ${overlayDelayMs}ms`);
    currentClipUrls = urls; // Store for download all

    if (!videoListArea || !videoListContainer || !downloadAllSection || !totalClipCountSpan || !loadingOverlay) {
        console.error("One or more UI elements missing for populateUI.");
        return;
    }

    videoListArea.innerHTML = ""; // Clear previous list

    if (!Array.isArray(urls) || urls.length === 0) {
        resetUI(false); // Reset but don't show the initial message
        showStatus("Scan found 0 clips.", "warning");
        if (scanButton) scanButton.disabled = false; // Ensure buttons are enabled
        if (refreshScanButton) refreshScanButton.disabled = false;
        return;
    }

    // Update status message while building
    showStatus(`Building list for ${urls.length} clip(s)...`, "info", false);

    const fragment = document.createDocumentFragment();
    urls.forEach((url) => {
        const listItem = document.createElement("div");
        listItem.className = "list-group-item d-flex align-items-center justify-content-between p-2 flex-shrink-0"; // Using styles from HTML

        const infoContainer = document.createElement('div');
        infoContainer.className = "d-flex align-items-center me-2";
        infoContainer.style.minWidth = '0'; // Prevent flex item from overflowing
        infoContainer.style.flexGrow = '1';

        const videoThumbnail = document.createElement("video");
        videoThumbnail.src = url;
        videoThumbnail.width = 80; // Keep consistent size
        videoThumbnail.height = 45;
        videoThumbnail.muted = true;
        videoThumbnail.preload = "metadata";
        // videoThumbnail.style.backgroundColor = "#e9ecef"; // REMOVED - Use CSS var --bg-tertiary now

        let playTimeout;
        const canInteractInitially = overlayDelayMs <= 0; // Interaction allowed if no planned overlay

        // Hover effect for video preview
        listItem.addEventListener("mouseenter", () => {
            // Check current overlay state *and* if interaction was initially allowed
            if ((canInteractInitially || !loadingOverlay.classList.contains('active'))) {
                videoThumbnail.currentTime = 0;
                videoThumbnail.play().catch(() => {}); // Ignore play errors (e.g., user hasn't interacted yet)
                clearTimeout(playTimeout);
                playTimeout = setTimeout(() => videoThumbnail.pause(), 1500); // Pause after 1.5s
            }
        });
        listItem.addEventListener("mouseleave", () => {
             if ((canInteractInitially || !loadingOverlay.classList.contains('active'))) {
                clearTimeout(playTimeout);
                videoThumbnail.pause();
                videoThumbnail.currentTime = 0;
            }
        });

        const textSpan = document.createElement("span");
        textSpan.className = "clip-name"; // Use class from HTML for styling
        const filename = getFilenameFromUrl(url);
        textSpan.textContent = filename;
        textSpan.title = filename; // Tooltip for long names

        // Use a consistent base class + modifiers for the button
        const downloadBtn = document.createElement("button");
        downloadBtn.className = "btn btn-sm btn-download-single"; // Base class
        downloadBtn.classList.add("btn-success"); // Initial state style (will be replaced on download)
        downloadBtn.textContent = "Download";
        downloadBtn.dataset.url = url; // Store URL for the handler
        downloadBtn.addEventListener("click", handleIndividualDownload); // Attach the handler

        infoContainer.appendChild(videoThumbnail);
        infoContainer.appendChild(textSpan);
        listItem.appendChild(infoContainer);
        listItem.appendChild(downloadBtn);
        fragment.appendChild(listItem);
    });

    // --- Append fragment and Update UI Sections ---
    videoListArea.appendChild(fragment);
    videoListContainer.classList.remove("d-none");
    downloadAllSection.classList.remove("d-none");
    totalClipCountSpan.textContent = urls.length;

    // Re-enable main buttons after list is populated (before overlay timeout)
    // Overlay timeout will handle the final status message.
    if (scanButton) scanButton.disabled = false;
    if (refreshScanButton) refreshScanButton.disabled = false;
    if (downloadAllButton) downloadAllButton.disabled = false;


    // --- Handle Overlay and Final Status ---
    if (overlayDelayMs > 0) {
        loadingOverlay.classList.add("active"); // Show overlay
        showStatus(`Loading ${urls.length} previews...`, "info", false); // Update status while overlay is active
        clearTimeout(revealTimeoutId); // Clear any existing timeout
        revealTimeoutId = setTimeout(() => {
            loadingOverlay.classList.remove("active"); // Fade out overlay
            showStatus(`Found ${urls.length} clips. Ready!`, "success", false); // Final success status
            // Buttons should already be enabled here from above
        }, overlayDelayMs); // Use the specified delay
    } else {
        // No overlay requested
        loadingOverlay.classList.remove("active"); // Ensure overlay is hidden
        showStatus(`Found ${urls.length} clips. Ready!`, "success", false); // Final status immediately
        // Buttons already enabled
    }
}


// --- Theme Functions ---

/**
 * Applies the specified theme (light or dark) to the UI.
 * @param {'light' | 'dark'} theme - The theme to apply.
 */
function applyTheme(theme) {
    const body = document.body;
    if (!body || !themeIconMoon || !themeIconSun || !themeToggle) {
        console.warn("Theme elements not found, cannot apply theme.");
        return;
    }

    if (theme === 'dark') {
        body.classList.add('dark-mode');
        themeIconMoon.classList.add('d-none'); // Hide moon
        themeIconSun.classList.remove('d-none'); // Show sun
        themeToggle.setAttribute('title', 'Switch to Light Mode');
    } else {
        body.classList.remove('dark-mode');
        themeIconMoon.classList.remove('d-none'); // Show moon
        themeIconSun.classList.add('d-none'); // Hide sun
        themeToggle.setAttribute('title', 'Switch to Dark Mode');
    }
    // console.log(`Theme applied: ${theme}`);
}

/**
 * Handles clicks on the theme toggle button.
 */
function handleThemeToggle() {
    const isDarkMode = document.body.classList.contains('dark-mode');
    const newTheme = isDarkMode ? 'light' : 'dark';
    applyTheme(newTheme);

    // Save preference using Chrome storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [THEME_STORAGE_KEY]: newTheme }, () => {
            if (chrome.runtime.lastError) {
                console.error("Error saving theme preference:", chrome.runtime.lastError);
            } else {
                // console.log(`Theme preference saved: ${newTheme}`);
            }
        });
    } else {
        console.warn("Chrome storage API not available. Theme preference not saved.");
    }
}

/**
 * Loads the saved theme preference from storage and applies it.
 * Returns a Promise that resolves when the theme is applied or default is used.
 */
function loadAndApplyTheme() {
    return new Promise((resolve) => {
         if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            console.warn("Chrome storage API not available. Defaulting to light theme.");
            applyTheme('light');
            resolve();
            return;
        }
         chrome.storage.local.get(THEME_STORAGE_KEY, (result) => {
             if (chrome.runtime.lastError) {
                 console.error("Error loading theme preference:", chrome.runtime.lastError);
                 applyTheme('light'); // Default to light on error
             } else {
                 // Default to light if no setting found or if value is invalid
                 const preferredTheme = result[THEME_STORAGE_KEY] === 'dark' ? 'dark' : 'light';
                 applyTheme(preferredTheme);
             }
            resolve(); // Resolve the promise after applying theme
        });
    });
}


// --- Event Listeners Setup ---

function setupEventListeners() {
    // Scan Button (Main)
    scanButton?.addEventListener("click", () => {
        if (!currentTabId) { showStatus("Could not get active tab ID.", "danger"); return; }
        resetUI(false); // Reset UI but don't show the "Scan to find" message yet
        if (scanButton) scanButton.disabled = true; // Disable buttons immediately
        if (refreshScanButton) refreshScanButton.disabled = true;
        showStatus("Starting scan...", "info", true); // Show spinner and message
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: "START_SCAN", tabId: currentTabId });
        } else {
             showStatus("Extension context error.", "danger");
             if (scanButton) scanButton.disabled = false; // Re-enable on fundamental error
             if (refreshScanButton) refreshScanButton.disabled = false;
        }
    });

    // Refresh Button (Header)
    refreshScanButton?.addEventListener('click', () => {
        // Simulate a click on the main scan button for simplicity
        // This ensures consistent behavior (resetting UI, disabling buttons, showing spinner)
        scanButton?.click();
    });

    // Theme Toggle Button
    themeToggle?.addEventListener('click', handleThemeToggle);

    // Download All Button
    downloadAllButton?.addEventListener("click", () => {
        if (currentClipUrls.length === 0) {
            showStatus("No clips to download.", "warning");
            return;
        }
        downloadAllButton.disabled = true;
        downloadAllButton.textContent = `Starting ${currentClipUrls.length}...`;
        showStatus(`Initiating download of ${currentClipUrls.length} clips...`, "info");
        const targetFolder = getTargetFolderName();

        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ type: "DOWNLOAD_ALL_URLS", urls: currentClipUrls, folder: targetFolder }, (response) => {
                downloadAllButton.disabled = false; // Re-enable after response
                downloadAllButton.textContent = "Download All"; // Reset text

                if (response?.status === "success") {
                    const count = response.count || currentClipUrls.length;
                    showStatus(`Download started for ${count} clips. Check browser downloads.`, "success");
                    // Mark all non-failed/non-done buttons as done
                    videoListArea?.querySelectorAll('.btn-download-single:not(.btn-secondary):not(.btn-danger)')
                        .forEach(btn => {
                            btn.textContent = "Done";
                            btn.classList.remove("btn-success"); // Remove initial style if present
                            btn.classList.add("btn-secondary"); // Add done style
                            btn.disabled = true;
                        });
                } else {
                    showStatus(`Failed to start 'Download All': ${response?.error || 'Unknown error'}`, "danger");
                }
            });
        } else {
             console.error("Chrome runtime context not available for download all.");
             downloadAllButton.disabled = false;
             downloadAllButton.textContent = "Download All";
             showStatus("Cannot initiate download: Extension context error.", "danger");
        }
    });

    // Listener for messages FROM background script
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            console.log("Popup received message:", msg.type);
            switch (msg.type) {
                case "SCAN_COMPLETE":
                    populateUI(msg.urls || [], OVERLAY_DELAY_FRESH_SCAN); // Ensure urls is array, use long delay
                    break;
                case "SCAN_ERROR":
                    showStatus(`Error: ${msg.message || 'Unknown scan error'}`, "danger");
                    resetUI(false); // Reset but don't show initial message
                    if (scanButton) scanButton.disabled = false; // Re-enable buttons on error
                    if (refreshScanButton) refreshScanButton.disabled = false;
                    break;
                case "SCAN_STARTED": // Background confirms injection started
                    showStatus("Scanning page for clips...", "info", true); // Update status
                    break;
                 // Add other message types if needed
            }
        });
    }
}


// --- Initialisation ---
/**
 * Runs when the popup opens. Loads theme, gets tab info, requests stored state.
 */
async function initializePopup() {
    console.log("Initializing popup content...");
    let tab;

    // Check Chrome APIs are available
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.runtime) {
        console.error("Chrome APIs not available.");
        resetUI(false);
        showStatus("Error: Extension context lost.", "danger");
        // Disable buttons if they exist
        if(scanButton) scanButton.disabled = true;
        if(refreshScanButton) refreshScanButton.disabled = true;
        if(downloadAllButton) downloadAllButton.disabled = true;
        return;
    }

    try {
        [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch (e) {
        console.error("Error querying tabs:", e);
        resetUI(false);
        showStatus("Error accessing tab information.", "danger");
        return;
    }

    if (!tab?.id || !tab.url) {
        console.error("Could not get active tab info.");
        resetUI(false);
        showStatus("Cannot access current tab info.", "danger");
        return;
    }
    currentTabId = tab.id;

    // Check if on a valid Discord channel page
    if (!tab.url.includes("discord.com/channels/")) {
        console.log("Not a Discord channel page.");
        resetUI(true); // Show initial message
        if (scanButton) scanButton.disabled = true; // Disable scan buttons
        if (refreshScanButton) refreshScanButton.disabled = true;
        return; // Stop initialization here
    }

    // Enable buttons if on the correct page
    if (scanButton) scanButton.disabled = false;
    if (refreshScanButton) refreshScanButton.disabled = false;

    console.log(`Requesting stored results for tab ${currentTabId}`);
    showStatus("Loading results...", "info"); // Initial status

    // Request results from background
    chrome.runtime.sendMessage({ type: "GET_RESULTS_FOR_TAB", tabId: currentTabId }, (response) => {
        if (chrome.runtime.lastError) {
            // Often happens if the background script was updated/reloaded
            console.warn("Error requesting stored results:", chrome.runtime.lastError.message);
            resetUI(true); // Show initial "Scan to find" message
            return;
        }

        if (response?.status === "found" && Array.isArray(response.data?.urls)) {
            console.log("Found stored results. Populating UI with short overlay.");
            populateUI(response.data.urls, OVERLAY_DELAY_RESTORE); // Use short delay for restore
        } else {
            console.log(`No valid stored results found (Status: ${response?.status}, Reason: ${response?.reason}). Ready to scan.`);
            resetUI(true); // Show the initial 'Scan or refresh' message
        }
    });
}

// --- Run Initialization on DOM Load ---
document.addEventListener('DOMContentLoaded', async () => {
    await loadAndApplyTheme(); // Load and apply theme FIRST
    setupEventListeners();     // Setup listeners AFTER theme is applied and DOM ready
    initializePopup();         // Initialize content AFTER theme and listeners
});