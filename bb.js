(function (Lampa) {
    'use strict';

    var NAME = 'AdBlock';

    function log() {
        console.log('[' + NAME + ']', arguments);
    }

    var ADS = [
        'bid.ctv.house',
        'betweendigital',
        'preroll', 'midroll', 'postroll',
        'vast', 'vmap',
        'doubleclick', 'googlesyndication',
        'adriver', 'begun.ru', 'smi2',
        'adservice', '/advert'
    ];

    function isAd(str) {
        if (!str) return false;
        str = String(str).toLowerCase();
        for (var i = 0; i < ADS.length; i++) {
            if (str.indexOf(ADS[i]) !== -1) return true;
        }
        return false;
    }

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

    function patchBeacon() {
        if (!navigator.sendBeacon) return;
        var orig = navigator.sendBeacon;
        navigator.sendBeacon = function (url, data) {
            if (isAd(url)) { log('BLOCK BEACON', url); return true; }
            return orig.apply(navigator, arguments);
        };
    }

    function css() {
        if (!document.head) return;
        var style = document.createElement('style');
        style.innerHTML =
            '.preroll,.midroll,.video-ads,.advert{' +
            'display:none!important;opacity:0!important;pointer-events:none!important}';
        document.head.appendChild(style);
    }

    function init() {
        log('INIT v2.1');
        patchFetch();
        patchXHR();
        patchBeacon();
        css();
    }

    if (window.Lampa && Lampa.Plugin) {
        Lampa.Plugin.add({
            name: NAME,
            version: '2.1',
            description: 'Ad blocker',
            init: init
        });
    } else {
        init();
    }

})(window.Lampa);
