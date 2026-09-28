(function (Lampa) {
    'use strict';

    var NAME = 'AdBlock';

    function log() {
        console.log('[' + NAME + ']', arguments);
    }

    // =========================================================
    // Точные домены из логов + универсальные паттерны
    // НЕ используем: 'ad','ads','banner','tracking' — ломают источники
    // =========================================================
    var ADS = [
        'bid.ctv.house',
        'betweendigital',
        'preroll', 'midroll', 'postroll',
        'vast', 'vmap',
        'doubleclick', 'googlesyndication',
        'adriver', 'begun.ru', 'smi2',
        'adservice', '/advert', '/adv/'
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
    // FETCH
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
    // XHR
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
    // BEACON
    // =========================================================
    function patchBeacon() {
        if (!navigator.sendBeacon) return;
        var orig = navigator.sendBeacon;
        navigator.sendBeacon = function (url, data) {
            if (isAd(url)) { log('BLOCK BEACON', url); return true; }
            return orig.apply(navigator, arguments);
        };
    }

    // =========================================================
    // VIDEO WATCHER
    // =========================================================
    function watchVideo() {
        setInterval(function () {
            var v = document.querySelector('video');
            if (!v) return;
            try {
                if (v.src && isAd(v.src)) {
                    log('VIDEO SRC BLOCK');
                    v.pause();
                    v.removeAttribute('src');
                    v.load();
                }
                var skip = document.querySelector(
                    '.skip-button,.skip-ad,[class*="skip"],[id*="skip"]'
                );
                if (skip) { skip.click(); log('SKIP'); }
            } catch (e) {}
        }, 800);
    }

    // =========================================================
    // DOM CLEANER
    // =========================================================
    function domClean() {
        var obs = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var nodes = mutations[i].addedNodes;
                for (var j = 0; j < nodes.length; j++) {
                    var n = nodes[j];
                    if (!n || !n.tagName) continue;
                    var cls = (n.className || '').toString().toLowerCase();
                    var id  = (n.id || '').toLowerCase();
                    if (
                        cls.indexOf('preroll') !== -1 ||
                        cls.indexOf('midroll') !== -1 ||
                        cls.indexOf('advert')  !== -1 ||
                        id.indexOf('preroll')  !== -1
                    ) {
                        try { n.remove(); log('REMOVE NODE'); } catch (e) {}
                    }
                }
            }
        });
        if (document.documentElement) {
            obs.observe(document.documentElement, { childList: true, subtree: true });
        }
    }

    // =========================================================
    // CSS
    // =========================================================
    function css() {
        if (!document.head) return;
        var style = document.createElement('style');
        style.innerHTML =
            '.preroll,.midroll,.video-ads,.advert{' +
            'display:none!important;' +
            'opacity:0!important;' +
            'pointer-events:none!important}';
        document.head.appendChild(style);
    }

    // =========================================================
    // INIT
    // =========================================================
    function init() {
        log('INIT');
        patchFetch();
        patchXHR();
        patchBeacon();
        watchVideo();
        domClean();
        css();
    }

    // =========================================================
    // REGISTER — точно как в bb.js через Lampa.Plugin.add
    // =========================================================
    if (window.Lampa && Lampa.Plugin) {
        Lampa.Plugin.add({
            name: NAME,
            version: '1.0',
            description: 'Ad blocker',
            init: init
        });
    } else {
        init();
    }

})(window.Lampa);
