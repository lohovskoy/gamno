(function () {
    'use strict';

    var PLUGIN = {
        name: 'Lampa AdBlock Pro',
        tag: 'lampa_adblock_pro',
        version: '4.1.0',
        description: 'Hard patch AdManager / preroll pipeline',
        enabled: true
    };

    var isPatched = false;
    var originalFetch = null;
    var playerHooks = [];

    function log(msg) {
        console.log('[AdBlockPro] ' + msg);
    }

    // =========================
    // УТИЛИТЫ
    // =========================
    function createEmptyResponse() {
        var body = JSON.stringify({ preroll: [], midroll: [], postroll: [] });
        
        try {
            return new Response(body, {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (e) {
            // Fallback для старых окружений
            return {
                ok: true,
                status: 200,
                json: function () { return Promise.resolve({ preroll: [] }); },
                text: function () { return Promise.resolve(''); }
            };
        }
    }

    function shouldBlockUrl(url) {
        if (typeof url !== 'string' || !url) return false;
        
        // Конкретные домены рекламных сервисов
        var blockedDomains = [
            'cub.rip',
            'adsrv.me',
            'doubleclick.net',
            'googlesyndication.com',
            'adservice.google.com'
        ];
        
        // Конкретные паттерны запросов
        var blockedPatterns = [
            '/preroll.json',
            '/ads.json',
            '/vmap.xml',
            '/vast.xml'
        ];
        
        // Проверяем домены
        for (var i = 0; i < blockedDomains.length; i++) {
            if (url.indexOf(blockedDomains[i]) !== -1) return true;
        }
        
        // Проверяем паттерны
        for (var j = 0; j < blockedPatterns.length; j++) {
            if (url.indexOf(blockedPatterns[j]) !== -1) return true;
        }
        
        return false;
    }

    // =========================
    // 1. ПРЯМОЙ ХУК AD MANAGER
    // =========================
    function killAdMethods(obj, name) {
        if (!obj) return false;
        
        var patched = false;
        
        ['load', 'request', 'get', 'init', 'start'].forEach(function (m) {
            if (typeof obj[m] === 'function') {
                var original = obj[m];
                obj[m] = function () {
                    log(name + '.' + m + ' → blocked');
                    return Promise.resolve([]);
                };
                // Сохраняем для возможного восстановления
                obj['_' + m + '_original'] = original;
                patched = true;
            }
        });
        
        // Очищаем массивы рекламы
        try {
            if (obj.preroll !== undefined) obj.preroll = [];
            if (obj.midroll !== undefined) obj.midroll = [];
            if (obj.postroll !== undefined) obj.postroll = [];
            patched = true;
        } catch (e) {}
        
        return patched;
    }

    function patchAdManager() {
        var patched = [];
        
        // Прямые неймспейсы
        var targets = [
            { obj: window.AdManager, name: 'AdManager' },
            { obj: window.Lampa && window.Lampa.AdManager, name: 'Lampa.AdManager' }
        ];
        
        targets.forEach(function (target) {
            if (killAdMethods(target.obj, target.name)) {
                patched.push(target.name);
            }
        });
        
        // Эвристический поиск по window
        Object.keys(window).forEach(function (k) {
            try {
                var o = window[k];
                if (!o || typeof o !== 'object' || k === 'location') return;
                
                var hasAdProps = (o.preroll || o.midroll || o.postroll);
                var hasAdMethods = typeof o.load === 'function' || typeof o.request === 'function';
                var nameMatches = k.toLowerCase().indexOf('ad') !== -1 || 
                                 k.toLowerCase().indexOf('preroll') !== -1;
                
                if (hasAdProps || (hasAdMethods && nameMatches)) {
                    if (killAdMethods(o, k)) {
                        patched.push(k);
                    }
                }
            } catch (e) {}
        });
        
        if (patched.length > 0) {
            log('Patched ad objects: ' + patched.join(', '));
        } else {
            log('No ad objects found to patch');
        }
        
        return patched;
    }

    // =========================
    // 2. ПЕРЕХВАТ FETCH
    // =========================
    function patchFetch() {
        if (originalFetch) {
            log('Fetch already patched');
            return;
        }
        
        if (typeof window.fetch !== 'function') {
            log('window.fetch not available');
            return;
        }
        
        originalFetch = window.fetch;
        
        window.fetch = function (input, init) {
            var url = (typeof input === 'string') ? input : (input && input.url) || '';
            
            if (PLUGIN.enabled && shouldBlockUrl(url)) {
                log('fetch blocked → ' + url.substring(0, 80));
                return Promise.resolve(createEmptyResponse());
            }
            
            return originalFetch.apply(this, arguments);
        };
        
        log('Fetch patched');
    }

    // =========================
    // 3. ПЕРЕХВАТ PLAYER
    // =========================
    function patchPlayer() {
        if (!window.Player) return [];
        
        var methods = ['load', 'play', 'startPlayback', 'initPlayer', 'start'];
        var patched = [];
        
        methods.forEach(function (method) {
            if (typeof window.Player[method] === 'function') {
                var orig = window.Player[method];
                
                window.Player[method] = function () {
                    log('Player.' + method + ' intercepted');
                    
                    try {
                        // Очищаем рекламные массивы плеера
                        if (window.Player.preroll !== undefined) {
                            window.Player.preroll = [];
                        }
                        if (window.Player.midroll !== undefined) {
                            window.Player.midroll = [];
                        }
                        if (window.Player.postroll !== undefined) {
                            window.Player.postroll = [];
                        }
                        
                        // Очищаем ad-свойства
                        Object.keys(window.Player).forEach(function (key) {
                            if (key.toLowerCase().indexOf('ad') !== -1 && 
                                typeof window.Player[key] === 'object' &&
                                window.Player[key] !== null) {
                                window.Player[key] = [];
                            }
                        });
                    } catch (e) {
                        log('Error cleaning player: ' + e.message);
                    }
                    
                    return orig.apply(this, arguments);
                };
                
                // Сохраняем хук для восстановления
                playerHooks.push({
                    method: method,
                    original: orig
                });
                
                patched.push(method);
            }
        });
        
        if (patched.length > 0) {
            log('Player methods patched: ' + patched.join(', '));
        }
        
        return patched;
    }

    // =========================
    // ВОССТАНОВЛЕНИЕ
    // =========================
    function restoreFetch() {
        if (originalFetch) {
            window.fetch = originalFetch;
            originalFetch = null;
            log('Fetch restored');
        }
    }

    function restorePlayer() {
        if (!window.Player) return;
        
        playerHooks.forEach(function (hook) {
            window.Player[hook.method] = hook.original;
        });
        
        playerHooks = [];
        log('Player restored');
    }

    // =========================
    // УПРАВЛЕНИЕ ПЛАГИНОМ
    // =========================
    PLUGIN.disable = function () {
        this.enabled = false;
        restoreFetch();
        restorePlayer();
        log('Plugin disabled');
    };

    PLUGIN.enable = function () {
        this.enabled = true;
        patchFetch();
        
        if (window.Lampa && window.Lampa.Listener) {
            window.Lampa.Listener.follow('ready', function () {
                patchAdManager();
                patchPlayer();
            });
        } else {
            setTimeout(function () {
                patchAdManager();
                patchPlayer();
            }, 2000);
        }
        
        log('Plugin enabled');
    };

    PLUGIN.toggle = function () {
        if (this.enabled) {
            this.disable();
        } else {
            this.enable();
        }
    };

    // =========================
    // INIT
    // =========================
    function init() {
        if (isPatched) {
            log('Already initialized');
            return;
        }
        
        log('init v' + PLUGIN.version);
        isPatched = true;
        
        PLUGIN.enable();
    }

    // Запускаем
    init();

    // Регистрируем в менеджере плагинов
    if (window.plugin_manager) {
        window.plugin_manager.add(PLUGIN);
    }

})();
