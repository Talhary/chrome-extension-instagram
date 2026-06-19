function disableDownloadUi() {
    try {
        if (chrome.downloads.setUiOptions) {
            chrome.downloads.setUiOptions({ enabled: false }, () => {
                if (chrome.runtime.lastError) {
                    console.log("setUiOptions failed or not supported:", chrome.runtime.lastError.message);
                }
            });
        }
        if (chrome.downloads.setShelfEnabled) {
            chrome.downloads.setShelfEnabled(false);
        }
    } catch (e) {
        console.error("Error setting download UI options:", e);
    }
}

chrome.runtime.onInstalled.addListener(disableDownloadUi);
chrome.runtime.onStartup.addListener(disableDownloadUi);
disableDownloadUi();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'download') {
        chrome.downloads.download({
            url: message.url,
            filename: message.filename || 'instagram_video.mp4',
            conflictAction: 'uniquify'
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Download failed:", chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId });
            }
        });
        return true; // Keep message channel open for async response
    }
    
    if (message.action === 'downloadData') {
        chrome.downloads.download({
            url: message.dataUrl,
            filename: message.filename || 'instagram_video.mp4',
            conflictAction: 'uniquify'
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error("Data download failed:", chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId });
            }
        });
        return true;
    }
});
