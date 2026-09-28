(function (Lampa) {
    'use strict';

    var NAME = 'AdBlock';

    function log() {
        var args = Array.prototype.slice.call(arguments);
        console.log.apply(console, ['[' + NAME + ']'].concat(args));
    }

    // =========================================================
    //  Ключевые слова — только явно рекламные
    //  (убрали 'banner', 'tracking', 'ad' — слишком широкие,
    //   ломают запросы плагинов-источников)
    // =========================================================
    var ADS = [
        'preroll', 'midroll', 'postroll',
        'vast', 'vmap',
        'doubleclick', 'googlesyndication',
        'adriver.ru', 'begun.ru', 'smi2.ru',
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
    //  Флаг — блокировщик сети активен только во время плеера
    // =========================================================
    var networkBlockActive = false;

    // =========================================================
    //  Сохраняем оригиналы ДО любых патчей
    // =========================================================
    var _fetch   = window.fetch ? window.fetch.bind(window) : null;
    var _xhrOpen = XMLHttpRequest.prototype.open;
    var _xhrSend = XMLHttpRequest.prototype.send;
    var _beacon  = navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null;

    // =========================================================
    //  FETCH — проверяем флаг перед блокировкой
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

            if (networkBlockActive && url && isAd(url)) {
                log('BLOCK FETCH', url);
                return Promise.resolve(new Response('', { status: 204 }));
            }

            return _fetch.apply(this, args);
        };

        log('fetch патч установлен (ждёт активации)');
    }

    // =========================================================
    //  XHR — проверяем флаг перед блокировкой
    // =========================================================
    function patchXHR() {
        XMLHttpRequest.prototype.open = function (m, url) {
            this._adblock_url = url;
            return _xhrOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {
            if (networkBlockActive && this._adblock_url && isAd(this._adblock_url)) {
                log('BLOCK XHR', this._adblock_url);
                try { this.abort(); } catch (e) {}
                return;
            }
            return _xhrSend.apply(this, arguments);
        };

        log('XHR патч установлен (ждёт активации)');
    }

    // =========================================================
    //  BEACON — трекинг блокируем всегда (он не мешает
    //  источникам фильмов, только отсылает аналитику)
    // =========================================================
    function patchBeacon() {
        if (!_beacon) return;

        navigator.sendBeacon = function (url, data) {
            if (isAd(url)) {
                log('BLOCK BEACON', url);
                return true;
            }
            return _beacon.apply(navigator, arguments);
        };

        log('Beacon заблокирован');
    }

    // =========================================================
    //  CSS — скрываем рекламные слои (безопасно, всегда)
    // =========================================================
    function injectCSS() {
        var style = document.createElement('style');
        style.innerHTML = [
            '.preroll,.midroll,.video-ads,.advert{',
            '  display:none!important;',
            '  opacity:0!important;',
            '  pointer-events:none!important',
            '}'
        ].join('');
        document.head.appendChild(style);
        log('CSS инжектирован');
    }

    // =========================================================
    //  VIDEO WATCHER — только пока плеер открыт
    // =========================================================
    var videoInterval = null;

    function startVideoWatch() {
        if (videoInterval) return;

        videoInterval = setInterval(function () {
            var v = document.querySelector('video');
            if (!v) return;

            try {
                // Рекламный src — убираем
                if (v.src && isAd(v.src)) {
                    log('VIDEO SRC BLOCK', v.src);
                    v.pause();
                    v.removeAttribute('src');
                    v.load();
                    return;
                }

                // Кнопка пропуска — кликаем
                var skipBtn = document.querySelector(
                    '.skip-button,.skip-ad,.skip_button,[class*="skip"],[id*="skip"]'
                );
                if (skipBtn) {
                    skipBtn.click();
                    log('SKIP нажат');
                }

                // API плеера
                var p = window.player || window.Player || window.videoPlayer;
                if (p && typeof p.isInAd === 'function' && p.isInAd()) {
                    if (typeof p.skipAd === 'function') {
                        p.skipAd();
                        log('PLAYER.skipAd()');
                    }
                }
            } catch (e) {}

        }, 800);

        log('Video watcher запущен');
    }

    function stopVideoWatch() {
        if (videoInterval) {
            clearInterval(videoInterval);
            videoInterval = null;
            log('Video watcher остановлен');
        }
    }

    // =========================================================
    //  DOM CLEANER — только пока плеер открыт
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
                        cls.indexOf('preroll')  !== -1 ||
                        cls.indexOf('midroll')  !== -1 ||
                        cls.indexOf('advert')   !== -1 ||
                        id.indexOf('preroll')   !== -1
                    ) {
                        try { n.remove(); log('DOM: удалён', n.className || n.id); }
                        catch (e) {}
                    }
                }
            }
        });

        if (document.documentElement) {
            domObserver.observe(document.documentElement, {
                childList: true,
                subtree: true
            });
        }

        log('DOM observer запущен');
    }

    function stopDomClean() {
        if (domObserver) {
            domObserver.disconnect();
            domObserver = null;
            log('DOM observer остановлен');
        }
    }

    // =========================================================
    //  Account.hasPremium — говорим что у нас премиум
    //  (применяем сразу — это не мешает источникам)
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
    //  VideoBlock stub — пустышка вместо рекламного блока
    // =========================================================
    function patchVideoBlock() {
        function Stub() {}
        Stub.prototype.start   = function () { log('VideoBlock.start заглушён'); };
        Stub.prototype.load    = function () {};
        Stub.prototype.create  = function () {};
        Stub.prototype.stop    = function () {};
        Stub.prototype.destroy = function () {};

        if (window.VideoBlock)             window.VideoBlock = Stub;
        if (Lampa && Lampa.VideoBlock)     Lampa.VideoBlock  = Stub;

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
    //  Включаем / выключаем "горячие" блокировщики
    //  строго по событиям плеера Lampa
    // =========================================================
    function activateForPlayer() {
        log('▶ Плеер открыт — активируем блокировщики');
        networkBlockActive = true;
        startVideoWatch();
        startDomClean();
    }

    function deactivateForPlayer() {
        log('■ Плеер закрыт — деактивируем блокировщики');
        networkBlockActive = false;
        stopVideoWatch();
        stopDomClean();
    }

    function bindLampaEvents() {
        if (!Lampa || !Lampa.Listener) return;

        // player:open / player:video  — плеер готов показывать
        Lampa.Listener.follow('player:open',    activateForPlayer);
        Lampa.Listener.follow('player:video',   activateForPlayer);
        Lampa.Listener.follow('player:start',   activateForPlayer);

        // player:close / player:destroy — плеер закрыт
        Lampa.Listener.follow('player:close',   deactivateForPlayer);
        Lampa.Listener.follow('player:destroy', deactivateForPlayer);
        Lampa.Listener.follow('player:end',     deactivateForPlayer);

        log('Lampa события привязаны');
    }

    // =========================================================
    //  INIT
    // =========================================================
    function init() {
        log('INIT v3.1');

        // Безопасные патчи — не мешают источникам, работают всегда
        patchAccount();
        patchBeacon();
        injectCSS();

        // Сетевые патчи — установлены, но НЕАКТИВНЫ до плеера
        patchFetch();
        patchXHR();

        // Lampa-специфичные патчи
        patchVideoBlock();
        bindLampaEvents();

        log('Готов. Сетевая блокировка активируется при старте плеера.');
    }

    // =========================================================
    //  REGISTER
    // =========================================================
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
        window.plugin_manager.add({ name: NAME, version: '3.1', tag: 'lampa_adblock' });
    }

})(window.Lampa);
