// popup.js

// --- Get DOM Elements ---
const videoListContainer = document.getElementById("videoListContainer"); // Wrapper div
const videoListArea = document.getElementById("videoListArea");       // Actual list container
const loadingOverlay = document.getElementById("loadingOverlay");     // Blur overlay
const downloadAllSection = document.getElementById("downloadAllSection");
const totalClipCountSpan = document.getElementById("totalClipCount");
const scanButton = document.getElementById("scanButton");
const folderNameInput = document.getElementById("folderNameInput");
const statusMessage = document.getElementById("statusMessage");
const spinner = document.getElementById("spinner");                 // Spinner for the main scan button
const downloadAllButton = document.getElementById("downloadAllButton"); // Download All button

// --- State Variables ---
let currentClipUrls = [];
let revealTimeoutId = null; // To store the timeout ID for the overlay reveal

// --- Helper Functions ---

/**
 * Extracts a usable filename from a URL.
 * @param {string} url - The URL to parse.
 * @returns {string} A decoded filename or 'unknown_clip'.
 */
function getFilenameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/");
    // Handle potential empty strings if URL ends with /
    let potentialFilename = pathParts.pop() || pathParts.pop();
    // Remove query parameters and decode
    return decodeURIComponent(potentialFilename?.split("?")[0]) || "unknown_clip";
  } catch (e) {
    console.error("Error parsing URL:", url, e);
    return "unknown_clip";
  }
}

/**
 * Updates the status message area.
 * @param {string} message - The text message to display.
 * @param {string} [type='info'] - Bootstrap alert type (e.g., 'info', 'success', 'warning', 'danger').
 * @param {boolean} [showSpinner=false] - Whether to show the spinner *instead* of the text message.
 */
function showStatus(message, type = "info", showScanSpinner = false) {
  statusMessage.className = `alert alert-${type} mb-2`; // Apply Bootstrap classes

  // Control visibility of the main scan button's spinner
  spinner.classList.toggle("d-none", !showScanSpinner);

  // Set text content for the status message area
  statusMessage.textContent = message;

  // Show the status message area (unless the main scan spinner is active)
  statusMessage.classList.toggle("d-none", showScanSpinner);
}


/**
 * Resets the UI to its initial state.
 */
function resetUI() {
  clearTimeout(revealTimeoutId); // Clear any pending reveal timeout
  scanButton.disabled = false;
  videoListArea.innerHTML = ""; // Clear list items
  videoListContainer.classList.add("d-none"); // Hide the list container (which includes list + overlay)
  loadingOverlay.classList.remove("active"); // Ensure overlay is hidden/inactive
  downloadAllSection.classList.add("d-none"); // Hide download all section
  if (downloadAllButton) downloadAllButton.disabled = false; // Reset download all button
  totalClipCountSpan.textContent = "0";
  currentClipUrls = [];
  showStatus("Click 'Scan' to find clips.", "light"); // Initial status message
}

/**
 * Gets the target folder name for downloads from the input field.
 * @returns {string} The trimmed folder name or a default value.
 */
function getTargetFolderName() {
  const folderName = folderNameInput.value.trim();
  // Use placeholder as default if input is empty
  return folderName || folderNameInput.placeholder || "DiscordClips";
}

/**
 * Handles the click event for individual download buttons.
 * @param {Event} event - The click event object.
 */
function handleIndividualDownload(event) {
  const button = event.target.closest('button'); // Get the button element
  if (!button) return;

  const urlToDownload = button.dataset.url;
  if (!urlToDownload) return;

  button.disabled = true;
  button.textContent = "Starting..."; // Update button text
  const targetFolder = getTargetFolderName();

  chrome.runtime.sendMessage(
    { type: "DOWNLOAD_SINGLE_URL", url: urlToDownload, folder: targetFolder },
    (response) => {
      // Check if the button still exists in the DOM (user might have rescanned)
      const currentButton = videoListArea.querySelector(`button[data-url="${urlToDownload}"]`);
      if (!currentButton) return; // Button is gone, do nothing

      if (response?.status === "success") {
        currentButton.textContent = "Done";
        currentButton.classList.replace("btn-success", "btn-secondary");
        // Button remains disabled to indicate completion
      } else {
        currentButton.textContent = "Failed";
        currentButton.classList.replace("btn-success", "btn-danger");
        currentButton.disabled = false; // Allow retry on failure
        console.error("Download failed:", response?.error);
        // Optionally show a more specific error message to the user
      }
    }
  );
}

// --- Event Listeners ---

/**
 * Scan Button Click Handler: Initiates the content script injection.
 */
scanButton.addEventListener("click", async () => {
  resetUI(); // Reset UI before starting
  scanButton.disabled = true;
  showStatus("Scanning page for clips...", "info", true); // Show spinner on scan button

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Validate if the current tab is a Discord channel
    if (!tab?.id || !tab.url || !tab.url.includes("discord.com/channels/")) {
      showStatus("Error: Please navigate to a Discord channel page first.", "danger");
      resetUI(); // Keep UI reset
      scanButton.disabled = false; // Re-enable scan button
      return;
    }

    // Inject the content script
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-script.js'] // Make sure this filename matches your content script
    }, (injectionResults) => {
        if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
            // Handle injection failure
            console.error("Script injection failed:", chrome.runtime.lastError);
            showStatus(`Error injecting script: ${chrome.runtime.lastError?.message || 'Unknown error'}`, "danger");
            resetUI();
            scanButton.disabled = false; // Re-enable scan button on injection failure
        } else {
            // Script injected successfully. The message listener below will handle the results.
            console.log("Content script injected successfully. Waiting for results...");
             // Status remains "Scanning page..." (set above)
        }
    });

  } catch (error) {
      // Handle errors during tab querying or other async operations
      console.error("Error during scan initiation:", error);
      showStatus(`Error: ${error.message}`, "danger");
      resetUI();
      scanButton.disabled = false;
  }
});

/**
 * Message Listener: Handles messages from background or content scripts.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("Popup received message:", msg.type); // Log message type for debugging

  switch (msg.type) {
    case "DISCORD_CLIP_URLS":
      clearTimeout(revealTimeoutId); // Clear any previous reveal timeout
      const urls = msg.urls;
      currentClipUrls = urls; // Store URLs globally in the popup scope
      videoListArea.innerHTML = ""; // Clear previous results

      if (urls.length > 0) {
        // Update status - building list (scan button spinner can be hidden now)
        showStatus(`Found ${urls.length} clip(s). Building list...`, "info", false);

        const fragment = document.createDocumentFragment(); // Use fragment for performance

        urls.forEach((url, index) => {
          // Create list item elements
          const listItem = document.createElement("div");
          listItem.className = "list-group-item d-flex align-items-center justify-content-between p-2 flex-shrink-0";

          const infoContainer = document.createElement('div');
          infoContainer.className = "d-flex align-items-center me-2";
          infoContainer.style.minWidth = '0';
          infoContainer.style.flexGrow = '1';

          const videoThumbnail = document.createElement("video");
          videoThumbnail.src = url;
          videoThumbnail.width = 80;
          videoThumbnail.height = 45;
          videoThumbnail.muted = true;
          videoThumbnail.preload = "metadata"; // Crucial for performance
          videoThumbnail.style.marginRight = '10px';
          videoThumbnail.style.flexShrink = '0';
          videoThumbnail.style.objectFit = 'cover'; // Make video cover the area

          // Hover play/pause logic (only active when overlay is hidden)
          let playTimeout;
          listItem.addEventListener("mouseenter", () => {
            if (!loadingOverlay.classList.contains('active')) { // Check if overlay is inactive
              videoThumbnail.currentTime = 0;
              videoThumbnail.play().catch((e) => { /* Ignore harmless play errors */ });
              clearTimeout(playTimeout);
              playTimeout = setTimeout(() => videoThumbnail.pause(), 1500);
            }
          });
          listItem.addEventListener("mouseleave", () => {
            if (!loadingOverlay.classList.contains('active')) { // Check if overlay is inactive
              clearTimeout(playTimeout);
              videoThumbnail.pause();
              videoThumbnail.currentTime = 0;
            }
          });

          const textSpan = document.createElement("span");
          textSpan.className = "clip-name text-truncate"; // Enable truncation
          textSpan.style.whiteSpace = 'nowrap';
          textSpan.style.overflow = 'hidden';
          textSpan.style.textOverflow = 'ellipsis';
          const filename = getFilenameFromUrl(url);
          textSpan.textContent = filename;
          textSpan.title = filename; // Show full name on hover

          const downloadBtn = document.createElement("button");
          downloadBtn.className = "btn btn-success btn-sm btn-download-single ms-auto flex-shrink-0";
          downloadBtn.textContent = "Download";
          downloadBtn.dataset.url = url;
          downloadBtn.addEventListener("click", handleIndividualDownload);

          // Append elements to the list item structure
          infoContainer.appendChild(videoThumbnail);
          infoContainer.appendChild(textSpan);
          listItem.appendChild(infoContainer);
          listItem.appendChild(downloadBtn);

          // Append the completed list item to the fragment
          fragment.appendChild(listItem);
        });

        // --- UI Update and Overlay Logic ---
        // 1. Add all items at once to the DOM
        videoListArea.appendChild(fragment);

        // 2. Make the list container visible (it holds the list and the overlay)
        videoListContainer.classList.remove("d-none");

        // 3. Activate the loading overlay (makes it visible, blurred, and blocks clicks)
        loadingOverlay.classList.add("active");

        // 4. Show the 'Download All' section and update the total count
        downloadAllSection.classList.remove("d-none");
        totalClipCountSpan.textContent = urls.length;

        // 5. Update status to indicate previews are loading behind the overlay
        showStatus(`Loading ${urls.length} previews...`, "info", false);

        // 6. Set a timer to hide the overlay after a delay
        const revealDelay = 4500; // 4.5 seconds delay (adjust as needed)
        revealTimeoutId = setTimeout(() => {
          loadingOverlay.classList.remove("active"); // Hide overlay (triggers CSS fade-out)
          showStatus(`Loaded ${urls.length} clips. Ready!`, "success", false); // Final success status
          scanButton.disabled = false; // Re-enable scan button
          if (downloadAllButton) downloadAllButton.disabled = false; // Ensure download all button is enabled
        }, revealDelay);

      } else {
        // Case: Scan finished, but 0 URLs found
        showStatus("Scan complete. No video clips found on the page.", "warning");
        resetUI(); // Reset UI elements
        scanButton.disabled = false; // Re-enable scan button
      }
      break; // End of DISCORD_CLIP_URLS case

    case "NO_CLIPS_FOUND":
      // Handle specific message from content script indicating no clips were found
      showStatus("Scan complete. No video clips found on the page.", "warning");
      resetUI();
      scanButton.disabled = false;
      break;

    case "CONTENT_SCRIPT_ERROR":
      // Handle errors reported by the content script during its execution
      showStatus(`Error during scan: ${msg.message || 'Unknown content script error'}`, "danger");
      resetUI();
      scanButton.disabled = false;
      break;

    // Add cases for other message types if needed (e.g., download progress)
    // default:
    //   console.log("Unhandled message type:", msg.type);
  }

  // Return true to indicate you might send a response asynchronously.
  // This is important if any part of your message handler uses async operations
  // or relies on callbacks like the one in `handleIndividualDownload`.
  return true;
});


/**
 * Download All Button Click Handler
 */
if (downloadAllButton) {
    downloadAllButton.addEventListener("click", () => {
        if (currentClipUrls.length === 0) {
            showStatus("No clips to download.", "warning");
            return;
        }

        // Disable button immediately
        downloadAllButton.disabled = true;
        downloadAllButton.textContent = `Starting ${currentClipUrls.length}...`;
        showStatus(`Initiating download of ${currentClipUrls.length} clips...`, "info");

        const targetFolder = getTargetFolderName();

        // Send message to background script to handle downloads
        chrome.runtime.sendMessage(
            { type: "DOWNLOAD_ALL_URLS", urls: currentClipUrls, folder: targetFolder },
            (response) => {
                // Re-enable button regardless of success/failure for potential retry
                downloadAllButton.disabled = false;
                downloadAllButton.textContent = "Download All";

                if (response?.status === "success") {
                    showStatus(`Download started for ${currentClipUrls.length} clips. Check browser downloads.`, "success");
                     // Optionally update individual buttons visually
                     videoListArea.querySelectorAll('.btn-download-single.btn-success').forEach(btn => {
                        btn.textContent = "Done";
                        btn.classList.replace("btn-success", "btn-secondary");
                        btn.disabled = true; // Mark as done
                     });
                } else {
                    showStatus(`Failed to start 'Download All': ${response?.error || 'Unknown error'}`, "danger");
                }
            }
        );
    });
}


// --- Initial Setup ---
// Reset the UI when the popup opens
resetUI();