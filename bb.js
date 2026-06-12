(function (Lampa) {
    'use strict';

    var NAME = 'HARD ENGINE';

    function log() {
        console.log('[' + NAME + ']', arguments);
    }

    // =========================================================
    // ADVANCED AD DETECTION
    // =========================================================
    var ADS = [
        'ad', 'ads', 'preroll', 'midroll', 'postroll',
        'vast', 'vmap', 'doubleclick', 'googlesyndication',
        'googlead', 'adservice', 'banner', 'tracking'
    ];

    function isAd(str) {
        if (!str) return false;
        str = String(str).toLowerCase();

        for (var i = 0; i < ADS.length; i++) {
            if (str.indexOf(ADS[i]) !== -1) return true;
        }
        return false;
    }

    // =========================================================
    // FETCH LAYER (AGGRESSIVE BLOCK)
    // =========================================================
    function patchFetch() {
        if (!window.fetch) return;

        var _fetch = window.fetch;

        window.fetch = function () {
            var args = arguments;

            var url = '';
            try {
                url = typeof args[0] === 'string'
                    ? args[0]
                    : (args[0] && args[0].url ? args[0].url : '');
            } catch (e) {}

            if (url && isAd(url)) {
                log('BLOCK FETCH', url);
                return Promise.resolve(new Response('', { status: 204 }));
            }

            return _fetch.apply(this, args);
        };
    }

    // =========================================================
    // XHR LAYER
    // =========================================================
    function patchXHR() {
        var open = XMLHttpRequest.prototype.open;
        var send = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (m, url) {
            this._url = url;
            return open.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            if (this._url && isAd(this._url)) {
                log('BLOCK XHR', this._url);
                try { this.abort(); } catch (e) {}
                return;
            }
            return send.apply(this, arguments);
        };
    }

    // =========================================================
    // BEACON BLOCK (TRACKING KILL)
    // =========================================================
    function patchBeacon() {
        if (!navigator.sendBeacon) return;

        var orig = navigator.sendBeacon;

        navigator.sendBeacon = function (url, data) {
            if (isAd(url)) {
                log('BLOCK BEACON', url);
                return true;
            }
            return orig.apply(navigator, arguments);
        };
    }

    // =========================================================
    // VIDEO CONTROL (SAFE AGGRESSIVE)
    // =========================================================
    function watchVideo() {
        setInterval(function () {

            var v = document.querySelector('video');
            if (!v) return;

            try {

                // 1. obvious ad source
                if (v.src && isAd(v.src)) {
                    log('VIDEO SRC BLOCK');
                    v.pause();
                    v.removeAttribute('src');
                    v.load();
                }

                // 2. player-level skip
                var p =
                    window.player ||
                    window.Player ||
                    window.videoPlayer;

                if (p && p.isInAd && p.isInAd()) {
                    if (p.skipAd) {
                        p.skipAd();
                        log('PLAYER SKIP');
                    }
                }

            } catch (e) {}

        }, 1000);
    }

    // =========================================================
    // DOM CLEANER (MEDIUM AGGRESSIVE)
    // =========================================================
    function domClean() {

        var obs = new MutationObserver(function (mutations) {

            for (var i = 0; i < mutations.length; i++) {
                var nodes = mutations[i].addedNodes;

                for (var j = 0; j < nodes.length; j++) {
                    var n = nodes[j];

                    if (!n || !n.tagName) continue;

                    var cls = (n.className || '').toString().toLowerCase();
                    var id = (n.id || '').toLowerCase();

                    if (
                        cls.indexOf('preroll') !== -1 ||
                        cls.indexOf('midroll') !== -1 ||
                        cls.indexOf('advert') !== -1 ||
                        id.indexOf('ad') !== -1
                    ) {
                        try {
                            n.remove();
                            log('REMOVE NODE');
                        } catch (e) {}
                    }
                }
            }

        });

        if (document.documentElement) {
            obs.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        }
    }

    // =========================================================
    // CSS BLOCK
    // =========================================================
    function css() {
        if (!document.head) return;

        var style = document.createElement('style');

        style.innerHTML =
            '.preroll,.midroll,.video-ads,.ads,' +
            '.advert,.banner{' +
            'display:none!important;' +
            'opacity:0!important;' +
            'pointer-events:none!important;' +
            '}';

        document.head.appendChild(style);
    }

    // =========================================================
    // INIT
    // =========================================================
    function init() {
        log('INIT HARD ENGINE');

        patchFetch();
        patchXHR();
        patchBeacon();

        watchVideo();
        domClean();
        css();
    }

    // =========================================================
    // REGISTER
    // =========================================================
    if (window.Lampa && Lampa.Plugin) {

        Lampa.Plugin.add({
            name: NAME,
            version: '3.0 HARD',
            description: 'Aggressive ad blocking without stream breaking',
            init: init
        });

    } else {
        init();
    }

})(window.Lampa);
