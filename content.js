// Instagram Video Downloader Content Script
(function() {
    'use strict';
    console.log("🚀 Instagram Video Downloader Content Script loaded successfully!");

    const pendingDownloads = new Map();
    let downloadIdCounter = 0;

    const activeVideoDownloads = new Map(); // videoElement -> timeoutId
    const autoDownloadedShortcodes = new Set(); // Set of downloaded shortcodes in this session

    // Load persisted downloaded list to prevent duplicates
    chrome.storage.local.get(['autoDownloaded'], (result) => {
        if (result.autoDownloaded && Array.isArray(result.autoDownloaded)) {
            result.autoDownloaded.forEach(sc => autoDownloadedShortcodes.add(sc));
        }
    });

    // Helper to check if a URL belongs to a video stream rather than a cover photo
    function isVideoUrl(url) {
        if (!url || typeof url !== 'string') return false;
        if (!url.startsWith('https://') || (!url.includes('cdninstagram.com') && !url.includes('fbcdn.net'))) {
            return false;
        }
        if (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.webp') || url.includes('.jfif') || url.includes('.png') || url.includes('.heic')) {
            return false;
        }
        return url.includes('.mp4') || url.includes('mime=video') || url.includes('/video/') || url.includes('/v/t5') || url.includes('/v/t6') || url.includes('bytestart=');
    }

    // Listen to messages from page-world script
    window.addEventListener('message', (event) => {
        if (event.data && (event.data.action === 'BLOB_FETCHED' || event.data.action === 'BLOB_ERROR')) {
            const { id, dataUrl, error, isDirect } = event.data;
            if (pendingDownloads.has(id)) {
                const { resolve, reject } = pendingDownloads.get(id);
                pendingDownloads.delete(id);
                if (event.data.action === 'BLOB_FETCHED') {
                    resolve({ dataUrl, isDirect });
                } else {
                    reject(new Error(error));
                }
            }
        }
    });

    function fetchBlobViaPageWorld(blobUrl) {
        return new Promise((resolve, reject) => {
            const id = ++downloadIdCounter;
            pendingDownloads.set(id, { resolve, reject });
            
            window.postMessage({
                action: 'FETCH_BLOB',
                id: id,
                blobUrl: blobUrl
            }, '*');
            
            // Timeout after 3 seconds (fiber walks take <1ms, so 3s is extremely safe)
            setTimeout(() => {
                if (pendingDownloads.has(id)) {
                    const { reject } = pendingDownloads.get(id);
                    pendingDownloads.delete(id);
                    reject(new Error("Timeout fetching blob from page world"));
                }
            }, 3000);
        });
    }

    // Extract the active Reel/Post shortcode from URL or DOM links
    function getShortcode(video) {
        let match = window.location.pathname.match(/\/(reels?|p)\/([A-Za-z0-9_\-]+)/);
        if (match) return match[2];
        
        let container = video.closest('article') || video.closest('section') || video.parentElement;
        // Search upwards a bit to find a container with links if not in direct reel page
        let depth = 0;
        while (container && container.tagName !== 'BODY' && depth < 5) {
            const links = container.querySelectorAll('a');
            for (let link of links) {
                let href = link.getAttribute('href');
                if (href) {
                    let m = href.match(/\/(reels?|p)\/([A-Za-z0-9_\-]+)/);
                    if (m) return m[2];
                }
            }
            container = container.parentElement;
            depth++;
        }
        return 'video';
    }

    // Extract video URL from localized embedded script tags containing JSON data
    function findVideoUrlInScriptTags(shortcode) {
        const scriptTags = document.querySelectorAll('script');
        for (let script of scriptTags) {
            const text = script.textContent;
            if (text && text.includes(shortcode) && text.includes('video_versions')) {
                const unescapedText = text.replace(/\\\/|\\u0025/g, (m) => m === '\\/' ? '/' : '%');
                const urlRegex = /https:\/\/[^\s"]+?cdninstagram\.com[^\s"]+?\.mp4[^\s"]*/g;
                const urls = unescapedText.match(urlRegex) || [];
                if (urls.length > 0) {
                    const validUrls = urls.filter(u => isVideoUrl(u));
                    if (validUrls.length > 0) {
                        console.log("Instagram Downloader: Found video URL in script tags for shortcode:", shortcode);
                        return validUrls[0];
                    }
                }
            }
        }
        return null;
    }

    // Fetch the high-quality direct video URL via Instagram GraphQL using the shortcode
    async function fetchVideoUrlFromGraphql(shortcode) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds timeout
        
        try {
            const variables = {
                after: "GhaG2fmbk9Kk7mwm8Lzb99tnFAI0AikIGAAaCBgNczoxOWVkZjdiNmYzOBQBGgYZDBaG2fmbk9Kk7mwA",
                before: null,
                data: {
                    container_module: "clips_tab_desktop_page",
                    seen_reels: "[]",
                    chaining_media_id: shortcode,
                    should_refetch_chaining_media: false
                },
                first: 10,
                last: null
            };
            
            const postData = {
                av: "17841474788003264",
                __d: "www",
                __user: "0",
                __a: "1",
                __req: "b",
                variables: JSON.stringify(variables),
                doc_id: "36825039943776829"
            };
            
            const body = new URLSearchParams(postData).toString();
            
            const csrftoken = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || "";
            const headers = {
                "content-type": "application/x-www-form-urlencoded",
                "x-asbd-id": "359341",
                "x-ig-app-id": "936619743392459",
                "x-root-field-name": "xdt_api__v1__clips__home__connection_v2",
                "x-fb-friendly-name": "PolarisClipsTabDesktopPaginationQuery",
                "x-fb-lsd": "7w-X0yZTFUrItDbwsrmuuT"
            };
            if (csrftoken) {
                headers["x-csrftoken"] = csrftoken;
            }
            
            const res = await fetch("https://www.instagram.com/graphql/query", {
                method: "POST",
                headers: headers,
                body: body,
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!res.ok) throw new Error("GraphQL request failed: " + res.statusText);
            const json = await res.json();
            const edges = json.data?.xdt_api__v1__clips__home__connection_v2?.edges || [];
            const videoUrl = edges[0]?.node?.media?.video_versions?.[0]?.url;
            return videoUrl;
        } catch (error) {
            clearTimeout(timeoutId);
            console.error("Error fetching video URL from GraphQL:", error);
            return null;
        }
    }

    // Trigger video download using available strategies (direct URL, Blob URL conversion, or GraphQL API)
    async function triggerDownload(video, subfolder = "") {
        const shortcode = getShortcode(video);
        let folder = (subfolder || "").trim().replace(/^\/+|\/+$/g, "");
        const filename = folder ? `${folder}/instagram_${shortcode}.mp4` : `instagram_${shortcode}.mp4`;
        
        // Strategy 1: Direct HTTPS URL from the video src
        if (video.src && video.src.startsWith('https://')) {
            console.log("Downloading direct URL from video tag:", video.src);
            return new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: 'download', url: video.src, filename }, (response) => {
                    if (response && response.success) resolve();
                    else reject(new Error(response ? response.error : 'Download failed'));
                });
            });
        }
        
        // Strategy 2: Blob URL (fetch blob data locally via page-world and download)
        if (video.src && video.src.startsWith('blob:')) {
            console.log("Attempting to download blob URL via page world:", video.src);
            try {
                const result = await fetchBlobViaPageWorld(video.src);
                return new Promise((resolve, reject) => {
                    if (result.isDirect) {
                        chrome.runtime.sendMessage({
                            action: 'download',
                            url: result.dataUrl,
                            filename: filename
                        }, (response) => {
                            if (response && response.success) resolve();
                            else reject(new Error(response ? response.error : 'Download failed'));
                        });
                    } else {
                        chrome.runtime.sendMessage({
                            action: 'downloadData',
                            dataUrl: result.dataUrl,
                            filename: filename
                        }, (response) => {
                            if (response && response.success) resolve();
                            else reject(new Error(response ? response.error : 'Download failed'));
                        });
                    }
                });
            } catch (err) {
                console.log("Instagram Downloader: Blob extraction failed, trying fallback...", err);
            }
        }
        
        // Strategy 3: Scan embedded page script JSON
        if (shortcode !== 'video') {
            console.log("Attempting to find video URL in script tags for shortcode:", shortcode);
            const scriptUrl = findVideoUrlInScriptTags(shortcode);
            if (scriptUrl) {
                return new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({ action: 'download', url: scriptUrl, filename }, (response) => {
                        if (response && response.success) resolve();
                        else reject(new Error(response ? response.error : 'Script download failed'));
                    });
                });
            }
        }
        
        // Strategy 4: GraphQL API query fallback
        if (shortcode !== 'video') {
            console.log("No video src found, fetching from API for shortcode:", shortcode);
            const apiVideoUrl = await fetchVideoUrlFromGraphql(shortcode);
            if (apiVideoUrl) {
                return new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({ action: 'download', url: apiVideoUrl, filename }, (res) => {
                        if (res && res.success) resolve();
                        else reject(new Error(res ? res.error : 'GraphQL download failed'));
                    });
                });
            }
        }
        
        throw new Error("No download method succeeded");
    }

    // Inject download button into the actions column
    function injectDownloadButton(column, video) {
        const downloadBtnWrapper = document.createElement('div');
        downloadBtnWrapper.className = 'instagram-download-btn-inserted';
        
        // Inherit dynamic styling/layout classes of surrounding items
        const firstChild = column.firstElementChild;
        if (firstChild) {
            if (!firstChild.classList.contains('instagram-download-btn-inserted')) {
                downloadBtnWrapper.className += ' ' + firstChild.className;
            }
        }
        
        const btn = document.createElement('div');
        btn.role = 'button';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.flexDirection = 'column';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        
        btn.innerHTML = `
            <div class="download-icon-container">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="download-svg-icon">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            </div>
            <span style="font-size: 12px; margin-top: 4px; font-weight: 400; color: inherit;">Download</span>
        `;
        
        // Add click behavior
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const svgIcon = btn.querySelector('.download-svg-icon');
            const textSpan = btn.querySelector('span');
            const iconContainer = btn.querySelector('.download-icon-container');
            
            const originalSvg = svgIcon.outerHTML;
            const originalText = textSpan.innerText;
            
            textSpan.innerText = "Fetching...";
            iconContainer.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="animation: spin 1s linear infinite; width: 24px; height: 24px;">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.2"></circle>
                    <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor"></path>
                </svg>
            `;
            
            chrome.storage.local.get({ downloadFolder: 'InstagramReels' }, async (settings) => {
                try {
                    await triggerDownload(video, settings.downloadFolder);
                    textSpan.innerText = "Saved!";
                    iconContainer.style.color = '#4ade80'; // Success green
                    iconContainer.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    `;
                    setTimeout(() => {
                        textSpan.innerText = originalText;
                        iconContainer.innerHTML = originalSvg;
                        iconContainer.style.color = '';
                    }, 2000);
                } catch (err) {
                    console.error("Download failed:", err);
                    textSpan.innerText = "Error";
                    iconContainer.style.color = '#ef4444'; // Error red
                    iconContainer.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    `;
                    setTimeout(() => {
                        textSpan.innerText = originalText;
                        iconContainer.innerHTML = originalSvg;
                        iconContainer.style.color = '';
                    }, 2000);
                }
            });
        });
        
        downloadBtnWrapper.appendChild(btn);
        // Inject button at the top of the column!
        column.insertBefore(downloadBtnWrapper, column.firstChild);
    }

    // Inject rotate button into the actions column
    function injectRotateButton(column, video) {
        const rotateBtnWrapper = document.createElement('div');
        rotateBtnWrapper.className = 'instagram-rotate-btn-inserted';
        
        // Inherit dynamic styling/layout classes of surrounding items
        const firstChild = column.firstElementChild;
        if (firstChild) {
            if (!firstChild.classList.contains('instagram-rotate-btn-inserted') && !firstChild.classList.contains('instagram-download-btn-inserted')) {
                rotateBtnWrapper.className += ' ' + firstChild.className;
            }
        }
        
        const btn = document.createElement('div');
        btn.role = 'button';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.flexDirection = 'column';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        
        btn.innerHTML = `
            <div class="rotate-icon-container">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="rotate-svg-icon">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                </svg>
            </div>
            <span style="font-size: 12px; margin-top: 4px; font-weight: 400; color: inherit;">Rotate</span>
        `;
        
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            let currentRotation = parseInt(video.dataset.rotation || '0', 10);
            let nextRotation = (currentRotation + 90) % 360;
            video.dataset.rotation = nextRotation;
            
            // Adjust scale if rotated 90 or 270 degrees to prevent clipping inside the slide layout
            if (nextRotation === 90 || nextRotation === 270) {
                const width = video.offsetWidth;
                const height = video.offsetHeight;
                if (width > 0 && height > 0) {
                    const scale = Math.min(width, height) / Math.max(width, height);
                    video.style.transform = `rotate(${nextRotation}deg) scale(${scale.toFixed(2)})`;
                } else {
                    video.style.transform = `rotate(${nextRotation}deg)`;
                }
            } else {
                video.style.transform = nextRotation === 0 ? '' : `rotate(${nextRotation}deg)`;
            }
            
            // Animate the rotation icon on click
            const svgIcon = btn.querySelector('.rotate-svg-icon');
            svgIcon.style.transition = 'transform 0.4s ease';
            svgIcon.style.transform = 'rotate(-90deg)';
            setTimeout(() => {
                svgIcon.style.transition = 'none';
                svgIcon.style.transform = '';
            }, 400);
        });
        
        rotateBtnWrapper.appendChild(btn);
        
        // Insert right below the download button if it exists
        const downloadBtn = column.querySelector('.instagram-download-btn-inserted');
        if (downloadBtn) {
            column.insertBefore(rotateBtnWrapper, downloadBtn.nextSibling);
        } else {
            column.insertBefore(rotateBtnWrapper, column.firstChild);
        }
    }

    // Helper to find the actions column for a Like element
    function findActionsColumn(likeEl) {
        let current = likeEl;
        let depth = 0;
        while (current && current.tagName !== 'BODY' && depth < 5) {
            // Count how many buttons/interactive elements are inside this ancestor
            const buttons = current.querySelectorAll('button, [role="button"]');
            if (buttons.length >= 2) {
                // Must contain Like and either Comment or Share
                const hasLike = current.querySelector('[aria-label="Like"], [aria-label="Unlike"], [aria-label*="Like" i], [aria-label*="Unlike" i], [aria-label="Me gusta"], [aria-label="J\'aime"], [aria-label="Gefällt mir"], [aria-label="Mi piace"], [aria-label="Curtir"], [aria-label="Нравится"], [aria-label="赞"], [aria-label="取消赞"], [aria-label="「いいね！」"], [aria-label="إعجاب"]');
                const hasCommentOrShare = current.querySelector('[aria-label*="Comment" i], [aria-label*="comment" i], [aria-label*="Comentar" i], [aria-label*="Share" i], [aria-label*="share" i], [aria-label*="Direct" i], [aria-label*="direct" i]');
                if (hasLike && hasCommentOrShare) {
                    return current;
                }
            }
            current = current.parentElement;
            depth++;
        }
        return null;
    }

    // Helper to find the video element corresponding to the actions column
    function findVideoForColumn(column) {
        let ancestor = column;
        let depth = 0;
        while (ancestor && ancestor.tagName !== 'BODY' && depth < 5) {
            const videos = Array.from(ancestor.querySelectorAll('video'));
            if (videos.length > 0) {
                if (videos.length === 1) {
                    return videos[0];
                }
                // Filter by visibility and size
                const validVideos = videos.filter(v => v.offsetWidth > 50 && v.offsetHeight > 50);
                if (validVideos.length > 0) {
                    validVideos.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight));
                    return validVideos[0];
                }
                return videos[0];
            }
            ancestor = ancestor.parentElement;
            depth++;
        }
        return null;
    }

    // Main scan execution
    function scanAndInject() {
        const ACTION_SELECTORS = [
            // Like / Unlike
            '[aria-label="Like"]', '[aria-label="Unlike"]', '[aria-label*="Like" i]', '[aria-label*="Unlike" i]',
            '[aria-label="Me gusta"]', '[aria-label="J\'aime"]', '[aria-label="Gefällt mir"]', '[aria-label="Mi piace"]',
            '[aria-label="Curtir"]', '[aria-label="Нравится"]', '[aria-label="赞"]', '[aria-label="取消赞"]',
            '[aria-label="「いいね！」"]', '[aria-label="إعجاب"]',
            // Comment
            '[aria-label*="Comment" i]', '[aria-label*="comment" i]', '[aria-label*="Comentar" i]',
            // Share / Direct / Send
            '[aria-label*="Share" i]', '[aria-label*="share" i]', '[aria-label*="Direct" i]', '[aria-label*="direct" i]', '[aria-label*="Send" i]',
            // Save
            '[aria-label*="Save" i]', '[aria-label*="save" i]'
        ].join(', ');
        
        const actionElements = document.querySelectorAll(ACTION_SELECTORS);
        
        actionElements.forEach(actionEl => {
            const column = findActionsColumn(actionEl);
            if (!column) return;
            
            const video = findVideoForColumn(column);
            if (video) {
                if (!column.querySelector('.instagram-download-btn-inserted')) {
                    console.log("Instagram Downloader: Injecting download button into Reel actions column:", column);
                    injectDownloadButton(column, video);
                }
                if (!column.querySelector('.instagram-rotate-btn-inserted')) {
                    console.log("Instagram Downloader: Injecting rotate button into Reel actions column:", column);
                    injectRotateButton(column, video);
                }
            }
        });
    }

    // Debounce scans to minimize CPU usage during scrolling
    let scanTimeout = null;
    function scheduleScan() {
        if (scanTimeout) return;
        scanTimeout = setTimeout(() => {
            scanAndInject();
            scanTimeout = null;
        }, 200);
    }

    // Auto download play handlers
    function handleVideoPlay(video) {
        chrome.storage.local.get({
            autoDownloadEnabled: false,
            watchTimeDelay: 3,
            downloadFolder: 'InstagramReels'
        }, (settings) => {
            if (!settings.autoDownloadEnabled) return;
            
            const shortcode = getShortcode(video);
            if (shortcode === 'video') return; // Can't resolve shortcode yet
            
            // Check if already downloaded
            if (autoDownloadedShortcodes.has(shortcode)) return;
            
            // Cancel any existing auto-download timer for this video
            if (activeVideoDownloads.has(video)) {
                clearTimeout(activeVideoDownloads.get(video));
            }
            
            const delay = (parseInt(settings.watchTimeDelay, 10) || 3) * 1000;
            
            const timeoutId = setTimeout(async () => {
                activeVideoDownloads.delete(video);
                
                // Re-verify video is still playing and active
                if (video.paused || video.ended) return;
                
                // Verify we are still on this video (visible in viewport)
                const rect = video.getBoundingClientRect();
                const isVisible = (
                    rect.top >= -rect.height/2 &&
                    rect.bottom <= window.innerHeight + rect.height/2 &&
                    rect.left >= -rect.width/2 &&
                    rect.right <= window.innerWidth + rect.width/2
                );
                if (!isVisible) return;
                
                console.log(`[Auto Download] Watch threshold met for Reel ${shortcode}. Downloading...`);
                
                // Add to downloaded set to prevent double downloads
                autoDownloadedShortcodes.add(shortcode);
                
                // Persist downloaded shortcodes (limit list size to last 500 items)
                chrome.storage.local.set({ autoDownloaded: Array.from(autoDownloadedShortcodes).slice(-500) });
                
                try {
                    await triggerDownload(video, settings.downloadFolder);
                } catch (err) {
                    console.error("[Auto Download] Download failed:", err);
                    // Remove from set so we can retry later if it failed
                    autoDownloadedShortcodes.delete(shortcode);
                }
            }, delay);
            
            activeVideoDownloads.set(video, timeoutId);
        });
    }

    document.addEventListener('play', (event) => {
        if (event.target.tagName === 'VIDEO') {
            handleVideoPlay(event.target);
        }
    }, true);

    document.addEventListener('pause', (event) => {
        if (event.target.tagName === 'VIDEO') {
            if (activeVideoDownloads.has(event.target)) {
                clearTimeout(activeVideoDownloads.get(event.target));
                activeVideoDownloads.delete(event.target);
            }
        }
    }, true);

    // Listen to all DOM changes
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });

    // Periodic safety check
    setInterval(scanAndInject, 1000);
    
    // Initial run
    scanAndInject();
})();
