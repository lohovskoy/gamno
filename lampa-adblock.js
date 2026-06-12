(function () {
    'use strict';

    // =========================================================
    //  Конфигурация плагина
    // =========================================================
    var PLUGIN = {
        name:        'Lampa AdBlock',
        tag:         'lampa_adblock',
        version:     '2.0.0',
        description: 'Блокировка рекламы перед и во время просмотра',
    };

    // CSS-селекторы рекламных элементов
    var AD_SELECTORS = [
        '.ad-preloader',
        '.ad-container',
        '.ad-overlay',
        '.ad-wrapper',
        '.advert',
        '.advert-block',
        '.banner_300x250',
        '.banner-block',
        '.js-preroll',
        '.player-preroll',
        '.preroll-block',
        '.preroll-container',
        '[id*="adv_kod"]',
        '[id*="banner_video"]',
        '[id*="ad_block"]',
        '[class*="adv-block"]',
        '[class*="ad-unit"]',
        'iframe[src*="adv"]',
        'iframe[src*="advert"]',
        'iframe[src*="banner"]',
        'video[src*="advert"]',
    ];

    // Ключевые слова для блокировки URL скриптов/iframe
    var AD_URL_KEYWORDS = [
        'adriver',
        'adtech',
        'advert',
        'adx.',
        'banner',
        'doubleclick',
        'googlesyndication',
        'preroll',
        'smi2',
        'begun.ru',
        'recreativ',
    ];

    // Ключевые слова для блокировки XHR/fetch рекламных запросов
    var AD_REQUEST_KEYWORDS = [
        '/preroll',
        '/advert',
        '/banner',
        'adriver.ru',
        'doubleclick.net',
        'googlesyndication.com',
    ];

    // =========================================================
    //  Утилиты
    // =========================================================
    function log(msg, data) {
        if (data !== undefined) {
            console.log('[AdBlock] ' + msg, data);
        } else {
            console.log('[AdBlock] ' + msg);
        }
    }

    function containsKeyword(str, keywords) {
        if (!str) return false;
        var lower = str.toLowerCase();
        return keywords.some(function (kw) { return lower.indexOf(kw) !== -1; });
    }

    // =========================================================
    //  1. Удаление рекламных DOM-элементов
    // =========================================================
    var domInterval = null;

    function removeAdElements() {
        AD_SELECTORS.forEach(function (selector) {
            try {
                document.querySelectorAll(selector).forEach(function (el) {
                    log('Удалён элемент → ' + selector);
                    el.remove();
                });
            } catch (e) { /* невалидный селектор — пропускаем */ }
        });
    }

    function startDomWatcher() {
        if (domInterval) return;
        domInterval = setInterval(removeAdElements, 500);
        log('DOM-вотчер запущен (500 мс)');
    }

    function stopDomWatcher() {
        if (domInterval) {
            clearInterval(domInterval);
            domInterval = null;
            log('DOM-вотчер остановлен');
        }
    }

    // =========================================================
    //  2. MutationObserver — перехват скриптов до выполнения
    // =========================================================
    var mutationObserver = null;

    function startMutationObserver() {
        if (mutationObserver) return;

        mutationObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                m.addedNodes.forEach(function (node) {
                    if (!node.tagName) return;

                    var tag = node.tagName.toUpperCase();
                    var src = node.src || node.href || '';

                    // Блокируем рекламные скрипты ДО их выполнения
                    if (tag === 'SCRIPT' && containsKeyword(src, AD_URL_KEYWORDS)) {
                        node.remove();
                        log('Заблокирован скрипт → ' + src);
                        return;
                    }

                    // Блокируем рекламные iframe
                    if (tag === 'IFRAME' && containsKeyword(src, AD_URL_KEYWORDS)) {
                        node.remove();
                        log('Заблокирован iframe → ' + src);
                        return;
                    }

                    // Удаляем рекламные элементы по классам/атрибутам
                    AD_SELECTORS.forEach(function (selector) {
                        try {
                            if (node.matches && node.matches(selector)) {
                                node.remove();
                                log('Заблокирован новый элемент → ' + selector);
                            }
                        } catch (e) {}
                    });
                });
            });
        });

        mutationObserver.observe(document.documentElement, {
            childList: true,
            subtree:   true,
        });

        log('MutationObserver запущен');
    }

    function stopMutationObserver() {
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
            log('MutationObserver остановлен');
        }
    }

    // =========================================================
    //  3. Перехват XMLHttpRequest — блокировка рекламных запросов
    // =========================================================
    var originalXhrOpen = XMLHttpRequest.prototype.open;

    function patchXHR() {
        XMLHttpRequest.prototype.open = function (method, url) {
            if (containsKeyword(url, AD_REQUEST_KEYWORDS)) {
                log('Заблокирован XHR → ' + url);
                // Подменяем URL на пустышку, чтобы не ломать код плеера
                arguments[1] = 'about:blank';
            }
            return originalXhrOpen.apply(this, arguments);
        };
        log('XHR-перехватчик установлен');
    }

    function restoreXHR() {
        XMLHttpRequest.prototype.open = originalXhrOpen;
        log('XHR-перехватчик снят');
    }

    // =========================================================
    //  4. Перехват fetch — блокировка рекламных запросов
    // =========================================================
    var originalFetch = window.fetch;

    function patchFetch() {
        if (!window.fetch) return;

        window.fetch = function (input, init) {
            var url = (typeof input === 'string') ? input : (input && input.url) || '';
            if (containsKeyword(url, AD_REQUEST_KEYWORDS)) {
                log('Заблокирован fetch → ' + url);
                // Возвращаем пустой ответ вместо ошибки
                return Promise.resolve(new Response('', { status: 200 }));
            }
            return originalFetch.apply(this, arguments);
        };
        log('Fetch-перехватчик установлен');
    }

    function restoreFetch() {
        if (originalFetch) {
            window.fetch = originalFetch;
            log('Fetch-перехватчик снят');
        }
    }

    // =========================================================
    //  5. Автоматический пропуск рекламы в видеоплеере
    //     (кнопка "Пропустить рекламу" и принудительный skip)
    // =========================================================
    var skipInterval = null;

    var SKIP_SELECTORS = [
        '.skip-button',
        '.skip-ad',
        '.skip_button',
        '[class*="skip"]',
        '[id*="skip"]',
    ];

    function trySkipAd() {
        SKIP_SELECTORS.forEach(function (selector) {
            try {
                var btn = document.querySelector(selector);
                if (btn) {
                    btn.click();
                    log('Нажата кнопка пропуска рекламы → ' + selector);
                }
            } catch (e) {}
        });

        // Если в DOM есть рекламное видео — перематываем его в конец
        AD_SELECTORS.forEach(function (selector) {
            try {
                var adVideo = document.querySelector(selector + ' video, ' + selector);
                if (adVideo && adVideo.tagName === 'VIDEO' && adVideo.duration) {
                    adVideo.currentTime = adVideo.duration;
                    log('Промотано рекламное видео');
                }
            } catch (e) {}
        });
    }

    function startSkipWatcher() {
        if (skipInterval) return;
        skipInterval = setInterval(trySkipAd, 300);
        log('Skip-вотчер запущен (300 мс)');
    }

    function stopSkipWatcher() {
        if (skipInterval) {
            clearInterval(skipInterval);
            skipInterval = null;
            log('Skip-вотчер остановлен');
        }
    }

    // =========================================================
    //  6. Интеграция с событиями Lampa
    //     Запускаем агрессивные блокировки только во время просмотра
    // =========================================================
    function onVideoStart() {
        log('Начало воспроизведения — активируем блокировщики');
        startDomWatcher();
        startSkipWatcher();
    }

    function onVideoStop() {
        log('Конец воспроизведения — деактивируем блокировщики');
        stopDomWatcher();
        stopSkipWatcher();
    }

    function bindLampaEvents() {
        if (!window.Lampa || !window.Lampa.Listener) return;

        // Запускаем тяжёлые вотчеры только на экране плеера
        window.Lampa.Listener.follow('player:start',  onVideoStart);
        window.Lampa.Listener.follow('player:end',    onVideoStop);
        window.Lampa.Listener.follow('player:destroy', onVideoStop);

        log('Обработчики событий Lampa привязаны');
    }

    // =========================================================
    //  Инициализация
    // =========================================================
    function init() {
        log('Инициализация v' + PLUGIN.version);

        // Постоянные перехватчики сети — работают всегда
        patchXHR();
        patchFetch();

        // MutationObserver — всегда, чтобы скрипты не успели выполниться
        startMutationObserver();

        // Интеграция с Lampa
        bindLampaEvents();

        log('Готов к работе');
    }

    // =========================================================
    //  Точка входа — ждём Lampa
    // =========================================================
    function bootstrap() {
        if (window.Lampa && window.Lampa.Listener) {
            window.Lampa.Listener.follow('ready', init);
        } else if (window.Lampa) {
            // Lampa есть, но Listener ещё не создан — ждём немного
            var attempts = 0;
            var waitForListener = setInterval(function () {
                attempts++;
                if (window.Lampa.Listener) {
                    clearInterval(waitForListener);
                    window.Lampa.Listener.follow('ready', init);
                } else if (attempts >= 20) {
                    // 2 секунды прошло — запускаем без событий
                    clearInterval(waitForListener);
                    init();
                }
            }, 100);
        } else {
            // Lampa ещё не загружена
            window.addEventListener('load', init);
        }
    }

    // Регистрация плагина в менеджере Lampa
    if (window.plugin_manager) {
        window.plugin_manager.add(PLUGIN);
    }

    bootstrap();

})();
