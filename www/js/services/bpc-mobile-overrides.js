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
        }
    };

})(typeof window !== 'undefined' ? window : global);
