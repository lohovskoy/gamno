(function() {
    'use strict';

    const PLUGIN = {
        id: 'stable_adblock',
        name: 'Stable AdBlock',
        version: '2.0.0',
        description: 'Безопасный блокировщик рекламы без агрессивных мутаций'
    };

    // ============================================================
    // КОНФИГУРАЦИЯ (правится без переписывания логики)
    // ============================================================
    const CONFIG = {
        // Паттерны URL, которые считаем рекламными
        adUrlPatterns: [
            /\/advert/i,
            /\/preroll/i,
            /\/vast/i,
            /\/vmap/i,
            /\/ad-manager/i,
            /\/ads\?/i,
            /doubleclick/i,
            /adriver/i,
            /banner/i,
            /\/ad\./i,
            /\/ad-/i
        ],
        // DOM-селекторы, которые безопасно удалить
        safeDomSelectors: [
            '[class*="preroll"]',
            '[class*="advert"]',
            '[id*="preroll"]',
            '[id*="advert"]',
            'div[data-ad]',
            '.ad-container'
        ],
        // Интервал очистки DOM (мс)
        domCleanInterval: 2000,
        // Включать ли fetch-патч
        blockFetchAds: true,
        // Включать ли DOM-очистку
        cleanDom: true
    };

    // ============================================================
    // СОСТОЯНИЕ
    // ============================================================
    let originalFetch = null;
    let domCleanerId = null;
    let isActive = false;

    // ============================================================
    // БЕЗОПАСНЫЙ FAKE RESPONSE (контракт соблюден)
    // ============================================================
    function createSafeEmptyResponse(url) {
        const body = JSON.stringify({ ads: [], preroll: null, vast: '' });
        const blob = new Blob([body], { type: 'application/json' });
        
        return new Response(blob, {
            status: 200,
            statusText: 'OK',
            headers: {
                'Content-Type': 'application/json',
                'X-AdBlocked': 'true',
                'Content-Length': blob.size.toString()
            }
        });
    }

    // ============================================================
    // FETCH PATCH (точечный, без цепочечного перехвата)
    // ============================================================
    function isAdRequest(url) {
        if (!url || typeof url !== 'string') return false;
        return CONFIG.adUrlPatterns.some(pattern => pattern.test(url));
    }

    function patchedFetch(input, init) {
        const url = typeof input === 'string' 
            ? input 
            : (input?.url || '');

        if (isAdRequest(url)) {
            console.log(`[${PLUGIN.name}] blocked fetch:`, url.substring(0, 80));
            return Promise.resolve(createSafeEmptyResponse(url));
        }

        // Пробрасываем в оригинальный fetch
        return originalFetch.call(window, input, init);
    }

    function installFetchPatch() {
        if (!CONFIG.blockFetchAds) return;
        if (originalFetch) return; // уже установлен
        
        originalFetch = window.fetch;
        window.fetch = patchedFetch;
        console.log(`[${PLUGIN.name}] fetch patch installed`);
    }

    function uninstallFetchPatch() {
        if (originalFetch) {
            window.fetch = originalFetch;
            originalFetch = null;
            console.log(`[${PLUGIN.name}] fetch patch removed`);
        }
    }

    // ============================================================
    // DOM OBSERVER (без mutation, только safe remove)
    // ============================================================
    function cleanAdElements() {
        if (!CONFIG.cleanDom) return;
        
        let removed = 0;
        CONFIG.safeDomSelectors.forEach(selector => {
            try {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    // Проверяем, что элемент не содержит видео-контент
                    const hasVideo = el.querySelector('video');
                    const isPlayerContainer = el.classList?.contains('player') || 
                                              el.id?.includes('player');
                    
                    if (!hasVideo && !isPlayerContainer) {
                        el.remove();
                        removed++;
                    }
                });
            } catch (e) {
                // Селектор невалидный — пропускаем
            }
        });
        
        if (removed > 0) {
            console.log(`[${PLUGIN.name}] DOM cleaned: ${removed} elements`);
        }
    }

    function startDomCleaner() {
        if (domCleanerId) return;
        cleanAdElements(); // первый прогон сразу
        domCleanerId = setInterval(cleanAdElements, CONFIG.domCleanInterval);
    }

    function stopDomCleaner() {
        if (domCleanerId) {
            clearInterval(domCleanerId);
            domCleanerId = null;
        }
    }

    // ============================================================
    // PLAYER STATE OBSERVER (read-only, без мутаций)
    // ============================================================
    function setupPlayerObserver() {
        // Ждем появления плеера и наблюдаем за его состоянием
        // НЕ мутируем — только форсируем skip если видим ad state
        const checkInterval = setInterval(() => {
            if (!isActive) {
                clearInterval(checkInterval);
                return;
            }

            try {
                const player = window.Player || window.player || window.videoPlayer;
                if (!player) return;

                // Если плеер в состоянии рекламы — пробуем пропустить
                if (typeof player.skipAd === 'function' && player.isInAd?.()) {
                    player.skipAd();
                    console.log(`[${PLUGIN.name}] ad skipped via player API`);
                }

                // Если есть видео-элемент с src содержащим ad
                const video = document.querySelector('video');
                if (video && video.src && isAdRequest(video.src)) {
                    video.src = '';
                    video.load();
                }
            } catch (e) {
                // Игнорируем ошибки доступа к плееру
            }
        }, 1000);

        return checkInterval;
    }

    // ============================================================
    // УПРАВЛЕНИЕ ПЛАГИНОМ
    // ============================================================
    function enable() {
        if (isActive) return;
        isActive = true;

        installFetchPatch();
        startDomCleaner();
        const observerInterval = setupPlayerObserver();

        // Сохраняем ссылку на observer для cleanup
        PLUGIN._observerInterval = observerInterval;

        console.log(`[${PLUGIN.name}] enabled v${PLUGIN.version}`);
    }

    function disable() {
        if (!isActive) return;
        isActive = false;

        uninstallFetchPatch();
        stopDomCleaner();
        
        if (PLUGIN._observerInterval) {
            clearInterval(PLUGIN._observerInterval);
            PLUGIN._observerInterval = null;
        }

        console.log(`[${PLUGIN.name}] disabled`);
    }

    function toggle() {
        isActive ? disable() : enable();
    }

    // ============================================================
    // РЕГИСТРАЦИЯ В LAMPA
    // ============================================================
    function register() {
        if (window.Lampa) {
            // Регистрируем в системе плагинов Lampa
            if (window.plugin_manager) {
                window.plugin_manager.add({
                    ...PLUGIN,
                    enable,
                    disable,
                    toggle
                });
            }

            // Автостарт при загрузке Lampa
            if (window.Lampa.Listener) {
                window.Lampa.Listener.follow('loaded', () => {
                    enable();
                });
            } else {
                // Lampa еще не инициализирована — стартуем сразу
                enable();
            }
        } else {
            // Lampa может загрузиться позже
            window.addEventListener('DOMContentLoaded', enable);
        }
    }

    // ============================================================
    // ПУБЛИЧНОЕ API (для дебага)
    // ============================================================
    window.StableAdBlock = {
        enable,
        disable,
        toggle,
        isActive: () => isActive,
        config: CONFIG,
        plugin: PLUGIN
    };

    // Старт
    register();
})();
