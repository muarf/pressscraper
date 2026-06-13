(function(global) {
    'use strict';

    let bpcSites = null;
    let bpcScript = null;
    let bpcScriptFr = null;

    function evalSitesInWorker(sitesData) {
        return new Promise((resolve, reject) => {
            const worker = new Worker('js/bpc-worker.js');
            worker.onmessage = function(e) {
                worker.terminate();
                if (e.data.success) resolve(e.data.sites);
                else reject(new Error('[BPC] Worker evaluation failed: ' + e.data.error));
            };
            worker.onerror = function(err) {
                worker.terminate();
                reject(new Error('[BPC] Worker error: ' + err.message));
            };
            worker.postMessage({ sitesData });
        });
    }

    async function init() {
        try {
            console.log('[BPC] Initializing rules...');
            let sitesData = localStorage.getItem('bpc_sites_js');
            if (!sitesData) {
                console.warn('[BPC] Aucune règle BPC en cache.');
                return;
            }
            bpcSites = await evalSitesInWorker(sitesData);
            console.log('[BPC] Sites loaded. Domains count:', Object.keys(bpcSites).length);
            bpcScript = localStorage.getItem('bpc_script_js');
            if (!bpcScript) { console.warn('[BPC] contentScript.js manquant'); return; }
            bpcScriptFr = localStorage.getItem('bpc_script_fr_js');
            if (!bpcScriptFr) { console.warn('[BPC] contentScript_fr.js manquant'); return; }
        } catch (e) {
            console.error('[BPC] Init failed:', e);
        }
    }

    init().catch(e => console.error('[BPC] Auto-init failed:', e));

    function findSiteConfig(hostname) {
        if (!bpcSites) return null;
        for (const key in bpcSites) {
            const site = bpcSites[key];
            if (!site || (!site.domain && !site.group)) continue;
            if (site.domain && (hostname === site.domain || hostname.endsWith('.' + site.domain))) {
                return { name: key, ...site };
            }
            if (site.group && Array.isArray(site.group)) {
                for (const domain of site.group) {
                    if (hostname === domain || hostname.endsWith('.' + domain)) {
                        return { name: key, ...site, domain };
                    }
                }
            }
        }
        return null;
    }

    const BpcService = {
        id: 'bpc',
        name: 'Plugin de lecture',

        /**
         * Re-initialize BPC rules (called after update).
         */
        reinit: init,

        /**
         * Check if a URL is supported by BPC rules.
         */
        supportsUrl(url) {
            try {
                const hostname = new URL(url).hostname;
                return findSiteConfig(hostname) !== null;
            } catch(e) { return false; }
        },

        /**
         * Bypass paywall and extract article via sandboxed iframe + BPC content scripts.
         */
        async fetchByUrl(url, authHeaders, onProgress) {
            try {
                const urlObj = new URL(url);
                const hostname = urlObj.hostname;
                const siteConfig = findSiteConfig(hostname);
                if (!siteConfig) return null;

                return await runBpcDirectScraping(url, siteConfig, authHeaders, onProgress);
            } catch (e) {
                console.warn('[BPC] Fetch failed:', e);
                return null;
            }
        }
    };

    async function getUA() {
        try {
            if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
                const res = await window.Capacitor.Plugins.BnfLogin.getWebViewUserAgent();
                if (res && res.userAgent) return res.userAgent;
            }
        } catch (e) {}
        return 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
    }

    async function runBpcDirectScraping(articleUrl, siteConfig, authHeaders, onProgress) {
        const BnfLogin = window.Capacitor.Plugins.BnfLogin;
        const defaultUA = authHeaders?.['User-Agent'] || await getUA();

        let customUA = defaultUA;
        if (siteConfig.useragent === 'googlebot') {
            customUA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
        } else if (siteConfig.useragent === 'bingbot') {
            customUA = 'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)';
        } else if (siteConfig.useragent === 'facebookbot') {
            customUA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_voiced.html)';
        } else if (siteConfig.useragent_custom) {
            customUA = siteConfig.useragent_custom;
        }

        const headers = { 'User-Agent': customUA, 'Referer': 'https://www.google.com/' };

        onProgress('Plugin', 'Téléchargement de la page...', 20);

        let pageRes = null;
        let useFallback = false;

        if (BnfLogin) {
            try {
                console.log('[BPC] Attempting direct HTTP fetch...');
                pageRes = await BnfLogin.httpRequest({ url: articleUrl, method: 'GET', headers });
                if (!pageRes || (pageRes.status !== 200 && pageRes.status !== 304)) {
                    console.log('[BPC] Direct fetch failed or returned non-200 status:', pageRes?.status);
                    useFallback = true;
                }
            } catch (err) {
                console.warn('[BPC] Direct fetch error:', err);
                useFallback = true;
            }

            if (useFallback && typeof BnfLogin.fetchHtmlViaWebView === 'function') {
                console.log('[BPC] Falling back to WebView-based fetch...');
                onProgress('Plugin', 'Contournement protection (WebView)...', 30);
                try {
                    pageRes = await BnfLogin.fetchHtmlViaWebView({ url: articleUrl, userAgent: customUA });
                } catch (fallbackErr) {
                    console.error('[BPC] WebView fetch failed:', fallbackErr);
                }
            }
        } else {
            const r = await fetch(articleUrl, { headers });
            pageRes = { status: r.status, data: await r.text() };
        }

        if (!pageRes || (pageRes.status !== 200 && pageRes.status !== 304) || !pageRes.data) {
            throw new Error(`HTTP error ${pageRes?.status || 'unknown'}${pageRes?.error ? ' : ' + pageRes.error : ''}`);
        }

        onProgress('Plugin', 'Extraction du contenu...', 40);

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
        const iframeWindow = iframe.contentWindow;
        const iframeDocument = iframe.contentDocument;

        let sanitizedHtml = pageRes.data.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, content) => {
            if (attrs.includes('application/ld+json') || attrs.includes('application/json')) return match;
            return `<script type="disabled-javascript" ${attrs.replace(/\bsrc=/gi, 'data-src=')}>/* disabled */</script>`;
        });

        iframeDocument.open();
        iframeDocument.write(sanitizedHtml);
        iframeDocument.close();

        const urlObj = new URL(articleUrl);
        const articleDomain = urlObj.hostname;
        const articlePathname = urlObj.pathname;
        const articleOrigin = urlObj.origin;

        const locationProxy = new Proxy(iframeWindow.location, {
            get(target, prop) {
                if (prop === 'hostname') return articleDomain;
                if (prop === 'href') return articleUrl;
                if (prop === 'pathname') return articlePathname;
                if (prop === 'origin') return articleOrigin;
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            }
        });

        const documentProxy = new Proxy(iframeDocument, {
            get(target, prop) {
                if (prop === 'location') return locationProxy;
                if (prop === 'referrer') return 'https://www.google.com/';
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            }
        });

        const windowProxy = new Proxy(iframeWindow, {
            get(target, prop) {
                if (prop === 'location') return locationProxy;
                if (prop === 'document') return documentProxy;
                if (prop === 'window' || prop === 'self' || prop === 'globalThis') return windowProxy;
                const val = target[prop];
                return typeof val === 'function' ? val.bind(target) : val;
            }
        });

        iframeWindow.__windowProxy__ = windowProxy;
        iframeWindow.__documentProxy__ = documentProxy;
        iframeWindow.__locationProxy__ = locationProxy;

        iframeWindow.chrome = {
            runtime: {
                sendMessage: () => {},
                getManifest: () => ({ version: '1.0.0' }),
                onMessage: { addListener: () => {} },
                onMessageExternal: { addListener: () => {} }
            }
        };
        iframeWindow.browser = iframeWindow.chrome;
        iframeWindow.ext_api = iframeWindow.chrome;
        iframeWindow.ext_chromium = true;
        iframeWindow.mobile = true;
        iframeWindow.dompurify_loaded = true;
        iframeWindow.dompurify_options = {
            ADD_TAGS: ['amp-img', 'embed', 'iframe', 'list'],
            ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'itemprop', 'layout', 'target']
        };

        iframeWindow.matchDomain = function(domains, hostname = articleDomain) {
            if (typeof domains === 'string') domains = [domains];
            return domains.find(d => hostname === d || hostname.endsWith('.' + d)) || false;
        };
        iframeWindow.removeDOMElement = function(...elements) { for (let el of elements) if (el) el.remove(); };
        iframeWindow.hideDOMElement = function(...elements) {
            for (let el of elements) if (el) el.style = 'display:none !important;';
        };
        iframeWindow.hideDOMStyle = function(selector, id = 1) {
            let style = iframeDocument.querySelector('head > style#ext' + id);
            if (!style && iframeDocument.head) {
                let sheet = iframeDocument.createElement('style');
                sheet.id = 'ext' + id;
                sheet.innerText = selector + ' {display: none !important;}';
                iframeDocument.head.appendChild(sheet);
            }
        };
        iframeWindow.addStyle = function(css, id = 1) {
            let style = iframeDocument.querySelector('head > style#add' + id);
            if (!style && iframeDocument.head) {
                let sheet = iframeDocument.createElement('style');
                sheet.id = 'add' + id;
                sheet.innerText = css;
                iframeDocument.head.appendChild(sheet);
            }
        };
        iframeWindow.matchKeyJson = function(key, keys) {
            let match = false;
            if (typeof keys === 'string') match = (key === keys);
            else if (Array.isArray(keys)) match = keys.includes(key);
            else if (keys instanceof RegExp) match = keys.test(key);
            return match;
        };
        iframeWindow.findKeyJson = function(json, keys, min_val_len = 0) {
            let source = '';
            if (Array.isArray(json)) {
                for (let elem of json) source = source || iframeWindow.findKeyJson(elem, keys, min_val_len);
            } else if (typeof json === 'object') {
                for (let elem in json) {
                    let json_elem = json[elem];
                    if (typeof json_elem === 'string' && iframeWindow.matchKeyJson(elem, keys)) {
                        if (json_elem.length > min_val_len) return json_elem;
                    } else if (Array.isArray(json_elem) && json_elem.length > 1 && iframeWindow.matchKeyJson(elem, keys)) {
                        return json_elem;
                    } else {
                        source = source || iframeWindow.findKeyJson(json_elem, keys, min_val_len);
                    }
                }
            }
            return source;
        };
        iframeWindow.getNestedKeys = function(obj, key) {
            if (key in obj) return obj[key];
            let keys = key.split('.');
            let value = obj;
            for (let i = 0; i < keys.length; i++) { value = value[keys[i]]; if (value === undefined) break; }
            return value;
        };
        iframeWindow.makeFigure = function(url, caption_text, img_attrib = {}, caption_attrib = {}) {
            let elem = iframeDocument.createElement('figure');
            let img = iframeDocument.createElement('img');
            img.src = url;
            for (let attrib in img_attrib) if (img_attrib[attrib]) img.setAttribute(attrib, img_attrib[attrib]);
            elem.appendChild(img);
            if (caption_text) {
                let caption = iframeDocument.createElement('figcaption');
                for (let attrib in caption_attrib) if (caption_attrib[attrib]) caption.setAttribute(attrib, caption_attrib[attrib]);
                let cap_par = iframeDocument.createElement('p');
                cap_par.innerText = caption_text;
                caption.appendChild(cap_par);
                elem.appendChild(caption);
            }
            return elem;
        };
        iframeWindow.makeLink = function(url, title, style = '') {
            let a_link = iframeDocument.createElement('a');
            a_link.href = url;
            a_link.innerText = title;
            if (style) a_link.style = style;
            return a_link;
        };
        iframeWindow.clearPaywall = function(paywall, paywall_action) {
            if (paywall) {
                if (!paywall_action) iframeWindow.removeDOMElement(...paywall);
                else {
                    for (let elem of paywall) {
                        if (paywall_action.rm_class) elem.classList.remove(paywall_action.rm_class);
                        else if (paywall_action.rm_attrib) elem.removeAttribute(paywall_action.rm_attrib);
                    }
                }
            }
        };
        iframeWindow.randomInt = function(max) { return Math.floor(Math.random() * Math.floor(max)); };
        iframeWindow.parseHtmlEntities = function(encodedString) {
            let parser = new DOMParser();
            let doc = parser.parseFromString('<textarea>' + encodedString + '</textarea>', 'text/html');
            return doc.querySelector('textarea').value;
        };
        iframeWindow.breakText = function(str, headers = false) {
            str = str.replace(/(?:^|[A-Za-z\"\u201c\u201d\)])(\.+|\?|!)(?=[A-Z\u00d6\u0178\u201c\u201d\d][A-Za-z\u00c0-\u00ff\u201c\d]{1,})/gm, "$&\n\n");
            if (headers) str = str.replace(/(([a-z]{2,}|[\"\u201c]))(?=[A-Z](?=[A-Za-z\u00C0-\u00FF]+))/gm, "$&\n\n");
            return str;
        };
        iframeWindow.decode_utf8 = function(str) { return decodeURIComponent(escape(str)); };
        iframeWindow.getArticleJsonScript = function() {
            let scripts = iframeDocument.querySelectorAll('script[type="application/ld+json"]');
            return Array.prototype.find.call(scripts, s => s.text.includes('"articleBody"') || s.text.includes('"articlebody"'));
        };
        iframeWindow.getSourceJsonScript = function(filter, attributes = ':not([src], [type])') {
            let scripts = iframeDocument.querySelectorAll('script' + attributes);
            return Array.prototype.find.call(scripts, s => filter.test(s.text));
        };
        iframeWindow.archiveRandomDomain = function() {
            const domains = ['archive.ph', 'archive.is', 'archive.li', 'archive.today', 'archive.md', 'archive.vn'];
            return domains[Math.floor(Math.random() * domains.length)];
        };
        iframeWindow.archiveLink = function(url, text_fail = 'BPC > Try for full article text:\r\n') {
            let a_link = iframeDocument.createElement('a');
            a_link.href = 'https://' + iframeWindow.archiveRandomDomain() + '/' + url;
            a_link.innerText = text_fail + a_link.href;
            a_link.target = '_blank';
            a_link.style = 'color: red; font-weight: bold;';
            return a_link;
        };
        iframeWindow.archiveLink_renew = function(url, text_fail = 'BPC > Renew if incomplete:\r\n') {
            return iframeWindow.archiveLink(url, text_fail);
        };
        iframeWindow.getSelectorLevel = function(selector) {
            if (selector.replace(/,\s+/g, ',').match(/[>\s]+/) && !selector.includes(':has(>'))
                selector = selector.replace(/,\s+/g, ',').split(',').map(x => x.match(/[>\s]+/) ? x + ', ' + x.split(/[>\s]+/).pop() : x).join(', ');
            return selector;
        };
        iframeWindow.header_nofix = function() {};
        iframeWindow.blockJsReferrer = function() {};
        iframeWindow.refreshCurrentTab = function() {};
        iframeWindow.refreshCurrentTab_bg = function() {};

        iframeWindow.pendingAsyncRequests = 0;
        iframeWindow.data_ext_fetch_id = 0;
        iframeWindow.data_ext_fetch = [];

        iframeWindow.getExtFetch = async function(url, json_key = '', options = {}, callback, data_ext_fetch_id = 0, args = []) {
            iframeWindow.pendingAsyncRequests++;
            try {
                console.log('[BPC BRIDGE] getExtFetch:', url);
                const BnfLogin = window.parent.Capacitor?.Plugins?.BnfLogin || window.Capacitor?.Plugins?.BnfLogin;
                let res;
                const reqHeaders = options.headers || {};
                reqHeaders['User-Agent'] = customUA;
                if (BnfLogin) {
                    res = await BnfLogin.httpRequest({ url, method: options.method || 'GET', headers: reqHeaders, body: options.body || null });
                } else {
                    const r = await fetch(url, { method: options.method || 'GET', headers: reqHeaders, body: options.body || null });
                    res = { status: r.status, data: await r.text() };
                }
                if (res && (res.status === 200 || res.status === 201)) {
                    let responseData = res.data;
                    if (json_key) {
                        try { const parsed = JSON.parse(res.data); responseData = iframeWindow.getNestedKeys(parsed, json_key); }
                        catch (e) { console.warn('[BPC BRIDGE] JSON extract error:', e); }
                    }
                    if (callback) callback(url, responseData, ...args);
                } else {
                    if (callback) callback(url, null, ...args);
                }
            } catch (e) { console.error('[BPC BRIDGE] getExtFetch error:', e); if (callback) callback(url, null, ...args); }
            finally { iframeWindow.pendingAsyncRequests--; }
        };

        iframeWindow.replaceDomElementExt = async function(url, proxy, base64, selector, text_fail = '', selector_source = selector, selector_archive = selector) {
            iframeWindow.pendingAsyncRequests++;
            try {
                console.log('[BPC BRIDGE] replaceDomElementExt:', url);
                const BnfLogin = window.parent.Capacitor?.Plugins?.BnfLogin || window.Capacitor?.Plugins?.BnfLogin;
                let res;
                if (BnfLogin) res = await BnfLogin.httpRequest({ url, method: 'GET', headers: { 'User-Agent': customUA } });
                else { const r = await fetch(url); res = { status: r.status, data: await r.text() }; }
                if (res && res.status === 200 && res.data) {
                    let html = res.data;
                    if (base64) { html = iframeWindow.decode_utf8(atob(html)); selector_source = 'body'; }
                    let sanitizedHtml = html;
                    if (iframeWindow.DOMPurify) sanitizedHtml = iframeWindow.DOMPurify.sanitize(html, iframeWindow.dompurify_options);
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(sanitizedHtml, 'text/html');
                    if (iframeWindow.selector_level) selector_source = iframeWindow.getSelectorLevel(selector_source);
                    const articleNew = doc.querySelector(selector_source);
                    const article = iframeDocument.querySelector(selector);
                    if (articleNew && article) {
                        article.parentNode.replaceChild(articleNew, article);
                        if (typeof iframeWindow.func_post === 'function') iframeWindow.func_post();
                    }
                }
            } catch (e) { console.error('[BPC BRIDGE] replaceDomElementExt error:', e); }
            finally { iframeWindow.pendingAsyncRequests--; }
        };

        iframeWindow.getArchive = function(url, paywall_sel, paywall_action = '', selector, text_fail = '', selector_source = selector, selector_archive = selector) {
            let url_archive = 'https://' + iframeWindow.archiveRandomDomain() + '/' + (url.includes('/#/') ? encodeURIComponent(url.split('?')[0]) : url.split(/[#\?]/)[0]);
            let paywall = iframeDocument.querySelectorAll(paywall_sel);
            if (paywall.length && iframeWindow.dompurify_loaded) {
                iframeWindow.clearPaywall(paywall, paywall_action);
                iframeWindow.csDoneOnce = true;
                iframeWindow.replaceDomElementExt(url_archive, true, false, selector, text_fail, selector_source, selector_archive);
            }
        };

        iframeWindow.fetch = async function(resource, init) {
            iframeWindow.pendingAsyncRequests++;
            try {
                let url = (typeof resource === 'string') ? resource : resource.url;
                console.log('[BPC BRIDGE] fetch override intercepted:', url);
                if (url.startsWith('http') && !url.includes(iframeWindow.location.host)) {
                    const BnfLogin = window.parent.Capacitor?.Plugins?.BnfLogin || window.Capacitor?.Plugins?.BnfLogin;
                    if (BnfLogin) {
                        try {
                            let headers = {};
                            if (init && init.headers) {
                                if (init.headers instanceof Headers) init.headers.forEach((value, key) => { headers[key] = value; });
                                else if (typeof init.headers === 'object') headers = init.headers;
                            }
                            headers['User-Agent'] = customUA;
                            let body = null;
                            if (init && init.body) body = init.body;
                            const res = await BnfLogin.httpRequest({ url, method: (init && init.method) || 'GET', headers, body });
                            return { ok: res.status >= 200 && res.status < 300, status: res.status, statusText: 'OK', text: async () => res.data, json: async () => JSON.parse(res.data) };
                        } catch (e) { console.error('[BPC BRIDGE] Fetch redirect failed:', e); throw e; }
                    }
                }
                return window.parent.fetch(resource, init);
            } finally {
                iframeWindow.pendingAsyncRequests--;
            }
        };

        const dompurifyMock = function(x, y = '') { return x; };
        dompurifyMock.sanitize = (x, y = '') => x;
        dompurifyMock.removed = [];
        iframeWindow.DOMPurify = dompurifyMock;


        const bootstrapScript = iframeDocument.createElement('script');
        bootstrapScript.text = `
            (function(window, self, globalThis, document, location) {
                window.csDone = false;
                window.csDoneOnce = false;
                try {
                    ${bpcScript}
                    ${bpcScriptFr}
                    if (typeof cs_default === "function") {
                        console.log("[BPC BRIDGE] Running cs_default()...");
                        cs_default();
                    } else {
                        console.warn("[BPC BRIDGE] cs_default not found");
                    }
                } catch (e) {
                    console.error("[BPC BRIDGE] Error:", e);
                }
            })(window.__windowProxy__, window.__windowProxy__, window.__windowProxy__, window.__documentProxy__, window.__locationProxy__);
        `;

        // bootstrapScript must be appended FIRST so getExtFetch, DOMPurify, etc. are defined
        iframeDocument.head.appendChild(bootstrapScript);

        // Apply a site-specific mobile override if one is registered in bpc-mobile-overrides.js.
        // On mobile, pages are fetched without a user session, so BPC paywall conditions often
        // don't fire (the paywall DOM elements are absent from anonymous page loads).
        // Overrides bypass this by calling the site's native API directly.
        if (typeof window.BpcMobileOverrides !== 'undefined') {
            const mobileOverrideCode = window.BpcMobileOverrides.getOverrideScript(articleUrl);
            if (mobileOverrideCode) {
                console.log('[BPC] Applying mobile override for:', articleDomain);
                const mobileOverrideScript = iframeDocument.createElement('script');
                mobileOverrideScript.text = mobileOverrideCode;
                iframeDocument.head.appendChild(mobileOverrideScript);
            }
        }


        onProgress('Plugin', 'Récupération du contenu...', 60);

        const startTime = Date.now();
        const checkInterval = 100;
        const maxWaitTime = 8000;

        let contentSelector = '';
        if (articleDomain.includes('lemonde.fr')) contentSelector = '.article__content';
        else if (articleDomain.includes('lefigaro.fr')) contentSelector = 'div[data-component="fig-content-body"]';
        else if (articleDomain.includes('leparisien.fr')) contentSelector = 'section#left';
        else if (articleDomain.includes('liberation.fr')) contentSelector = '.article-body, .article__content';
        else if (articleDomain.includes('lepoint.fr')) contentSelector = '.article-content, .article-body';
        else if (articleDomain.includes('marianne.net')) contentSelector = '.article-body';
        else if (articleDomain.includes('mediapart.fr')) contentSelector = '.content-article';
        else if (articleDomain.includes('la-croix.com')) contentSelector = '.article-body';
        else if (articleDomain.includes('lesoir.be')) contentSelector = '.r-content, article.r-article';
        else if (articleDomain.includes('lamontagne.fr') || articleDomain.includes('lepopulaire.fr') || articleDomain.includes('larep.fr') || articleDomain.includes('le-pays.fr')) contentSelector = 'div#content section > div.flex-col';
        else if (articleDomain.includes('letemps.ch')) contentSelector = 'div#article-body-wrapper';
        else if (articleDomain.includes('courrierinternational.com')) contentSelector = 'div.article-text';

        const paywallSelector = 'div[id*="paywall"], section[class*="paywall"], div[class*="paywall"], #poool-widget, meta[name="premium"][content="true"], div.post-subscribe, div.post__content--faded';

        await new Promise((resolve) => {
            const timer = setInterval(() => {
                const elapsed = Date.now() - startTime;
                let bypassSuccess = false;
                let contentEl = null;
                if (contentSelector) contentEl = iframeDocument.querySelector(contentSelector);
                if (!contentEl) contentEl = iframeDocument.querySelector('article') || iframeDocument.querySelector('[itemprop="articleBody"]') || iframeDocument.querySelector('.article-body') || iframeDocument.querySelector('.article');
                const hasPaywall = iframeDocument.querySelector(paywallSelector);
                const textLength = contentEl ? contentEl.textContent.trim().length : 0;
                
                // Track pending BPC async request count (e.g. getExtFetch from Courrier International)
                const pendingAsync = iframeWindow.pendingAsyncRequests || 0;

                if (articleDomain === 'lemonde.fr') {
                    const hasParagraphs = iframeDocument.querySelectorAll('.article__paragraph').length >= 3;
                    const paywallGone = !iframeDocument.querySelector('section.lmd-paywall');
                    if (hasParagraphs && paywallGone) bypassSuccess = true;
                } else if (articleDomain === 'lefigaro.fr') {
                    const hasParagraphs = iframeDocument.querySelectorAll('.fig-paragraph').length >= 3;
                    const paywallGone = !iframeDocument.querySelector('div#fig-premium-paywall');
                    if (hasParagraphs && paywallGone) bypassSuccess = true;
                } else if (articleDomain === 'leparisien.fr') {
                    const leftSection = iframeDocument.querySelector('section#left');
                    const paywallGone = !iframeDocument.querySelector('div.paywall');
                    if (leftSection && leftSection.textContent.length > 800 && paywallGone) bypassSuccess = true;
                } else {
                    if (!hasPaywall && textLength > 800 && pendingAsync === 0) bypassSuccess = true;
                }
                if (bypassSuccess || elapsed >= maxWaitTime) { clearInterval(timer); resolve(); }
            }, checkInterval);
        });

        onProgress('Plugin', 'Extraction du texte...', 80);

        let contentEl = null;
        if (contentSelector) contentEl = iframeDocument.querySelector(contentSelector);
        if (!contentEl) contentEl = iframeDocument.querySelector('article') || iframeDocument.querySelector('[itemprop="articleBody"]') || iframeDocument.querySelector('.article-body') || iframeDocument.querySelector('.article') || iframeDocument.body;

        const hasPaywall = iframeDocument.querySelector(paywallSelector);
        const textLength = contentEl ? contentEl.textContent.trim().length : 0;

        if (hasPaywall && textLength < 800) {
            iframe.remove();
            throw new Error('Contenu protégé non accessible');
        }

        const pageTitle = iframeDocument.querySelector('meta[property="og:title"]')?.getAttribute('content')
            || iframeDocument.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
            || iframeDocument.title || 'Article direct';
        const sourceName = siteConfig.name.split(' (')[0].split(' (+')[0];
        const finalHtml = `<style>${window.PRINT_CSS}</style><h1>${pageTitle}</h1>${contentEl.innerHTML}`;

        iframe.remove();

        return {
            html: finalHtml,
            title: pageTitle,
            source: sourceName,
            url: articleUrl,
            publishedDate: iframeDocument.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || iframeDocument.querySelector('meta[name="publication_date"]')?.getAttribute('content') || '',
            author: iframeDocument.querySelector('meta[name="author"]')?.getAttribute('content') || iframeDocument.querySelector('meta[property="article:author"]')?.getAttribute('content') || '',
            publication: sourceName,
            serviceUsed: 'BPC'
        };
    }

    global.BpcService = BpcService;

})(window);
