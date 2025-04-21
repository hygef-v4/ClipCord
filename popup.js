// Get references to UI elements
const scanButton = document.getElementById('scanButton');
const downloadButton = document.getElementById('downloadButton');
const downloadSection = document.getElementById('downloadSection');
const statusArea = document.getElementById('statusArea');
const spinner = document.getElementById('spinner');
const statusMessage = document.getElementById('statusMessage');
const clipCountSpan = document.getElementById('clipCount');

let foundUrls = []; // To store URLs found by the content script

// --- Helper Functions ---

function showStatus(message, type = 'info', showSpinner = false) {
    // Reset classes first
    statusMessage.classList.remove('alert-info', 'alert-success', 'alert-warning', 'alert-danger', 'd-none');
    spinner.classList.add('d-none'); // Hide spinner by default

    // Set message and type
    statusMessage.textContent = message;
    statusMessage.classList.add(`alert-${type}`);

    if (showSpinner) {
        spinner.classList.remove('d-none');
        statusMessage.classList.add('d-none'); // Hide text message when spinner is active
    }
}

function resetUI() {
    scanButton.disabled = false;
    downloadSection.classList.add('d-none');
    foundUrls = [];
    clipCountSpan.textContent = '0';
    showStatus('Click \'Scan\' to find clips.', 'light');
}

// --- Event Listeners ---

scanButton.addEventListener('click', async () => {
    scanButton.disabled = true;
    downloadSection.classList.add('d-none'); // Hide download button during scan
    showStatus('Scanning page...', 'info', true); // Show spinner

    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (!tab) {
            showStatus('Could not find active tab.', 'danger');
            scanButton.disabled = false;
            return;
        }

        // Check if the tab is a Discord tab
        if (!tab.url || !(tab.url.startsWith('https://discord.com/channels/') || tab.url.startsWith('https://ptb.discord.com/channels/'))) {
             showStatus('Please navigate to a Discord channel page.', 'warning');
             scanButton.disabled = false;
             return;
        }

        // Send message to background script to start the process
        chrome.runtime.sendMessage({ type: 'START_SCAN', tabId: tab.id }, (response) => {
            if (chrome.runtime.lastError) {
                // Handle potential errors like closed tabs or injection failures
                console.error("Error sending START_SCAN message:", chrome.runtime.lastError.message);
                showStatus(`Error starting scan: ${chrome.runtime.lastError.message}`, 'danger');
                scanButton.disabled = false;
            } else if (response && response.status === 'error') {
                showStatus(`Error: ${response.message}`, 'danger');
                scanButton.disabled = false;
            }
            // Success is handled by the 'SCAN_COMPLETE' message listener below
        });

    } catch (error) {
        console.error("Error during scan initiation:", error);
        showStatus(`Error: ${error.message}`, 'danger');
        scanButton.disabled = false;
    }
});

downloadButton.addEventListener('click', () => {
    if (foundUrls.length > 0) {
        downloadButton.disabled = true;
        showStatus('Starting downloads... Check Chrome downloads.', 'info');
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_URLS', urls: foundUrls }, (response) => {
             if (chrome.runtime.lastError) {
                console.error("Error sending DOWNLOAD_URLS message:", chrome.runtime.lastError.message);
                showStatus(`Error starting download: ${chrome.runtime.lastError.message}`, 'danger');
            } else if (response && response.status === 'success') {
                showStatus(`${foundUrls.length} downloads initiated!`, 'success');
            } else {
                 showStatus('Download initiation failed.', 'danger');
            }
            // Re-enable scan button after attempting download
             scanButton.disabled = false;
             // Keep download button disabled until next scan
        });
    }
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("Popup received message:", msg); // For debugging

    switch (msg.type) {
        case 'SCAN_COMPLETE':
            foundUrls = msg.urls;
            const count = foundUrls.length;
            spinner.classList.add('d-none'); // Hide spinner
            statusMessage.classList.remove('d-none'); // Show message area

            if (count > 0) {
                clipCountSpan.textContent = count;
                showStatus(`Found ${count} video clip(s).`, 'success');
                downloadSection.classList.remove('d-none'); // Show download button
                downloadButton.disabled = false;
            } else {
                showStatus('No video clips found on this page.', 'warning');
                downloadSection.classList.add('d-none'); // Keep download hidden
            }
            scanButton.disabled = false; // Re-enable scan button
            sendResponse({ status: 'ack' }); // Acknowledge message receipt
            break;

        case 'SCAN_ERROR':
             showStatus(`Error during scan: ${msg.message}`, 'danger');
             scanButton.disabled = false; // Re-enable scan button
             spinner.classList.add('d-none');
             statusMessage.classList.remove('d-none');
             sendResponse({ status: 'ack' });
             break;

        // Add more message handlers if needed (e.g., progress updates)
    }
    // Important: Return true to indicate you wish to send a response asynchronously
    // Although in this specific setup we might not strictly need it for all cases,
    // it's good practice when using sendResponse within listeners.
    // However, since our sendResponse calls are synchronous within the switch cases,
    // returning true isn't strictly mandatory here. Let's omit it for simplicity now.
    // return true;
});

// Initialize UI on popup open
document.addEventListener('DOMContentLoaded', () => {
    // You could potentially check if a scan was previously run and restore state here
    // For now, just reset to default
    resetUI();
});