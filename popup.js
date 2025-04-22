const scanButton = document.getElementById('scanButton');
const statusArea = document.getElementById('statusArea');
const spinner = document.getElementById('spinner');
const statusMessage = document.getElementById('statusMessage');
const videoListArea = document.getElementById('videoListArea');
const downloadAllSection = document.getElementById('downloadAllSection');
const downloadAllButton = document.getElementById('downloadAllButton');
const totalClipCountSpan = document.getElementById('totalClipCount');
const folderNameInput = document.getElementById('folderNameInput');

let currentClipUrls = [];

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
    scanButton.disabled = false;
    videoListArea.innerHTML = '';
    videoListArea.classList.add('d-none');
    downloadAllSection.classList.add('d-none');
    downloadAllButton.disabled = false;
    totalClipCountSpan.textContent = '0';
    downloadAllButton.textContent = `Download All Clips (0)`;
    currentClipUrls = [];
    showStatus('Click \'Scan\' to find clips.', 'light');
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
    return fallback || 'unknown_clip';
}

function getTargetFolderName() {
    const folderName = folderNameInput.value.trim();
    return folderName || folderNameInput.placeholder || 'DiscordClips';
}

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
    if (currentClipUrls.length === 0) {
        showStatus('No clips found to download.', 'warning');
        return;
    }
    downloadAllButton.disabled = true;
    downloadAllButton.textContent = 'Starting All...';
    showStatus(`Initiating download for ${currentClipUrls.length} clips...`, 'info');
    videoListArea.querySelectorAll('.btn-download-single').forEach(btn => btn.disabled = true);
    const targetFolder = getTargetFolderName();
    chrome.runtime.sendMessage({
        type: 'DOWNLOAD_ALL_URLS',
        urls: currentClipUrls,
        folder: targetFolder
     }, (response) => {
         if (chrome.runtime.lastError) {
            showStatus(`Error starting downloads: ${chrome.runtime.lastError.message}`, 'danger');
            downloadAllButton.disabled = false;
            downloadAllButton.textContent = `Download All Clips (${currentClipUrls.length})`;
            videoListArea.querySelectorAll('.btn-download-single').forEach(btn => {
                if (!btn.classList.contains('btn-secondary') && !btn.classList.contains('btn-danger')) {
                   btn.disabled = false;
                }
            });
        } else if (response && response.status === 'success') {
            showStatus(`${response.count} downloads initiated! Check Chrome Downloads.`, 'success');
            downloadAllButton.textContent = 'Downloads Started';
            videoListArea.querySelectorAll('.btn-download-single').forEach(btn => {
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
            downloadAllButton.textContent = `Download All Clips (${currentClipUrls.length})`;
            videoListArea.querySelectorAll('.btn-download-single').forEach(btn => {
                if (!btn.classList.contains('btn-secondary') && !btn.classList.contains('btn-danger')) {
                   btn.disabled = false;
                }
            });
        }
    });
});

scanButton.addEventListener('click', async () => {
    resetUI();
    scanButton.disabled = true;
    showStatus('Scanning page...', 'info', true);

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            throw new Error('Could not find active tab.');
        }
        if (!tab.url || !(tab.url.startsWith('https://discord.com/channels/') || tab.url.startsWith('https://ptb.discord.com/channels/'))) {
             throw new Error('Please navigate to a Discord channel or DM page.');
        }
        chrome.runtime.sendMessage({ type: 'START_SCAN', tabId: tab.id }, (response) => {
            if (chrome.runtime.lastError) {
                showStatus(`Error initiating scan: ${chrome.runtime.lastError.message}`, 'danger');
                resetUI();
            } else if (response && response.status === 'error') {
                showStatus(`Error: ${response.message}`, 'danger');
                resetUI();
            } else if (response && response.status === 'received') {
                // Status remains "Scanning..."
            } else {
                showStatus('Scan initiated, waiting for results...', 'info', true);
            }
        });
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'danger');
        resetUI();
    }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
        case 'SCAN_COMPLETE':
            const urls = msg.urls;
            currentClipUrls = urls;
            const count = urls.length;
            videoListArea.innerHTML = '';
            if (count > 0) {
                showStatus(`Found ${count} video clip(s).`, 'success');
                urls.forEach((url, index) => {
                    const listItem = document.createElement('div');
                    listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
                    const textSpan = document.createElement('span');
                    textSpan.className = 'clip-name';
                    const filename = getFilenameFromUrl(url);
                    textSpan.textContent = `Clip ${index + 1} (${filename.length > 25 ? filename.substring(0, 22) + '...' : filename})`;
                    textSpan.title = `${filename}\n${url}`;
                    const downloadBtn = document.createElement('button');
                    downloadBtn.className = 'btn btn-success btn-sm btn-download-single';
                    downloadBtn.textContent = 'Download';
                    downloadBtn.dataset.url = url;
                    downloadBtn.addEventListener('click', handleIndividualDownload);
                    listItem.appendChild(textSpan);
                    listItem.appendChild(downloadBtn);
                    videoListArea.appendChild(listItem);
                });
                videoListArea.classList.remove('d-none');
                totalClipCountSpan.textContent = count;
                downloadAllButton.textContent = `Download All Clips (${count})`;
                downloadAllSection.classList.remove('d-none');
                downloadAllButton.disabled = false;
            } else {
                showStatus('No video clips found on this page.', 'warning');
                videoListArea.classList.add('d-none');
                downloadAllSection.classList.add('d-none');
                currentClipUrls = [];
            }
            scanButton.disabled = false;
            break;
        case 'SCAN_ERROR':
             showStatus(`Error during scan: ${msg.message}`, 'danger');
             resetUI();
             break;
        default:
            break;
    }
    return false;
});

document.addEventListener('DOMContentLoaded', () => {
    resetUI();
    folderNameInput.placeholder = 'DiscordClips';
});