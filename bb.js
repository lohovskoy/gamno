(function () {
    'use strict';

    const log = (...a) => console.log('[ULTRA-ADB]', ...a);

    const AD_KEYWORDS = [
        'ad', 'ads', 'preroll', 'midroll', 'postroll',
        'vast', 'vmap', 'banner', 'doubleclick', 'googlead'
    ];

    const isAdHint = (s = '') =>
        AD_KEYWORDS.some(k => s.toLowerCase().includes(k));

    // =========================================================
    // 1. FETCH LAYER (PRO + ULTRA merge)
    // =========================================================
    const origFetch = window.fetch;

    window.fetch = async function (...args) {
        const res = await origFetch.apply(this, args);

        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

        if (!url) return res;

        try {
            const ct = res.headers.get('content-type') || '';

            // =========================
            // VAST / VMAP (PRO LAYER)
            // =========================
            if (isAdHint(url) || ct.includes('xml')) {
                const text = await res.clone().text();

                if (text.includes('<VAST') || text.includes('<VMAP')) {
                    log('BLOCK VAST/VMAP:', url);

                    return new Response('<VAST version="3.0"></VAST>', {
                        headers: { 'Content-Type': 'application/xml' }
                    });
                }

                // VMAP ad break removal
                if (text.includes('<VMAP')) {
                    return new Response('<VMAP></VMAP>', {
                        headers: { 'Content-Type': 'application/xml' }
                    });
                }
            }

            // =========================
            // JSON ADS (PRO LAYER)
            // =========================
            if (ct.includes('json')) {
                const json = await res.clone().json().catch(() => null);

                if (json && (json.ads || json.preroll || json.vast)) {
                    log('BLOCK JSON ADS:', url);

                    return new Response(JSON.stringify({
                        ads: [],
                        preroll: null,
                        midroll: null,
                        vast: null
                    }), {
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
            }

            // =========================
            // ULTRA LAYER: HLS MANIFEST ANALYSIS
            // =========================
            if (url.includes('.m3u8')) {
                const text = await res.clone().text();

                if (!text.includes('#EXTM3U')) return res;

                const lines = text.split('\n');

                let cleaned = [];
                let skipNextSegment = false;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    // EXTINF contains duration metadata
                    if (line.startsWith('#EXTINF')) {
                        const next = lines[i + 1] || '';

                        // ULTRA HEURISTIC:
                        // ads often:
                        // - very short segments (<3–5 sec)
                        // - named ad-like
                        const durationMatch = line.match(/#EXTINF:([\d.]+)/);
                        const duration = durationMatch ? parseFloat(durationMatch[1]) : 999;

                        const isAdSegment =
                            duration < 3.5 ||
                            isAdHint(next) ||
                            isAdHint(line);

                        if (isAdSegment) {
                            log('DROP SEGMENT:', duration, next);
                            skipNextSegment = true;
                            continue;
                        }
                    }

                    if (skipNextSegment) {
                        skipNextSegment = false;
                        continue;
                    }

                    cleaned.push(line);
                }

                return new Response(cleaned.join('\n'), {
                    headers: {
                        'Content-Type': 'application/vnd.apple.mpegurl'
                    }
                });
            }

        } catch (e) {}

        return res;
    };

    // =========================================================
    // 2. XHR (PRO LAYER KEEP)
    // =========================================================
    const origXHROpen = XMLHttpRequest.prototype.open;
    const origXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (m, url) {
        this._url = url;
        return origXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
        if (this._url && isAdHint(this._url)) {
            log('XHR BLOCK:', this._url);
            this.abort();
            return;
        }
        return origXHRSend.apply(this, arguments);
    };

    // =========================================================
    // 3. DOM ULTRA CLEANER (STREAM SAFE)
    // =========================================================
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const n of m.addedNodes) {
                if (!(n instanceof HTMLElement)) continue;

                const html = (n.outerHTML || '').toLowerCase();

                if (isAdHint(html)) {
                    log('DOM KILL:', n);
                    n.remove();
                }
            }
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // =========================================================
    // 4. VIDEO STREAM ULTRA ENGINE
    // =========================================================
    setInterval(() => {
        const video = document.querySelector('video');
        if (!video) return;

        // CASE 1: ad URL
        if (isAdHint(video.src)) {
            log('VIDEO SRC KILL');
            video.pause();
            video.removeAttribute('src');
            video.load();
        }

        // CASE 2: SSAI heuristic (IMPORTANT ULTRA PART)
        // sudden duration reset + very short burst patterns
        if (video.duration && video.currentTime === 0 && video.readyState >= 2) {
            if (video.duration < 6) {
                log('ULTRA HEURISTIC AD DROP');
                video.currentTime = video.duration;
            }
        }

        // CASE 3: forced ad playback detection
        const player = window.player || window.Player || window.videoPlayer;

        try {
            if (player?.isInAd?.()) {
                player.skipAd?.();
                log('PLAYER SKIP');
            }
        } catch (e) {}
    }, 700);

    // =========================================================
    // 5. NETWORK BEACON / TRACKING BLOCK (PRO EXTENSION)
    // =========================================================
    if (navigator.sendBeacon) {
        const orig = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
            if (isAdHint(url)) {
                log('BEACON BLOCK:', url);
                return true;
            }
            return orig(url, data);
        };
    }

    // =========================================================
    // 6. CSS LEVEL KILL (hidden ad containers)
    // =========================================================
    const style = document.createElement('style');
    style.innerHTML = `
        [class*="ad"], [id*="ad"],
        [class*="banner"], iframe[src*="ad"],
        .video-ads, .preroll, .midroll {
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
            height: 0 !important;
        }
    `;
    document.head.appendChild(style);

    log('ULTRA + PRO AdBlock ACTIVE');
})();
