// Runs in MAIN world (page context)

function isVideoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    // Must start with https:// and belong to Instagram/Facebook CDN
    if (!url.startsWith('https://') || (!url.includes('cdninstagram.com') && !url.includes('fbcdn.net'))) {
        return false;
    }
    // Exclude cover images and thumbnails (commonly loaded as jfif, jpg, webp, png)
    if (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.webp') || url.includes('.jfif') || url.includes('.png') || url.includes('.heic')) {
        return false;
    }
    // Must contain video stream indicators
    return url.includes('.mp4') || url.includes('mime=video') || url.includes('/video/') || url.includes('/v/t5') || url.includes('/v/t6') || url.includes('bytestart=');
}

const IGNORED_KEYS = new Set([
    'return', 'child', 'sibling', 'stateNode', 'alternate', 
    '_owner', '_store', 'dependencies', 'ownerDocument', 'current',
    'nativeEvent', 'target', 'currentTarget', 'srcElement', 'parent',
    'window', 'document', 'view', 'navigator'
]);

// Traverse React props and find all video URLs
function findVideoUrlsFromProps(props) {
    const urls = [];
    const visited = new Set();
    
    function traverse(obj, depth = 0) {
        if (depth > 3) return; // Limit depth to 3 to prevent performance issues
        if (!obj || typeof obj !== 'object' || visited.has(obj)) return;
        visited.add(obj);
        
        // If we find video_versions array, extract URLs
        if (Array.isArray(obj)) {
            for (let item of obj) {
                if (item && typeof item === 'object') {
                    if (typeof item.url === 'string' && isVideoUrl(item.url)) {
                        urls.push({
                            url: item.url,
                            width: item.width || 0,
                            height: item.height || 0
                        });
                    }
                }
            }
        }
        
        for (let key in obj) {
            if (IGNORED_KEYS.has(key)) continue;
            try {
                const val = obj[key];
                if (key === 'video_versions' && Array.isArray(val)) {
                    for (let item of val) {
                        if (item && typeof item === 'object' && typeof item.url === 'string' && isVideoUrl(item.url)) {
                            urls.push({
                                url: item.url,
                                width: item.width || 0,
                                height: item.height || 0
                            });
                        }
                    }
                } else if (typeof val === 'string' && isVideoUrl(val)) {
                    urls.push({ url: val, width: 0, height: 0 });
                } else if (typeof val === 'object' && val !== null) {
                    traverse(val, depth + 1);
                }
            } catch (e) {
                // Ignore
            }
        }
    }
    
    traverse(props);
    return urls;
}

function findVideoUrl(video, container) {
    const allUrls = [];
    const visitedProps = new Set();
    const t0 = performance.now();
    
    function scanFiber(node) {
        if (!node) return;
        let fiberKey = Object.keys(node).find(key => key.startsWith('__reactFiber') || key.startsWith('__reactProps') || key.startsWith('__reactContainer'));
        if (!fiberKey) return;
        
        let fiber = node[fiberKey];
        while (fiber) {
            const propsObjects = [fiber.memoizedProps, fiber.pendingProps, fiber.memoizedState];
            for (let obj of propsObjects) {
                if (obj && !visitedProps.has(obj)) {
                    visitedProps.add(obj);
                    const urls = findVideoUrlsFromProps(obj);
                    if (urls && urls.length > 0) {
                        allUrls.push(...urls);
                    }
                }
            }
            // Stop climbing once we find any valid video URL matches in the local React hierarchy
            if (allUrls.length > 0) {
                break;
            }
            fiber = fiber.return;
        }
    }
    
    // Walk React components starting from the video element
    scanFiber(video);
    
    // Walk React components starting from the slide container (if video search failed)
    if (allUrls.length === 0 && container) {
        scanFiber(container);
    }
    
    const t1 = performance.now();
    console.log(`[Instagram Downloader] React fiber scan took ${(t1 - t0).toFixed(2)}ms. Found ${allUrls.length} URL matches.`);
    
    if (allUrls.length > 0) {
        // Sort by resolution (width * height) descending to get highest quality video URL
        allUrls.sort((a, b) => (b.width * b.height) - (a.width * a.height));
        return allUrls[0].url;
    }
    
    return null;
}

// Find the slide container containing the Like button for a given video
function findSlideContainer(video) {
    let current = video.parentElement;
    const LIKE_SELECTORS = '[aria-label="Like"], [aria-label="Unlike"], [aria-label*="Like" i], [aria-label*="Unlike" i], [aria-label="Me gusta"], [aria-label="J\'aime"], [aria-label="Gefällt mir"], [aria-label="Mi piace"], [aria-label="Curtir"], [aria-label="Нравится"], [aria-label="赞"], [aria-label="取消赞"], [aria-label="「いいね！」"], [aria-label="إعجاب"]';
    
    let depth = 0;
    while (current && current.tagName !== 'BODY' && depth < 6) {
        if (current.querySelector(LIKE_SELECTORS)) {
            return current;
        }
        current = current.parentElement;
        depth++;
    }
    return null;
}

window.addEventListener('message', async (event) => {
    if (event.data && event.data.action === 'FETCH_BLOB') {
        const { id, blobUrl } = event.data;
        
        try {
            // Find the active video element matching the blob URL
            const video = Array.from(document.querySelectorAll('video')).find(v => v.src === blobUrl);
            if (video) {
                const container = findSlideContainer(video);
                
                // Scan the React properties of the slide tree
                const directUrl = findVideoUrl(video, container);
                if (directUrl) {
                    console.log("Instagram Downloader: Resolved high-quality direct URL from React tree:", directUrl);
                    window.postMessage({
                        action: 'BLOB_FETCHED',
                        id: id,
                        dataUrl: directUrl,
                        isDirect: true
                    }, '*');
                    return;
                }
            }
            
            // If React props yields no URL, fail immediately (blob fetch is useless for streaming MSE anyway)
            throw new Error("No video CDN URL found in React fiber properties");
        } catch (e) {
            window.postMessage({
                action: 'BLOB_ERROR',
                id: event.data.id,
                error: e.message
            }, '*');
        }
    }
});
