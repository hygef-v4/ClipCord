// Get references to UI elements
const scanVideoButton = document.getElementById('scanVideoButton');
const scanImageButton = document.getElementById('scanImageButton');
const statusArea = document.getElementById('statusArea');
const spinner = document.getElementById('spinner');
const statusMessage = document.getElementById('statusMessage');
const mediaListArea = document.getElementById('mediaListArea');
const downloadAllSection = document.getElementById('downloadAllSection');
const downloadAllButton = document.getElementById('downloadAllButton');
const totalClipCountSpan = document.getElementById('totalClipCount');
const folderNameInput = document.getElementById('folderNameInput');
const mediaTypeLabel = document.getElementById('mediaTypeLabel');

let currentMediaUrls = [];
let currentMediaType = "video"; // "video" or "image"

// --- Helper Functions ---

function showStatus(message, type = 'info', showSpinner = false) {
    statusMessage.classList.remove('alert-info', 'alert-success', 'alert-warning', 'alert-danger', 'alert-light', 'd-none');
    spinner.classList.add('d-none');
    statusMessage.textContent = message;
    statusMessage.classList.add(`alert-${type}`);
    statusMessage.classList.remove('d-none');
    if (showSpinner) {
        spinner.classList.remove('d-none');
        statusMessage.classList.add('d-none');
    } else {
        spinner.classList.add('d-none');
        statusMessage.classList.remove('d-none');
    }
}

function resetUI() {
    scanVideoButton.disabled = false;
    scanImageButton.disabled = false;
    mediaListArea.innerHTML = '';
    mediaListArea.classList.add('d-none');
    downloadAllSection.classList.add('d-none');
    downloadAllButton.disabled = false;
    totalClipCountSpan.textContent = '0';
    downloadAllButton.textContent = `Download All ${capitalize(currentMediaType)}s (0)`;
    mediaTypeLabel.textContent = capitalize(currentMediaType) + "s";
    currentMediaUrls = [];
    showStatus('Click \'Scan\' to find videos or images.', 'light');
}

function getFilenameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/');
        const potentialFilename = pathParts.pop();
        if (potentialFilename && potentialFilename.includes('.')) {
            return decodeURIComponent(potentialFilename.split('?')[0]);
        }
    } catch (e) {}
    const fallback = url.substring(url.lastIndexOf('/') + 1).split('?')[0];
    return fallback || 'unknown_file';
}

function getTargetFolderName() {
    const folderName = folderNameInput.value.trim();
    return folderName || folderNameInput.placeholder || 'DiscordClips';
}

function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

// --- Event Handlers ---

function handleIndividualDownload(event) {
    const button = event.target;
    const urlToDownload = button.dataset.url;
    if (!urlToDownload) return;
    button.disabled = true;
    button.textContent = 'Starting...';
    const targetFolder = getTargetFolderName();
    chrome.runtime.sendMessage({
        type: 'DOWNLOAD_SINGLE_URL',
        url: urlToDownload,
        folder: targetFolder
    }, (response) => {
        if (chrome.runtime.lastError) {
            button.textContent = 'Error';
            button.classList.remove('btn-success');
            button.classList.add('btn-danger');
        } else if (response && response.status === 'success') {
            button.textContent = 'Done';
            button.classList.remove('btn-success');
            button.classList.add('btn-secondary');
        } else {
            button.textContent = 'Failed';
            button.classList.remove('btn-success');
            button.classList.add('btn-danger');
        }
    });
}

downloadAllButton.addEventListener('click', () => {
    if (currentMediaUrls.length === 0) {
        showStatus(`No ${currentMediaType}s found to download.`, 'warning');
        return;
    }
    downloadAllButton.disabled = true;
    downloadAllButton.textContent = 'Starting All...';
    showStatus(`Initiating download for ${currentMediaUrls.length} ${currentMediaType}s...`, 'info');
    mediaListArea.querySelectorAll('.btn-download-single').forEach(btn => btn.disabled = true);
    const targetFolder = getTargetFolderName();
    chrome.runtime.sendMessage({
        type: 'DOWNLOAD_ALL_URLS',
        urls: currentMediaUrls,
        folder: targetFolder
     }, (response) => {
         if (chrome.runtime.lastError) {
            showStatus(`Error starting downloads: ${chrome.runtime.lastError.message}`, 'danger');
            downloadAllButton.disabled = false;
            downloadAllButton.textContent = `Download All ${capitalize(currentMediaType)}s (${currentMediaUrls.length})`;
            mediaListArea.querySelectorAll('.btn-download-single').forEach(btn => {
                if (!btn.classList.contains('btn-secondary') && !btn.classList.contains('btn-danger')) {
                   btn.disabled = false;
                }
            });
        } else if (response && response.status === 'success') {
            showStatus(`${response.count} downloads initiated! Check Chrome Downloads.`, 'success');
            downloadAllButton.textContent = 'Downloads Started';
            mediaListArea.querySelectorAll('.btn-download-single').forEach(btn => {
                if (!btn.disabled) {
                   btn.textContent = 'Done';
                   btn.classList.remove('btn-success');
                   btn.classList.add('btn-secondary');
                   btn.disabled = true;
                }
            });
        } else {
            showStatus(`Failed to initiate all downloads: ${response?.message || 'Unknown error'}`, 'danger');
            downloadAllButton.disabled = false;
            downloadAllButton.textContent = `Download All ${capitalize(currentMediaType)}s (${currentMediaUrls.length})`;
            mediaListArea.querySelectorAll('.btn-download-single').forEach(btn => {
                if (!btn.classList.contains('btn-secondary') && !btn.classList.contains('btn-danger')) {
                   btn.disabled = false;
                }
            });
        }
    });
});

scanVideoButton.addEventListener('click', () => startScan('video'));
scanImageButton.addEventListener('click', () => startScan('image'));

async function startScan(mediaType) {
    resetUI();
    currentMediaType = mediaType;
    scanVideoButton.disabled = true;
    scanImageButton.disabled = true;
    showStatus(`Scanning page for ${mediaType}s...`, 'info', true);
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) throw new Error('Could not find active tab.');
        if (!tab.url || !(tab.url.startsWith('https://discord.com/channels/') || tab.url.startsWith('https://ptb.discord.com/channels/'))) {
            throw new Error('Please navigate to a Discord channel or DM page.');
        }
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-script.js']
        }, () => {
            chrome.tabs.sendMessage(tab.id, { type: 'START_SCAN', scanType: mediaType }, (response) => {
                scanVideoButton.disabled = false;
                scanImageButton.disabled = false;
                if (!response || response.status === "empty") {
                    showStatus(`No ${mediaType}s found.`, 'warning');
                } else if (response.status === "success") {
                    displayMediaResults(response.urls, mediaType);
                } else if (response.status === "error") {
                    showStatus(`Error: ${response.message}`, 'danger');
                }
            });
        });
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'danger');
        scanVideoButton.disabled = false;
        scanImageButton.disabled = false;
    }
}

function displayMediaResults(urls, mediaType) {
    currentMediaUrls = urls;
    const count = urls.length;
    mediaListArea.innerHTML = '';
    if (count > 0) {
        showStatus(`Found ${count} ${mediaType}${count > 1 ? 's' : ''}.`, 'success');
        urls.forEach((url, index) => {
            const listItem = document.createElement('div');
            listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
            const textSpan = document.createElement('span');
            textSpan.className = 'clip-name';
            const filename = getFilenameFromUrl(url);
            textSpan.textContent = `${capitalize(mediaType)} ${index + 1} (${filename.length > 25 ? filename.substring(0, 22) + '...' : filename})`;
            textSpan.title = `${filename}\n${url}`;
            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'btn btn-success btn-sm btn-download-single';
            downloadBtn.textContent = 'Download';
            downloadBtn.dataset.url = url;
            downloadBtn.addEventListener('click', handleIndividualDownload);
            listItem.appendChild(textSpan);
            listItem.appendChild(downloadBtn);
            mediaListArea.appendChild(listItem);
        });
        mediaListArea.classList.remove('d-none');
        totalClipCountSpan.textContent = count;
        downloadAllButton.textContent = `Download All ${capitalize(mediaType)}s (${count})`;
        mediaTypeLabel.textContent = capitalize(mediaType) + "s";
        downloadAllSection.classList.remove('d-none');
        downloadAllButton.disabled = false;
    } else {
        showStatus(`No ${mediaType}s found on this page.`, 'warning');
        mediaListArea.classList.add('d-none');
        downloadAllSection.classList.add('d-none');
        currentMediaUrls = [];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    resetUI();
    folderNameInput.placeholder = 'DiscordClips';
});