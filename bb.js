(function (Lampa) {
    'use strict';

    var NAME = 'AdBlock';

    function log() {
        console.log('[' + NAME + ']', arguments);
    }

    // Блокируем только сетевые запросы к рекламным доменам.
    // Реклама в Lampa запускается только при старте видео через XHR к этим доменам —
    // если запрос не прошёл, VAST не получен, preroll не запускается.
    var ADS = [
        'bid.ctv.house',       // основной рекламный сервер из логов
        'betweendigital',      // второй рекламный сервер из логов
        'preroll',             // универсальный паттерн
        'midroll',
        'postroll',
        'vast', 'vmap',        // форматы рекламных манифестов
        'doubleclick',
        'googlesyndication',
        'adriver',
        'begun.ru',
        'smi2',
        'adservice',
        '/advert'
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
            var url = '';
            try {
                url = typeof arguments[0] === 'string'
                    ? arguments[0]
                    : (arguments[0] && arguments[0].url ? arguments[0].url : '');
            } catch (e) {}
            if (url && isAd(url)) {
                log('BLOCK FETCH', url);
                return Promise.resolve(new Response('', { status: 204 }));
            }
            return _fetch.apply(this, arguments);
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
    // BEACON — трекинг показов рекламы
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
    // CSS — скрываем рекламные оверлеи если вдруг появятся
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
        log('INIT v2.0');
        patchFetch();
        patchXHR();
        patchBeacon();
        css();
        log('Готов — watchVideo убран, только сетевая блокировка');
    }

    // =========================================================
    // REGISTER
    // =========================================================
    if (window.Lampa && Lampa.Plugin) {
        Lampa.Plugin.add({
            name: NAME,
            version: '2.0',
            description: 'Ad blocker — network only',
            init: init
        });
    } else {
        init();
    }

})(window.Lampa);
