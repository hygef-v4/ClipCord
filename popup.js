// Get references to UI elements
const scanButton = document.getElementById('scanButton');
const statusArea = document.getElementById('statusArea');
const spinner = document.getElementById('spinner');
const statusMessage = document.getElementById('statusMessage');
const videoListArea = document.getElementById('videoListArea');
const downloadAllSection = document.getElementById('downloadAllSection');
const downloadAllButton = document.getElementById('downloadAllButton');
const totalClipCountSpan = document.getElementById('totalClipCount');

let currentClipUrls = []; // Store the URLs found in the current scan

// --- Helper Functions ---

function showStatus(message, type = 'info', showSpinner = false) {
    statusMessage.classList.remove('alert-info', 'alert-success', 'alert-warning', 'alert-danger', 'alert-light', 'd-none');
    spinner.classList.add('d-none'); // Hide spinner by default
    statusMessage.textContent = message;
    statusMessage.classList.add(`alert-${type}`);
    statusMessage.classList.remove('d-none'); // Ensure message area is visible

    if (showSpinner) {
        spinner.classList.remove('d-none');
        statusMessage.classList.add('d-none'); // Hide text message when spinner is active
    } else {
        spinner.classList.add('d-none'); // Ensure spinner is hidden if not requested
        statusMessage.classList.remove('d-none'); // Ensure text is visible
    }
}

function resetUI() {
    scanButton.disabled = false;
    videoListArea.innerHTML = ''; // Clear the video list
    videoListArea.classList.add('d-none'); // Hide list area
    downloadAllSection.classList.add('d-none'); // Hide Download All section
    downloadAllButton.disabled = false; // Re-enable button
    totalClipCountSpan.textContent = '0'; // Reset count in button text
    downloadAllButton.textContent = `Download All Clips (${totalClipCountSpan.textContent})`; // Reset text
    currentClipUrls = []; // Clear stored URLs
    showStatus('Click \'Scan\' to find clips.', 'light');
}

// Extracts a potential filename from URL
function getFilenameFromUrl(url) {
     try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        const potentialFilename = pathParts.pop();
        if (potentialFilename && potentialFilename.includes('.')) {
            // Decode URI components and remove query string
            return decodeURIComponent(potentialFilename.split('?')[0]);
        }
    } catch (e) { /* Ignore errors, fallback below */ }
    // Fallback if parsing fails or no filename found
    const fallback = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
    return fallback || 'unknown_clip'; // Ensure it returns something
}

// --- Event Handlers ---

// Handles click on an individual download button
function handleIndividualDownload(event) {
    const button = event.target;
    const urlToDownload = button.dataset.url;

    if (!urlToDownload) {
        console.error("No URL found on button:", button);
        return;
    }

    button.disabled = true;
    button.textContent = 'Starting...';

    chrome.runtime.sendMessage({ type: 'DOWNLOAD_SINGLE_URL', url: urlToDownload }, (response) => {
        if (chrome.runtime.lastError) {
            // Handle cases where the background script might have issues sending response
            console.error("Error receiving response for DOWNLOAD_SINGLE_URL:", chrome.runtime.lastError.message);
            button.textContent = 'Error';
            button.classList.remove('btn-success');
            button.classList.add('btn-danger');
        } else if (response && response.status === 'success') {
            button.textContent = 'Done';
            button.classList.remove('btn-success');
            button.classList.add('btn-secondary'); // Visually indicate completion
        } else {
            // Handle explicit failure response from background
            console.error("Download initiation failed:", response?.message);
            button.textContent = 'Failed';
            button.classList.remove('btn-success');
            button.classList.add('btn-danger');
        }
        // Note: Button state shows final status (Done/Failed/Error)
    });
}

// Handler for Download All button
downloadAllButton.addEventListener('click', () => {
    if (currentClipUrls.length === 0) {
        showStatus('No clips found to download.', 'warning');
        return;
    }

    downloadAllButton.disabled = true;
    downloadAllButton.textContent = 'Starting All...';
    showStatus(`Initiating download for ${currentClipUrls.length} clips...`, 'info');

    // Disable individual buttons as well
    videoListArea.querySelectorAll('.btn-download-single').forEach(btn => btn.disabled = true);

    chrome.runtime.sendMessage({ type: 'DOWNLOAD_ALL_URLS', urls: currentClipUrls }, (response) => {
         if (chrome.runtime.lastError) {
            console.error("Error receiving response for DOWNLOAD_ALL_URLS:", chrome.runtime.lastError.message);
            showStatus(`Error starting downloads: ${chrome.runtime.lastError.message}`, 'danger');
            // Re-enable button on error
            downloadAllButton.disabled = false;
            downloadAllButton.textContent = `Download All Clips (${currentClipUrls.length})`;
             videoListArea.querySelectorAll('.btn-download-single').forEach(btn => {
                 // Re-enable only if not already 'Done' or 'Failed'
                 if (!btn.classList.contains('btn-secondary') && !btn.classList.contains('btn-danger')) {
                    btn.disabled = false;
                 }
             });
        } else if (response && response.status === 'success') {
            showStatus(`${response.count} downloads initiated! Check Chrome Downloads.`, 'success');
            // Keep button disabled after success, change text
             downloadAllButton.textContent = 'Downloads Started';
             // Mark individual buttons as done (or starting)
             videoListArea.querySelectorAll('.btn-download-single').forEach(btn => {
                 if (!btn.disabled) { // Only affect buttons not already individually handled
                    btn.textContent = 'Done';
                    btn.classList.remove('btn-success');
                    btn.classList.add('btn-secondary');
                    btn.disabled = true;
                 }
             });
        } else {
             showStatus(`Failed to initiate all downloads: ${response?.message || 'Unknown error'}`, 'danger');
             downloadAllButton.disabled = false; // Re-enable on failure
             downloadAllButton.textContent = `Download All Clips (${currentClipUrls.length})`;
             videoListArea.querySelectorAll('.btn-download-single').forEach(btn => {
                if (!btn.classList.contains('btn-secondary') && !btn.classList.contains('btn-danger')) {
                   btn.disabled = false;
                }
            });
        }
    });
});


// Handler for Scan button
scanButton.addEventListener('click', async () => {
    resetUI(); // Clear previous results and status first
    scanButton.disabled = true;
    showStatus('Scanning page...', 'info', true);

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            throw new Error('Could not find active tab.');
        }
        // Stricter URL check for Discord channel/DM context
        if (!tab.url || !(tab.url.startsWith('https://discord.com/channels/') || tab.url.startsWith('https://ptb.discord.com/channels/'))) {
             throw new Error('Please navigate to a Discord channel or DM page.');
        }

        // Send message to background script to start the process
        chrome.runtime.sendMessage({ type: 'START_SCAN', tabId: tab.id }, (response) => {
            // This response is primarily for acknowledging the message receipt or immediate errors
            if (chrome.runtime.lastError) {
                // This catches the "port closed" error if background doesn't respond correctly
                console.error("Error sending START_SCAN message:", chrome.runtime.lastError.message);
                showStatus(`Error initiating scan: ${chrome.runtime.lastError.message}`, 'danger');
                resetUI(); // Reset fully on initiation error
            } else if (response && response.status === 'error') {
                // Handle explicit errors sent back immediately by background
                showStatus(`Error: ${response.message}`, 'danger');
                 resetUI();
            } else if (response && response.status === 'received') {
                // Background acknowledged the request, now waiting for SCAN_COMPLETE or SCAN_ERROR
                console.log("Background acknowledged START_SCAN request.");
                // Status remains "Scanning..."
            } else {
                // Unexpected response
                console.warn("Unexpected response to START_SCAN:", response);
            }
            // Actual scan results handled by the 'SCAN_COMPLETE' / 'SCAN_ERROR' message listener below
        });

    } catch (error) {
        console.error("Error during scan initiation:", error);
        showStatus(`Error: ${error.message}`, 'danger');
        resetUI(); // Reset fully on error
    }
});

// Listen for messages FROM the background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("Popup received message from background:", msg);

    switch (msg.type) {
        case 'SCAN_COMPLETE':
            const urls = msg.urls;
            currentClipUrls = urls; // Store URLs
            const count = urls.length;
            videoListArea.innerHTML = ''; // Clear previous list items

            if (count > 0) {
                showStatus(`Found ${count} video clip(s).`, 'success');
                urls.forEach((url, index) => {
                    const listItem = document.createElement('div');
                    listItem.className = 'list-group-item d-flex justify-content-between align-items-center';

                    const textSpan = document.createElement('span');
                    textSpan.className = 'clip-name';
                    const filename = getFilenameFromUrl(url);
                    // Keep text short, use title for full URL/filename
                    textSpan.textContent = `Clip ${index + 1} (${filename.length > 25 ? filename.substring(0, 22) + '...' : filename})`;
                    textSpan.title = `${filename}\n${url}`; // Tooltip shows full filename and URL

                    const downloadBtn = document.createElement('button');
                    downloadBtn.className = 'btn btn-success btn-sm btn-download-single';
                    downloadBtn.textContent = 'Download';
                    downloadBtn.dataset.url = url; // Store URL on the button
                    downloadBtn.addEventListener('click', handleIndividualDownload);

                    listItem.appendChild(textSpan);
                    listItem.appendChild(downloadBtn);
                    videoListArea.appendChild(listItem);
                });
                videoListArea.classList.remove('d-none'); // Show the list area

                // Show and update Download All button
                totalClipCountSpan.textContent = count;
                downloadAllButton.textContent = `Download All Clips (${count})`;
                downloadAllSection.classList.remove('d-none'); // Make section visible
                downloadAllButton.disabled = false; // Ensure button is enabled

            } else {
                showStatus('No video clips found on this page.', 'warning');
                videoListArea.classList.add('d-none');
                downloadAllSection.classList.add('d-none'); // Keep Download All hidden
                currentClipUrls = []; // Clear urls
            }
            scanButton.disabled = false; // Re-enable scan button AFTER processing is complete
            break; // Important: Added break

        case 'SCAN_ERROR':
             showStatus(`Error during scan: ${msg.message}`, 'danger');
             resetUI(); // Reset UI fully on scan error
             break; // Important: Added break

        default:
            console.log("Popup received unhandled message type:", msg.type);
            break; // Important: Added break
    }

    // No need to return true here, as this listener doesn't send async responses itself.
    return false;
});

// Initialize UI on popup open
document.addEventListener('DOMContentLoaded', () => {
    resetUI();
});