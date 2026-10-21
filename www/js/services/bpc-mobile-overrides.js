/**
 * BPC Mobile Overrides
 * ===================
 * This file contains site-specific override scripts that run AFTER the standard BPC
 * content scripts (cs_default) in the sandboxed iframe.
 *
 * WHY THIS FILE EXISTS:
 * The BPC browser extension works because it runs content scripts in the REAL browser
 * context where the user is already logged in. The page's paywall DOM elements (e.g.
 * `div#bloc_paywall`) are visible, so the BPC rule conditions fire correctly.
 *
 * On mobile, the BPC service fetches pages anonymously (no cookies/session), so these
 * paywall condition checks never pass and the full article is never fetched.
 *
 * SOLUTION:
 * Each override here bypasses the broken condition by calling the site's internal
 * API directly (mobile app APIs, etc.) and injecting the full content into the iframe.
 *
 * HOW TO ADD A NEW SITE:
 * 1. Identify the API endpoint the site's mobile app uses to fetch article content.
 * 2. Add an entry to `BpcMobileOverrides.overrides` using the domain as key.
 * 3. The `script` field is a function(articleUrl, articlePathname, articleOrigin)
 *    returning an IIFE string to inject in the iframe (after the BPC bootstrap).
 *    The IIFE runs with access to: getExtFetch, DOMPurify, dompurify_options,
 *    document (the iframe document), window (the iframe window).
 * 4. Set `contentSelector` to the CSS selector for the article body in the API response.
 *
 * AVAILABLE IN THE INJECTED SCRIPT CONTEXT:
 * - getExtFetch(url, jsonKey, options, callback)  — fetches via native HTTP (bypasses CORS)
 * - DOMPurify.sanitize(html, options)            — HTML sanitizer
 * - dompurify_options                            — standard sanitizer options
 * - document                                     — proxied iframe document
 * - window                                       — proxied iframe window
 */

(function(global) {
    'use strict';

    /**
     * Registry of mobile overrides keyed by domain suffix.
     * Each entry:
     *   domains:  string[] — list of domains this override applies to
     *   script:   function(articleUrl, articlePathname, articleOrigin) => string
     *             Returns an IIFE string to inject into the BPC iframe after cs_default().
     */
    const overrides = [

        // ----------------------------------------------------------------
        // Courrier International
        // ----------------------------------------------------------------
        // Problem: The BPC rule fires only when `div#bloc_paywall` is present.
        //          On anonymous page loads this element is absent, so getExtFetch
        //          is never called and only the preview text is returned.
        // Solution: Directly call the CRI mobile API unconditionally.
        {
            domains: ['courrierinternational.com'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        var articleSel = 'div.article-text';
        var article = document.querySelector(articleSel);
        if (!article) { console.warn('[BPC MOBILE] courrierinternational: div.article-text not found in page'); return; }
        var apiUrl = 'https://apps.courrierinternational.com/cri/v1/premium-android-phone/article?id=' + encodeURIComponent(${JSON.stringify(articlePathname)});
        console.log('[BPC MOBILE] courrierinternational: fetching CRI API:', apiUrl);
        getExtFetch(apiUrl, 'templates.raw_content.content', {}, function(url, data) {
            try {
                if (!data) { console.warn('[BPC MOBILE] courrierinternational: empty API response'); return; }
                console.log('[BPC MOBILE] courrierinternational: got response, length:', data.length);
                var parser = new DOMParser();
                var sanitized = DOMPurify.sanitize(data, dompurify_options);
                var doc = parser.parseFromString(sanitized, 'text/html');
                var articleNew = doc.querySelector(articleSel);
                if (!articleNew) { console.warn('[BPC MOBILE] courrierinternational: selector not found in API response'); return; }
                console.log('[BPC MOBILE] courrierinternational: replacing content, new length:', articleNew.textContent.length);
                // Fix internal app links
                articleNew.querySelectorAll('a[href^="crifr://article?id="]').forEach(function(e) {
                    try { e.href = decodeURIComponent(e.href.split('crifr://article?id=')[1].split('&')[0]).split('?')[0]; } catch(_) {}
                });
                article.parentNode.replaceChild(articleNew, article);
            } catch(err) { console.error('[BPC MOBILE] courrierinternational callback error:', err); }
        });
    } catch(e) { console.error('[BPC MOBILE] courrierinternational override error:', e); }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Libération
        // ----------------------------------------------------------------
        // Problem: The BPC rule fires only when `div.article-body-paywall` is present.
        //          On mobile, pages are fetched without scripts/sessions so the paywall element
        //          is never injected into the DOM, leaving only the preview paragraph.
        // Solution: Call the Arc API directly unconditionally with the x-api-key,
        //          reconstruct the full article body, and inject it into the article element.
        {
            domains: ['liberation.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        var article = document.querySelector('article[data-datawall-status]') || document.querySelector('article');
        if (!article) {
            console.warn('[BPC MOBILE] liberation: article element not found');
            return;
        }
        var apiUrl = 'https://arc.api.liberation.fr/content/v4/?website=liberation&website_url=' + encodeURIComponent(${JSON.stringify(articlePathname)});
        console.log('[BPC MOBILE] liberation: fetching Arc API:', apiUrl);
        getExtFetch(apiUrl, '', { headers: { 'x-api-key': 'a7X29mBvQeP1Ld98CgF2rK5uTzWY4h' } }, function(url, rawData) {
            try {
                if (!rawData) {
                    console.warn('[BPC MOBILE] liberation: empty API response');
                    return;
                }
                var json = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                if (!json || !json.content_elements || !json.content_elements.length) {
                    console.warn('[BPC MOBILE] liberation: no content elements in API response');
                    return;
                }
                var pars = json.content_elements;
                article.innerHTML = '';
                for (var i = 0; i < pars.length; i++) {
                    var par = pars[i];
                    if (par.type === 'header' && par.content) {
                        var tag = (par.level && par.level >= 1 && par.level <= 6) ? ('h' + par.level) : 'h2';
                        var h = document.createElement(tag);
                        h.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(par.content, dompurify_options) : par.content;
                        article.appendChild(h);
                    } else if ((par.type === 'text' || par.type === 'raw_html') && par.content) {
                        var p = document.createElement('p');
                        p.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(par.content, dompurify_options) : par.content;
                        article.appendChild(p);
                    } else if (par.type === 'quote' && par.content) {
                        var bq = document.createElement('blockquote');
                        bq.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(par.content, dompurify_options) : par.content;
                        article.appendChild(bq);
                    } else if (par.type === 'correction' && par.text) {
                        var pCorr = document.createElement('p');
                        pCorr.style.fontStyle = 'italic';
                        pCorr.innerText = par.text;
                        article.appendChild(pCorr);
                    } else if (par.type === 'image' && par.url) {
                        var fig = document.createElement('figure');
                        var img = document.createElement('img');
                        img.src = par.url;
                        fig.appendChild(img);
                        if (par.caption) {
                            var figcap = document.createElement('figcaption');
                            figcap.innerText = par.caption;
                            fig.appendChild(figcap);
                        }
                        article.appendChild(fig);
                    } else if (par.type === 'oembed_response' && par.raw_oembed && par.raw_oembed.html) {
                        var divOembed = document.createElement('div');
                        divOembed.innerHTML = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(par.raw_oembed.html, dompurify_options) : par.raw_oembed.html;
                        article.appendChild(divOembed);
                    }
                }
                console.log('[BPC MOBILE] liberation: injected', pars.length, 'elements, text length:', article.textContent.length);
            } catch (err) {
                console.error('[BPC MOBILE] liberation callback error:', err);
            }
        });
    } catch(e) {
        console.error('[BPC MOBILE] liberation override error:', e);
    }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Les Échos & Historia
        // ----------------------------------------------------------------
        // Problem: The full article body is stored in window.__REACT_QUERY_STATE__
        //          inside a script tag, but standard BPC requires a paywall element
        //          (div#paywall, div#registerWall) that is absent in anonymous mobile loads.
        // Solution: Extract the article text directly from the React Query state and
        //          replace the teaser content in div.post-paywall / article.
        {
            domains: ['lesechos.fr', 'historia.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        console.log('[BPC MOBILE] lesechos: searching for __REACT_QUERY_STATE__...');
        var filter = /window\\.__REACT_QUERY_STATE__\\s?=\\s?/;
        var scripts = document.querySelectorAll('script');
        var jsonScript = Array.prototype.find.call(scripts, function(s) {
            return filter.test(s.textContent || s.text || '');
        });
        if (!jsonScript) {
            console.warn('[BPC MOBILE] lesechos: script __REACT_QUERY_STATE__ introuvable');
            return;
        }
        var rawText = jsonScript.textContent || jsonScript.text || '';
        var match = rawText.split(filter);
        if (!match || match.length < 2) {
            console.warn('[BPC MOBILE] lesechos: impossible de parser split(__REACT_QUERY_STATE__)');
            return;
        }
        var jsonStr = match[1].split('};')[0] + '}';
        var json = JSON.parse(jsonStr);
        if (!json || !json.queries) {
            console.warn('[BPC MOBILE] lesechos: pas de queries dans le JSON');
            return;
        }
        var q = json.queries.find(function(x) {
            return x && x.state && x.state.data && x.state.data.stripes;
        });
        if (!q || !q.state || !q.state.data || !q.state.data.stripes) {
            console.warn('[BPC MOBILE] lesechos: stripes non trouvés');
            return;
        }
        var stripes = q.state.data.stripes;
        var fullHtml = '';
        for (var i = 0; i < stripes.length; i++) {
            var stripe = stripes[i];
            if (stripe && Array.isArray(stripe.mainContent)) {
                for (var j = 0; j < stripe.mainContent.length; j++) {
                    var mc = stripe.mainContent[j];
                    if (mc && mc.data && mc.data.description) {
                        fullHtml += mc.data.description;
                    }
                }
            }
        }
        if (!fullHtml) {
            console.warn('[BPC MOBILE] lesechos: descriptions vides dans les stripes');
            return;
        }
        console.log('[BPC MOBILE] lesechos: texte complet extrait ! Longueur:', fullHtml.length);
        var target = document.querySelector('div.post-paywall') || document.querySelector('article') || document.querySelector('.article-body');
        if (target) {
            var sanitized = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(fullHtml, dompurify_options) : fullHtml;
            var parser = new DOMParser();
            var doc = parser.parseFromString('<div class="' + (target.className || 'post-paywall') + '">' + sanitized + '</div>', 'text/html');
            var newDiv = doc.querySelector('div');
            if (newDiv) {
                newDiv.querySelectorAll('img').forEach(function(img) { img.style.width = '100%'; });
                target.parentNode.replaceChild(newDiv, target);
                console.log('[BPC MOBILE] lesechos: contenu remplacé avec succès par l\\'article complet !');
            }
        }
        // Supprimer d'éventuels paywalls résiduels
        var paywalls = document.querySelectorAll('div#paywall, div#registerWall, div[class*="paywall"], div[class*="Paywall"]');
        paywalls.forEach(function(p) { p.remove(); });
    } catch(err) {
        console.error('[BPC MOBILE] lesechos override error:', err);
    }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Template for future sites — copy and adapt this block:
        // ----------------------------------------------------------------
        // {
        //     domains: ['example.com', 'www.example.com'],
        //     script: function(articleUrl, articlePathname, articleOrigin) {
        //         return `(function() {
        //     try {
        //         var articleSel = 'div.article-content';
        //         var article = document.querySelector(articleSel);
        //         if (!article) { console.warn('[BPC MOBILE] example.com: selector not found'); return; }
        //         var apiUrl = 'https://api.example.com/article?path=' + encodeURIComponent(${JSON.stringify('PLACEHOLDER_PATHNAME')});
        //         getExtFetch(apiUrl, 'data.body', {}, function(url, data) {
        //             if (!data) return;
        //             var doc = new DOMParser().parseFromString(DOMPurify.sanitize(data, dompurify_options), 'text/html');
        //             var articleNew = doc.querySelector(articleSel);
        //             if (articleNew) article.parentNode.replaceChild(articleNew, article);
        //         });
        //     } catch(e) { console.error('[BPC MOBILE] example.com error:', e); }
        // })();`;
        //     }
        // },
    ];

    /**
     * Find an override for the given hostname, or return null.
     * @param {string} hostname
     * @returns {{ domains: string[], script: Function }|null}
     */
    function findOverride(hostname) {
        for (var i = 0; i < overrides.length; i++) {
            var entry = overrides[i];
            for (var j = 0; j < entry.domains.length; j++) {
                var d = entry.domains[j];
                if (hostname === d || hostname.endsWith('.' + d)) return entry;
            }
        }
        return null;
    }

    const customUserAgents = {
        'atlantico.fr': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
    };

    global.BpcMobileOverrides = {
        /**
         * Returns the IIFE script string to inject for a given URL, or null if no override.
         * @param {string} articleUrl  Full article URL
         * @returns {string|null}
         */
        getOverrideScript: function(articleUrl) {
            try {
                var parsed = new URL(articleUrl);
                var override = findOverride(parsed.hostname);
                if (!override) return null;
                return override.script(articleUrl, parsed.pathname, parsed.origin);
            } catch(e) {
                console.error('[BpcMobileOverrides] getOverrideScript error:', e);
                return null;
            }
        },

        /**
         * Returns the customized User-Agent based on URL or site config.
         * @param {string} articleUrl
         * @param {Object} siteConfig
         * @param {string} defaultUA
         * @returns {string}
         */
        getCustomUA: function(articleUrl, siteConfig, defaultUA) {
            try {
                var hostname = new URL(articleUrl).hostname.toLowerCase();
                for (var domain in customUserAgents) {
                    if (hostname === domain || hostname.endsWith('.' + domain)) {
                        return customUserAgents[domain];
                    }
                }
            } catch(e) {}

            if (siteConfig) {
                if (siteConfig.useragent === 'googlebot') {
                    return 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
                } else if (siteConfig.useragent === 'bingbot') {
                    return 'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)';
                } else if (siteConfig.useragent === 'facebookbot') {
                    return 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_voiced.html)';
                } else if (siteConfig.useragent_custom) {
                    return siteConfig.useragent_custom;
                }
            }
            return defaultUA;
        }
    };

})(typeof window !== 'undefined' ? window : global);
