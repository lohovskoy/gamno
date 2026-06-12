(function () {
    'use strict';

    var PLUGIN = {
        name:        'Lampa AdBlock',
        tag:         'lampa_adblock',
        version:     '3.0.0',
        description: 'Блокировка встроенной рекламы Lampa',
    };

    function log(msg) {
        console.log('[AdBlock] ' + msg);
    }

    // =========================================================
    //  1. Подменяем премиум-аккаунт
    //     Многие рекламные блоки показываются только не-премиум
    //     пользователям — говорим Lampa что у нас премиум
    // =========================================================
    function patchAccount() {
        window.Account = window.Account || {};
        window.Account.hasPremium = function () { return true; };
        window.Account.isPremium  = function () { return true; };
        window.Account.premium    = true;

        // Lampa может хранить аккаунт и внутри своего неймспейса
        if (window.Lampa && window.Lampa.Account) {
            window.Lampa.Account.hasPremium = function () { return true; };
            window.Lampa.Account.isPremium  = function () { return true; };
            window.Lampa.Account.premium    = true;
        }

        log('Account.hasPremium → true');
    }

    // =========================================================
    //  2. Proxy на document.createElement
    //     Когда реклама создаёт <video>, подсовываем фейковый
    //     элемент который сразу сообщает о завершении
    // =========================================================
    function patchCreateElement() {
        var _realCreate = document.createElement.bind(document);
        var _adVideoActive = false;

        document.createElement = new Proxy(document.createElement, {
            apply: function (target, thisArg, args) {
                var tag = args[0] && args[0].toLowerCase();

                if (tag === 'video') {
                    // Создаём настоящий video-элемент
                    var video = target.apply(thisArg, args);

                    // Перехватываем play()
                    var originalPlay = video.play.bind(video);
                    video.play = function () {
                        // Если у видео нет src или src похож на рекламный — глушим
                        if (!video.src || isAdUrl(video.src)) {
                            log('Рекламное видео заблокировано (play перехвачен)');
                            // Эмулируем мгновенное завершение рекламы
                            setTimeout(function () {
                                try {
                                    Object.defineProperty(video, 'ended', { value: true, writable: true });
                                    video.dispatchEvent(new Event('ended'));
                                    video.dispatchEvent(new Event('complete'));
                                } catch (e) {}
                            }, 200);
                            return Promise.resolve();
                        }
                        return originalPlay();
                    };

                    // Перехватываем setAttribute('src', ...)
                    var originalSetAttr = video.setAttribute.bind(video);
                    video.setAttribute = function (name, value) {
                        if (name === 'src' && isAdUrl(value)) {
                            log('Рекламный src заблокирован → ' + value);
                            return;
                        }
                        return originalSetAttr(name, value);
                    };

                    return video;
                }

                return target.apply(thisArg, args);
            }
        });

        log('document.createElement Proxy установлен');
    }

    // =========================================================
    //  3. Глушим network.silent — Lampa получает через него
    //     список рекламных url / заблокированных доменов
    // =========================================================
    function patchNetwork() {
        var targets = [
            window.network,
            window.Lampa && window.Lampa.Network,
        ].filter(Boolean);

        targets.forEach(function (net) {
            if (net && typeof net.silent === 'function') {
                net.silent = function (url, ok) {
                    log('network.silent → ' + url);
                    if (typeof ok === 'function') ok([]);
                };
                log('network.silent заглушён');
            }
        });

        // Ищем network$N в window (минифицированный бандл Lampa)
        try {
            Object.keys(window).forEach(function (key) {
                if (/^network/.test(key)) {
                    var obj = window[key];
                    if (obj && typeof obj.silent === 'function') {
                        obj.silent = function (url, ok) {
                            log('network.silent (' + key + ') → ' + url);
                            if (typeof ok === 'function') ok([]);
                        };
                        log('Заглушён: ' + key + '.silent');
                    }
                }
            });
        } catch (e) {}
    }

    // =========================================================
    //  4. Пустышка VideoBlock
    //     Заменяем внутренний класс рекламного блока на заглушку
    // =========================================================
    function patchVideoBlock() {
        function VideoBlockStub() {}
        VideoBlockStub.prototype.start   = function () { log('VideoBlock.start заблокирован'); };
        VideoBlockStub.prototype.load    = function () {};
        VideoBlockStub.prototype.create  = function () {};
        VideoBlockStub.prototype.stop    = function () {};
        VideoBlockStub.prototype.destroy = function () {};

        if (window.VideoBlock)                       window.VideoBlock = VideoBlockStub;
        if (window.Lampa && window.Lampa.VideoBlock) window.Lampa.VideoBlock = VideoBlockStub;

        // Ищем по сигнатуре в window
        try {
            Object.keys(window).forEach(function (key) {
                var obj = window[key];
                if (
                    obj && typeof obj === 'function' && obj.prototype &&
                    typeof obj.prototype.start  === 'function' &&
                    typeof obj.prototype.load   === 'function' &&
                    typeof obj.prototype.create === 'function'
                ) {
                    window[key] = VideoBlockStub;
                    log('VideoBlock заменён: ' + key);
                }
            });
        } catch (e) {}
    }

    // =========================================================
    //  5. Перехват Storage — говорим что реклама отключена
    // =========================================================
    function patchStorage() {
        if (!window.Lampa || !window.Lampa.Storage) return;

        var AD_KEYS = ['adv', 'advert', 'ad_enable', 'show_ad', 'preroll', 'ad_url'];
        var orig = window.Lampa.Storage.get;

        window.Lampa.Storage.get = function (key, def) {
            if (AD_KEYS.indexOf(key) !== -1) {
                log('Storage.get заблокирован: ' + key);
                return false;
            }
            return orig.apply(this, arguments);
        };

        log('Lampa.Storage.get перехвачен');
    }

    // =========================================================
    //  6. Перехват fetch / XHR
    // =========================================================
    var AD_URL_KEYWORDS = [
        '/preroll', '/advert', '/banner', '/adv',
        'adriver.ru', 'doubleclick.net',
        'googlesyndication.com', 'begun.ru', 'smi2',
    ];

    function isAdUrl(url) {
        if (!url) return false;
        var s = String(url).toLowerCase();
        return AD_URL_KEYWORDS.some(function (kw) { return s.indexOf(kw) !== -1; });
    }

    function patchFetch() {
        if (!window.fetch) return;
        var orig = window.fetch;
        window.fetch = function (input) {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            if (isAdUrl(url)) {
                log('fetch заблокирован → ' + url);
                return Promise.resolve(new Response('[]', { status: 200 }));
            }
            return orig.apply(this, arguments);
        };
        log('fetch перехвачен');
    }

    function patchXHR() {
        var orig = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
            if (isAdUrl(url)) {
                log('XHR заблокирован → ' + url);
                arguments[1] = 'about:blank';
            }
            return orig.apply(this, arguments);
        };
        log('XHR перехвачен');
    }

    // =========================================================
    //  7. Чистим рекламные таймеры (из второго найденного плагина)
    //     Запускаем ОДИН РАЗ — не в интервале, чтобы не сломать
    //     нормальные таймеры плеера
    // =========================================================
    function clearAdTimers() {
        log('Очистка рекламных таймеров...');
        var highest = setTimeout(function () {}, 0);
        // Чистим только "старые" таймеры, оставляем свежие (плеер ещё не запустился)
        for (var i = 1; i < highest - 10; i++) {
            clearTimeout(i);
        }
    }

    // =========================================================
    //  Инициализация
    // =========================================================
    function init() {
        log('Запуск v' + PLUGIN.version);

        // Запускаем сразу — до любых проверок Lampa
        patchAccount();
        patchCreateElement();
        patchFetch();
        patchXHR();

        // После загрузки Lampa
        patchNetwork();
        patchVideoBlock();
        patchStorage();

        log('Все блокировщики активны ✓');
    }

    // =========================================================
    //  Точка входа
    // =========================================================

    // Самые ранние патчи — сразу, не ждём Lampa
    patchAccount();
    patchCreateElement();
    patchFetch();
    patchXHR();

    // Остальное — когда Lampa готова
    if (window.Lampa && window.Lampa.Listener) {
        window.Lampa.Listener.follow('ready', function () {
            patchNetwork();
            patchVideoBlock();
            patchStorage();
            log('Lampa-патчи применены ✓');
        });
    } else {
        var attempts = 0;
        var wait = setInterval(function () {
            attempts++;
            if (window.Lampa && window.Lampa.Listener) {
                clearInterval(wait);
                window.Lampa.Listener.follow('ready', function () {
                    patchNetwork();
                    patchVideoBlock();
                    patchStorage();
                    log('Lampa-патчи применены ✓');
                });
            } else if (attempts >= 30) {
                clearInterval(wait);
                patchNetwork();
                patchVideoBlock();
                patchStorage();
            }
        }, 100);
    }

    if (window.plugin_manager) {
        window.plugin_manager.add(PLUGIN);
    }

    log('Ранние патчи применены ✓');

})();
