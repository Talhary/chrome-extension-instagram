// Instagram Video Downloader Popup Settings Script
document.addEventListener('DOMContentLoaded', () => {
    const autoDownloadCheckbox = document.getElementById('autoDownloadEnabled');
    const downloadFolderInput = document.getElementById('downloadFolder');
    const watchTimeDelayInput = document.getElementById('watchTimeDelay');
    const watchTimeValueSpan = document.getElementById('watchTimeValue');

    // Load saved settings
    chrome.storage.local.get({
        autoDownloadEnabled: false,
        downloadFolder: 'InstagramReels',
        watchTimeDelay: 3
    }, (settings) => {
        autoDownloadCheckbox.checked = settings.autoDownloadEnabled;
        downloadFolderInput.value = settings.downloadFolder;
        watchTimeDelayInput.value = settings.watchTimeDelay;
        watchTimeValueSpan.textContent = `${settings.watchTimeDelay}s`;
    });

    // Save Auto Download toggle
    autoDownloadCheckbox.addEventListener('change', () => {
        chrome.storage.local.set({ autoDownloadEnabled: autoDownloadCheckbox.checked }, () => {
            console.log('autoDownloadEnabled saved:', autoDownloadCheckbox.checked);
        });
    });

    // Save Download Folder
    downloadFolderInput.addEventListener('input', () => {
        const folder = downloadFolderInput.value.trim();
        chrome.storage.local.set({ downloadFolder: folder });
    });

    // Save and display Watch Time Delay slider value
    watchTimeDelayInput.addEventListener('input', () => {
        const delay = parseInt(watchTimeDelayInput.value, 10);
        watchTimeValueSpan.textContent = `${delay}s`;
        chrome.storage.local.set({ watchTimeDelay: delay });
    });
});
