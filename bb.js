(function (Lampa) {
    'use strict';

    var NAME = 'AdBlock';

    function log() {
        var args = Array.prototype.slice.call(arguments);
        console.log.apply(console, ['[' + NAME + ']'].concat(args));
    }

    // =========================================================
    //  Ключевые слова для рекламных URL
    //  Намеренно НЕ включаем 'ad','ads','banner' — слишком
    //  широкие, ломают запросы плагинов-источников
    // =========================================================
    var ADS_NET = [
        'preroll', 'midroll', 'postroll',
        'vast', 'vmap',
        'doubleclick', 'googlesyndication',
        'adriver.ru', 'begun.ru', 'smi2.ru',
        'adservice', '/advert', '/adv/'
    ];

    // Для video.src проверяем отдельным списком — тут можно шире
    var ADS_VIDEO = [
        'preroll', 'midroll', 'postroll',
        'vast', 'vmap', 'advert', '/adv',
        'doubleclick', 'googlesyndication',
        'adriver', 'begun', 'smi2'
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
    //  Флаг — сетевая блокировка активна только в плеере
    // =========================================================
    var networkBlockActive = false;

    // =========================================================
    //  Оригиналы
    // =========================================================
    var _fetch   = window.fetch   ? window.fetch.bind(window)     : null;
    var _xhrOpen = XMLHttpRequest.prototype.open;
    var _xhrSend = XMLHttpRequest.prototype.send;
    var _beacon  = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;

    // =========================================================
    //  1. FETCH — активен только в плеере
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
    //  2. XHR — активен только в плеере
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
    //  3. BEACON — блокируем всегда (только трекинг, не источники)
    // =========================================================
    function patchBeacon() {
        if (!_beacon) return;
        navigator.sendBeacon = function (url, data) {
            if (isAdNet(url)) {
                log('BLOCK BEACON', url);
                return true;
            }
            return _beacon.apply(navigator, arguments);
        };
        log('Beacon заблокирован');
    }

    // =========================================================
    //  4. createElement Proxy — КЛЮЧЕВОЙ ТРЮК
    //     Запускаем СРАЗУ, не ждём плеера
    //     Когда реклама создаёт <video> — эмулируем ended
    // =========================================================
    function patchCreateElement() {
        document.createElement = new Proxy(document.createElement, {
            apply: function (target, thisArg, args) {
                var tag = (args[0] || '').toLowerCase();

                if (tag === 'video') {
                    var video = target.apply(thisArg, args);

                    // Перехватываем play()
                    var _play = video.play.bind(video);
                    video.play = function () {
                        if (video.src && isAdVideo(video.src)) {
                            log('BLOCK video.play, src:', video.src);
                            setTimeout(function () {
                                try {
                                    video.dispatchEvent(new Event('ended'));
                                    video.dispatchEvent(new Event('complete'));
                                } catch (e) {}
                            }, 100);
                            return Promise.resolve();
                        }
                        return _play();
                    };

                    // Перехватываем setAttribute src
                    var _setAttr = video.setAttribute.bind(video);
                    video.setAttribute = function (name, value) {
                        if (name === 'src' && isAdVideo(value)) {
                            log('BLOCK video.setAttribute src:', value);
                            setTimeout(function () {
                                try { video.dispatchEvent(new Event('ended')); } catch (e) {}
                            }, 100);
                            return;
                        }
                        return _setAttr(name, value);
                    };

                    return video;
                }

                return target.apply(thisArg, args);
            }
        });
        log('createElement Proxy установлен');
    }

    // =========================================================
    //  5. network.silent — внутренний метод Lampa
    //     Возвращаем пустой массив вместо рекламных данных
    // =========================================================
    function patchNetwork() {
        var targets = [
            window.network,
            Lampa && Lampa.Network,
        ].filter(Boolean);

        targets.forEach(function (net) {
            if (net && typeof net.silent === 'function') {
                net.silent = function (url, ok) {
                    log('network.silent перехвачен:', url);
                    if (typeof ok === 'function') ok([]);
                };
                log('network.silent заглушён');
            }
        });

        // Ищем network$N в window (минифицированный бандл)
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
    //  6. Account.hasPremium → true
    //     Применяем сразу — не мешает источникам
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
    //  7. VideoBlock stub
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
    //  8. Lampa.Storage — подмена флагов рекламы
    // =========================================================
    function patchStorage() {
        if (!Lampa || !Lampa.Storage) return;

        var AD_KEYS = ['adv', 'advert', 'ad_enable', 'show_ad', 'preroll', 'ad_url'];
        var _storageGet = Lampa.Storage.get;

        Lampa.Storage.get = function (key, def) {
            if (AD_KEYS.indexOf(key) !== -1) {
                log('Storage.get заблокирован:', key);
                return false;
            }
            return _storageGet.apply(this, arguments);
        };
        log('Lampa.Storage.get перехвачен');
    }

    // =========================================================
    //  9. Video watcher — только в плеере
    // =========================================================
    var videoInterval = null;

    function startVideoWatch() {
        if (videoInterval) return;
        videoInterval = setInterval(function () {
            var v = document.querySelector('video');
            if (!v) return;
            try {
                if (v.src && isAdVideo(v.src)) {
                    log('VIDEO SRC BLOCK');
                    v.pause();
                    v.removeAttribute('src');
                    v.load();
                    return;
                }
                var skipBtn = document.querySelector(
                    '.skip-button,.skip-ad,.skip_button,[class*="skip"],[id*="skip"]'
                );
                if (skipBtn) { skipBtn.click(); log('SKIP нажат'); }

                var p = window.player || window.Player || window.videoPlayer;
                if (p && typeof p.isInAd === 'function' && p.isInAd()) {
                    if (typeof p.skipAd === 'function') { p.skipAd(); log('PLAYER.skipAd()'); }
                }
            } catch (e) {}
        }, 800);
        log('Video watcher запущен');
    }

    function stopVideoWatch() {
        if (videoInterval) { clearInterval(videoInterval); videoInterval = null; }
        log('Video watcher остановлен');
    }

    // =========================================================
    //  10. DOM cleaner — только в плеере
    // =========================================================
    var domObserver = null;

    function startDomClean() {
        if (domObserver) return;
        domObserver = new MutationObserver(function (mutations) {
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
                        try { n.remove(); log('DOM удалён:', cls || id); } catch (e) {}
                    }
                }
            }
        });
        domObserver.observe(document.documentElement, { childList: true, subtree: true });
        log('DOM observer запущен');
    }

    function stopDomClean() {
        if (domObserver) { domObserver.disconnect(); domObserver = null; }
        log('DOM observer остановлен');
    }

    // =========================================================
    //  CSS — всегда
    // =========================================================
    function injectCSS() {
        var style = document.createElement('style');
        style.innerHTML =
            '.preroll,.midroll,.video-ads,.advert{' +
            'display:none!important;opacity:0!important;pointer-events:none!important}';
        document.head.appendChild(style);
        log('CSS инжектирован');
    }

    // =========================================================
    //  Включаем / выключаем по событиям плеера
    // =========================================================
    function activateForPlayer() {
        log('▶ Плеер открыт — блокировщики ON');
        networkBlockActive = true;
        startVideoWatch();
        startDomClean();
    }

    function deactivateForPlayer() {
        log('■ Плеер закрыт — блокировщики OFF');
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
        log('INIT v3.2');

        // Сразу — не ждём плеера
        patchAccount();
        patchCreateElement();  // ← был потерян, теперь вернули
        patchBeacon();
        patchFetch();
        patchXHR();
        injectCSS();

        // После ready Lampa
        patchNetwork();
        patchVideoBlock();
        patchStorage();
        bindLampaEvents();

        log('Все патчи применены. Сетевая блокировка ждёт плеера.');
    }

    // =========================================================
    //  REGISTER
    // =========================================================

    // createElement и account патчим прямо сейчас — максимально рано
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
        window.plugin_manager.add({ name: NAME, version: '3.2', tag: 'lampa_adblock' });
    }

})(window.Lampa);
