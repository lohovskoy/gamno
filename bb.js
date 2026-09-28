(function (Lampa) {
    'use strict';

    var NAME = 'AdBlock';

    function log() {
        var args = Array.prototype.slice.call(arguments);
        console.log.apply(console, ['[' + NAME + ']'].concat(args));
    }

    // =========================================================
    //  Проверка поддержки Proxy (старые Smart TV не поддерживают)
    // =========================================================
    var PROXY_SUPPORTED = (function () {
        try { new Proxy({}, {}); return true; } catch (e) { return false; }
    })();

    log('Proxy поддерживается:', PROXY_SUPPORTED);

    // =========================================================
    //  Ключевые слова
    // =========================================================
    var ADS_NET = [
        'preroll', 'midroll', 'postroll',
        'vast', 'vmap',
        'doubleclick', 'googlesyndication',
        'adriver.ru', 'begun.ru', 'smi2.ru',
        'adservice', '/advert', '/adv/',
        'netfix', 'cub'          // ← из лога: "run netfix_two from cub"
    ];

    var ADS_VIDEO = [
        'preroll', 'midroll', 'postroll',
        'vast', 'vmap', 'advert', '/adv',
        'doubleclick', 'googlesyndication',
        'adriver', 'begun', 'smi2',
        'netfix', 'cub'
    ];

    function isAdNet(str) {
        if (!str) return false;
        str = String(str).toLowerCase();
        for (var i = 0; i < ADS_NET.length; i++) {
            if (str.indexOf(ADS_NET[i]) !== -1) return true;
        }
        return false;
    }

    function isAdVideo(str) {
        if (!str) return false;
        str = String(str).toLowerCase();
        for (var i = 0; i < ADS_VIDEO.length; i++) {
            if (str.indexOf(ADS_VIDEO[i]) !== -1) return true;
        }
        return false;
    }

    // =========================================================
    //  Флаг сетевой блокировки — только в плеере
    // =========================================================
    var networkBlockActive = false;

    // =========================================================
    //  Оригиналы
    // =========================================================
    var _fetch   = window.fetch   ? window.fetch.bind(window)       : null;
    var _xhrOpen = XMLHttpRequest.prototype.open;
    var _xhrSend = XMLHttpRequest.prototype.send;
    var _beacon  = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;
    var _createElement = document.createElement.bind(document);

    // =========================================================
    //  1. FETCH
    // =========================================================
    function patchFetch() {
        if (!_fetch) return;
        window.fetch = function () {
            var args = arguments;
            var url  = '';
            try {
                url = typeof args[0] === 'string'
                    ? args[0]
                    : (args[0] && args[0].url ? args[0].url : '');
            } catch (e) {}

            if (networkBlockActive && url && isAdNet(url)) {
                log('BLOCK FETCH', url);
                return Promise.resolve(new Response('', { status: 204 }));
            }
            return _fetch.apply(this, args);
        };
        log('fetch патч установлен');
    }

    // =========================================================
    //  2. XHR
    // =========================================================
    function patchXHR() {
        XMLHttpRequest.prototype.open = function (m, url) {
            this._adblock_url = url;
            return _xhrOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            if (networkBlockActive && this._adblock_url && isAdNet(this._adblock_url)) {
                log('BLOCK XHR', this._adblock_url);
                try { this.abort(); } catch (e) {}
                return;
            }
            return _xhrSend.apply(this, arguments);
        };
        log('XHR патч установлен');
    }

    // =========================================================
    //  3. BEACON
    // =========================================================
    function patchBeacon() {
        if (!_beacon) return;
        navigator.sendBeacon = function (url, data) {
            if (isAdNet(url)) { log('BLOCK BEACON', url); return true; }
            return _beacon.apply(navigator, arguments);
        };
        log('Beacon заблокирован');
    }

    // =========================================================
    //  4. createElement — БЕЗ Proxy, совместимо со старыми TV
    //     Переопределяем напрямую через обычную функцию
    // =========================================================
    function patchCreateElement() {
        if (PROXY_SUPPORTED) {
            // Современные устройства — через Proxy (надёжнее)
            document.createElement = new Proxy(document.createElement, {
                apply: function (target, thisArg, args) {
                    var el = target.apply(thisArg, args);
                    if ((args[0] || '').toLowerCase() === 'video') {
                        wrapVideoElement(el);
                    }
                    return el;
                }
            });
            log('createElement Proxy установлен');
        } else {
            // Старые Smart TV — обычное переопределение
            document.createElement = function (tag) {
                var el = _createElement(tag);
                if ((tag || '').toLowerCase() === 'video') {
                    wrapVideoElement(el);
                }
                return el;
            };
            log('createElement патч установлен (без Proxy)');
        }
    }

    function wrapVideoElement(video) {
        var _play = video.play ? video.play.bind(video) : null;

        video.play = function () {
            if (video.src && isAdVideo(video.src)) {
                log('BLOCK video.play src:', video.src);
                emitEnded(video);
                return Promise.resolve();
            }
            return _play ? _play() : undefined;
        };

        var _setAttr = video.setAttribute ? video.setAttribute.bind(video) : null;
        video.setAttribute = function (name, value) {
            if (name === 'src' && isAdVideo(value)) {
                log('BLOCK video.setAttribute src:', value);
                emitEnded(video);
                return;
            }
            return _setAttr ? _setAttr(name, value) : undefined;
        };
    }

    function emitEnded(video) {
        setTimeout(function () {
            try {
                video.dispatchEvent(new Event('ended'));
                video.dispatchEvent(new Event('complete'));
            } catch (e) {}
        }, 100);
    }

    // =========================================================
    //  5. Патч внутреннего Ad-менеджера Lampa
    //     Из лога видно: [Ad] manager preroll filter view
    //     Lampa хранит Ad-менеджер — найдём и заглушим
    // =========================================================
    function patchAdManager() {
        // Ищем объект с методами preroll / manager в window
        try {
            Object.keys(window).forEach(function (key) {
                var obj = window[key];
                if (!obj || typeof obj !== 'object') return;

                // Ищем по наличию методов рекламного менеджера
                if (typeof obj.preroll === 'function' || typeof obj.manager === 'function') {
                    if (typeof obj.preroll === 'function') {
                        obj.preroll = function () { log('Ad.preroll заглушён'); };
                    }
                    if (typeof obj.manager === 'function') {
                        obj.manager = function () { log('Ad.manager заглушён'); };
                    }
                    log('Ad-менеджер заглушён:', key);
                }
            });
        } catch (e) {}

        // Также патчим через Lampa напрямую
        if (Lampa && Lampa.Ad) {
            if (typeof Lampa.Ad.preroll === 'function') {
                Lampa.Ad.preroll = function () { log('Lampa.Ad.preroll заглушён'); };
            }
            if (typeof Lampa.Ad.manager === 'function') {
                Lampa.Ad.manager = function () { log('Lampa.Ad.manager заглушён'); };
            }
            log('Lampa.Ad заглушён');
        }
    }

    // =========================================================
    //  6. network.silent
    // =========================================================
    function patchNetwork() {
        var targets = [window.network, Lampa && Lampa.Network].filter(Boolean);
        targets.forEach(function (net) {
            if (net && typeof net.silent === 'function') {
                net.silent = function (url, ok) {
                    log('network.silent:', url);
                    if (typeof ok === 'function') ok([]);
                };
            }
        });
        try {
            Object.keys(window).forEach(function (key) {
                if (/^network/i.test(key)) {
                    var obj = window[key];
                    if (obj && typeof obj.silent === 'function') {
                        obj.silent = function (url, ok) {
                            if (typeof ok === 'function') ok([]);
                        };
                        log('network.silent заглушён:', key);
                    }
                }
            });
        } catch (e) {}
    }

    // =========================================================
    //  7. Account.hasPremium
    // =========================================================
    function patchAccount() {
        window.Account = window.Account || {};
        window.Account.hasPremium = function () { return true; };
        window.Account.isPremium  = function () { return true; };
        window.Account.premium    = true;
        if (Lampa && Lampa.Account) {
            Lampa.Account.hasPremium = function () { return true; };
            Lampa.Account.isPremium  = function () { return true; };
        }
        log('Account.hasPremium → true');
    }

    // =========================================================
    //  8. VideoBlock stub
    // =========================================================
    function patchVideoBlock() {
        function Stub() {}
        Stub.prototype.start   = function () { log('VideoBlock.start заглушён'); };
        Stub.prototype.load    = function () {};
        Stub.prototype.create  = function () {};
        Stub.prototype.stop    = function () {};
        Stub.prototype.destroy = function () {};

        if (window.VideoBlock)         window.VideoBlock = Stub;
        if (Lampa && Lampa.VideoBlock) Lampa.VideoBlock  = Stub;

        try {
            Object.keys(window).forEach(function (key) {
                var obj = window[key];
                if (
                    obj && typeof obj === 'function' && obj.prototype &&
                    typeof obj.prototype.start  === 'function' &&
                    typeof obj.prototype.load   === 'function' &&
                    typeof obj.prototype.create === 'function'
                ) {
                    window[key] = Stub;
                    log('VideoBlock заменён:', key);
                }
            });
        } catch (e) {}
    }

    // =========================================================
    //  9. Storage
    // =========================================================
    function patchStorage() {
        if (!Lampa || !Lampa.Storage) return;
        var AD_KEYS = ['adv', 'advert', 'ad_enable', 'show_ad', 'preroll', 'ad_url'];
        var _get = Lampa.Storage.get;
        Lampa.Storage.get = function (key, def) {
            if (AD_KEYS.indexOf(key) !== -1) { return false; }
            return _get.apply(this, arguments);
        };
        log('Storage.get перехвачен');
    }

    // =========================================================
    //  10. Video watcher + DOM cleaner (только в плеере)
    // =========================================================
    var videoInterval = null;
    var domObserver   = null;

    function startVideoWatch() {
        if (videoInterval) return;
        videoInterval = setInterval(function () {
            var v = document.querySelector('video');
            if (!v || !v.src) return;
            try {
                if (isAdVideo(v.src)) {
                    log('VIDEO SRC BLOCK');
                    v.pause();
                    v.removeAttribute('src');
                    v.load();
                }
                var skip = document.querySelector(
                    '.skip-button,.skip-ad,[class*="skip"],[id*="skip"]'
                );
                if (skip) { skip.click(); log('SKIP нажат'); }
            } catch (e) {}
        }, 800);
    }

    function stopVideoWatch() {
        if (videoInterval) { clearInterval(videoInterval); videoInterval = null; }
    }

    function startDomClean() {
        if (domObserver) return;
        domObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var nodes = mutations[i].addedNodes;
                for (var j = 0; j < nodes.length; j++) {
                    var n = nodes[j];
                    if (!n || !n.tagName) continue;
                    var cls = (n.className || '').toString().toLowerCase();
                    if (
                        cls.indexOf('preroll') !== -1 ||
                        cls.indexOf('midroll') !== -1 ||
                        cls.indexOf('advert')  !== -1
                    ) {
                        try { n.remove(); } catch (e) {}
                    }
                }
            }
        });
        domObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopDomClean() {
        if (domObserver) { domObserver.disconnect(); domObserver = null; }
    }

    // =========================================================
    //  CSS
    // =========================================================
    function injectCSS() {
        var style = _createElement('style');
        style.innerHTML =
            '.preroll,.midroll,.video-ads,.advert{' +
            'display:none!important;opacity:0!important;pointer-events:none!important}';
        document.head.appendChild(style);
    }

    // =========================================================
    //  События плеера
    // =========================================================
    function activateForPlayer() {
        log('▶ Плеер открыт');
        networkBlockActive = true;
        startVideoWatch();
        startDomClean();
    }

    function deactivateForPlayer() {
        log('■ Плеер закрыт');
        networkBlockActive = false;
        stopVideoWatch();
        stopDomClean();
    }

    function bindLampaEvents() {
        if (!Lampa || !Lampa.Listener) return;
        Lampa.Listener.follow('player:open',    activateForPlayer);
        Lampa.Listener.follow('player:video',   activateForPlayer);
        Lampa.Listener.follow('player:start',   activateForPlayer);
        Lampa.Listener.follow('player:close',   deactivateForPlayer);
        Lampa.Listener.follow('player:destroy', deactivateForPlayer);
        Lampa.Listener.follow('player:end',     deactivateForPlayer);
        log('Lampa события привязаны');
    }

    // =========================================================
    //  INIT
    // =========================================================
    function init() {
        log('INIT v3.3');
        patchFetch();
        patchXHR();
        patchBeacon();
        patchNetwork();
        patchVideoBlock();
        patchAdManager();
        patchStorage();
        injectCSS();
        bindLampaEvents();
        log('Готов ✓');
    }

    // Самые ранние патчи — до Lampa
    patchAccount();
    patchCreateElement();

    if (Lampa && Lampa.Listener) {
        Lampa.Listener.follow('ready', init);
    } else {
        var attempts = 0;
        var wait = setInterval(function () {
            if (window.Lampa && window.Lampa.Listener) {
                clearInterval(wait);
                window.Lampa.Listener.follow('ready', init);
            } else if (++attempts >= 30) {
                clearInterval(wait);
                init();
            }
        }, 100);
    }

    if (window.plugin_manager) {
        window.plugin_manager.add({ name: NAME, version: '3.3', tag: 'lampa_adblock' });
    }

})(window.Lampa);
