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
        console.log('[BPC MOBILE] lesechos: queries count:', json.queries.length);
        for (var k = 0; k < json.queries.length; k++) {
            var qk = json.queries[k];
            var qKey = JSON.stringify(qk.queryKey || '');
            var hasStripes = !!(qk.state && qk.state.data && qk.state.data.stripes);
            console.log('[BPC MOBILE] query[' + k + ']: key=' + qKey.substring(0, 80) + ' hasStripes=' + hasStripes);
        }
        var stripes = q.state.data.stripes;
        console.log('[BPC MOBILE] lesechos: stripes count:', stripes.length);
        for (var sIdx = 0; sIdx < stripes.length; sIdx++) {
            var st = stripes[sIdx];
            var mcLen = (st && st.mainContent) ? st.mainContent.length : 0;
            var descLen = (st && st.mainContent && st.mainContent[0] && st.mainContent[0].data && st.mainContent[0].data.description) ? st.mainContent[0].data.description.length : 0;
            var descSample = descLen > 0 ? st.mainContent[0].data.description.substring(0, 100) : '';
            console.log('[BPC MOBILE] stripe[' + sIdx + ']: type=' + (st.type || 'none') + ' mcLen=' + mcLen + ' descLen=' + descLen + ' sample=' + descSample);
        }
        var desc0 = (stripes[0] && stripes[0].mainContent && stripes[0].mainContent[0] && stripes[0].mainContent[0].data) ? stripes[0].mainContent[0].data.description : '';
        console.log('[BPC MOBILE] lesechos: stripe 0 description length:', desc0.length);
        console.log('[BPC MOBILE] lesechos: has div.post-paywall?', !!document.querySelector('div.post-paywall'));
        console.log('[BPC MOBILE] lesechos: has article?', !!document.querySelector('article'));
        var fullHtml = desc0;
        var postPaywall = document.querySelector('div.post-paywall');
        if (postPaywall) {
            var sanitized = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(fullHtml, dompurify_options) : fullHtml;
            postPaywall.innerHTML = sanitized;
            postPaywall.style.display = 'block';
            postPaywall.style.visibility = 'visible';
            postPaywall.style.opacity = '1';
            postPaywall.style.height = 'auto';
            postPaywall.style.maxHeight = 'none';
            console.log('[BPC MOBILE] lesechos: set postPaywall.innerHTML, length:', postPaywall.innerHTML.length);
        } else {
            var art = document.querySelector('article') || document.querySelector('.article-body');
            if (art) {
                var sanitized = typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(fullHtml, dompurify_options) : fullHtml;
                var div = document.createElement('div');
                div.className = 'post-paywall';
                div.innerHTML = sanitized;
                art.appendChild(div);
                console.log('[BPC MOBILE] lesechos: appended post-paywall into article, length:', div.innerHTML.length);
            }
        }
        // Supprimer d'éventuels paywalls et widgets résiduels
        var unwanted = document.querySelectorAll('div#paywall, div#registerWall, div[class*="paywall"]:not(.post-paywall), div[class*="Paywall"], div[class*="registerWall"], aside, [class*="recommendation"], [class*="most-read"], [class*="Sticky"]');
        unwanted.forEach(function(u) { u.remove(); });
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
        // ----------------------------------------------------------------
        // Télérama
        // ----------------------------------------------------------------
        // Problem: The BPC rule fires only when `section.paywall` is present.
        //          On mobile, pages are fetched anonymously so this element
        //          is absent, and getExtFetch is never called.
        // Solution: Call the Télérama tablet API unconditionally.
        {
            domains: ['telerama.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        var apiUrl = 'https://apps.telerama.fr/tlr/v1/premium-android-tablet/element?id=' + encodeURIComponent(${JSON.stringify(articlePathname)});
        console.log('[BPC MOBILE] telerama: fetching tablet API:', apiUrl);
        getExtFetch(apiUrl, 'templates.raw_content.content', {}, function(url, data) {
            try {
                if (!data) { console.warn('[BPC MOBILE] telerama: empty API response'); return; }
                console.log('[BPC MOBILE] telerama: got response, length:', data.length);
                var parser = new DOMParser();
                var doc = parser.parseFromString(data, 'text/html');
                var articleNew = doc.querySelector('article.article__page-content') || doc.querySelector('article');
                if (!articleNew) { console.warn('[BPC MOBILE] telerama: article not found in API response'); return; }
                var target = document.querySelector('article.article__page-content') || document.querySelector('article');
                if (target && target.parentNode) {
                    target.parentNode.replaceChild(articleNew, target);
                } else {
                    document.body.appendChild(articleNew);
                }
                var pw = document.querySelectorAll('section.paywall, div[class*="paywall"], #poool-widget');
                pw.forEach(function(el) { el.remove(); });
                console.log('[BPC MOBILE] telerama: successfully injected full article');
            } catch(err) { console.error('[BPC MOBILE] telerama callback error:', err); }
        });
    } catch(e) { console.error('[BPC MOBILE] telerama override error:', e); }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Franc-Tireur
        // ----------------------------------------------------------------
        {
            domains: ['franc-tireur.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        // Supprimer immédiatement les widgets paywall Poool et promoted
        document.querySelectorAll('div#poool-widget-content, #poool-widget, div[id*="poool"], article.promoted-article, .promoted-article').forEach(function(el) {
            el.remove();
        });

        // Supprimer les barres de partage social (Facebook, Twitter, presse-papier)
        document.querySelectorAll('.share-bar, .social-bar, [class*="share-bar"], [class*="social-bar"]').forEach(function(el) {
            el.remove();
        });

        // Cibler l'article principal (jamais promoted)
        var mainArticle = document.querySelector('article.layout-grid__main, article.js-article, article.article');
        if (!mainArticle) {
            mainArticle = document.querySelector('article');
        }

        if (mainArticle) {
            var jsonScript = typeof getArticleJsonScript === 'function' ? getArticleJsonScript() : null;
            if (!jsonScript) {
                var scripts = document.querySelectorAll('script[type="application/ld+json"]');
                jsonScript = Array.prototype.find.call(scripts, function(s) {
                    return (s.text || s.textContent || '').includes('"articleBody"');
                });
            }
            if (jsonScript) {
                var json = JSON.parse(jsonScript.text || jsonScript.textContent);
                if (json && json.articleBody) {
                    var rawText = json.articleBody;
                    // Décodage entités HTML basiques
                    var txt = rawText
                        .replace(/&rsquo;/g, "'")
                        .replace(/&lsquo;/g, "'")
                        .replace(/&rdquo;/g, '"')
                        .replace(/&ldquo;/g, '"')
                        .replace(/&ndash;/g, '–')
                        .replace(/&mdash;/g, '—')
                        .replace(/&hellip;/g, '…')
                        .replace(/&nbsp;/g, ' ')
                        .replace(/\\s+\\?/g, '?');

                    // Saut de paragraphe avant les répliques ou noms d'orateurs en majuscules (ex: "FRANC-TIREUR. ", "NATHANAËL. ")
                    txt = txt.replace(/\\s+([A-ZÉÈÊËÀÂÎÏÔÛÙÇ\\s-]{3,25}\\.\\s+)/g, '\\n\\n$1');

                    // Découpage intelligent par phrases (~350 à 450 car.)
                    var chunks = txt.split(/\\n\\n+/);
                    var allParagraphs = [];
                    chunks.forEach(function(chunk) {
                        if (chunk.length > 500) {
                            var sentences = chunk.match(/[^.!?]+[.!?]+(\\s+|$)/g) || [chunk];
                            var currentP = '';
                            sentences.forEach(function(s) {
                                currentP += s;
                                if (currentP.length >= 350) {
                                    allParagraphs.push(currentP.trim());
                                    currentP = '';
                                }
                            });
                            if (currentP.trim()) allParagraphs.push(currentP.trim());
                        } else if (chunk.trim()) {
                            allParagraphs.push(chunk.trim());
                        }
                    });

                    var formattedHtml = allParagraphs.map(function(p) {
                        return '<p style="margin-bottom: 1em; line-height: 1.6;">' + DOMPurify.sanitize(p, typeof dompurify_options !== 'undefined' ? dompurify_options : {}) + '</p>';
                    }).join('');

                    // Trouver ou créer le conteneur du corps
                    var bodyContainer = mainArticle.querySelector('section.article-body') || mainArticle.querySelector('.js-poool-wrapper') || mainArticle.querySelector('.paywall');
                    if (bodyContainer) {
                        bodyContainer.innerHTML = formattedHtml;
                        bodyContainer.setAttribute('id', 'js-article-content');
                        bodyContainer.setAttribute('class', 'article-body');
                    } else {
                        var div = document.createElement('div');
                        div.id = 'js-article-content';
                        div.className = 'article-body';
                        div.innerHTML = formattedHtml;
                        mainArticle.appendChild(div);
                    }

                    // Nettoyage final des résidus de partage et wrappers
                    mainArticle.querySelectorAll('.share-bar, .social-bar, article.promoted-article, .promoted-article').forEach(function(el) {
                        el.remove();
                    });

                    console.log('[BPC MOBILE] franc-tireur: injected full formatted article (' + allParagraphs.length + ' paragraphs)');
                }
            }
        }
    } catch(e) { console.error('[BPC MOBILE] franc-tireur error:', e); }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Capital (capital.fr - Prisma Media)
        // ----------------------------------------------------------------
        {
            domains: ['capital.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        // Démasquer le contenu payant
        var paidEl = document.querySelector('#articleWall-paid, .articleWall-paid');
        if (paidEl) {
            paidEl.removeAttribute('hidden');
            paidEl.style.display = 'block';
            paidEl.style.visibility = 'visible';
            paidEl.classList.remove('hidden');
        }

        // Supprimer le bloc de paywall
        var walls = document.querySelectorAll('#articleWall-wrapper, .articleWall-wrapper, [class*="articleWallGeneric"]');
        walls.forEach(function(el) { el.remove(); });

        // Supprimer les pubs, boutons de partage et encarts promotionnels
        var garbage = document.querySelectorAll('.shareButtons, .ad, [class*="containerAds"], [class*="ads-core-placer"], .linkCard, .article-userActions, #article-googleServices');
        garbage.forEach(function(el) { el.remove(); });

        console.log('[BPC MOBILE] capital.fr: unhidden paid section and removed paywall');
    } catch(e) { console.error('[BPC MOBILE] capital.fr error:', e); }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Le Journal du Dimanche (lejdd.fr)
        // ----------------------------------------------------------------
        {
            domains: ['lejdd.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        // Supprimer immédiatement les recommandations parasites qui contiennent des balises <article>
        document.querySelectorAll('article.reco-article-light, article.reco-article, .reco-article, .reco-article-light').forEach(function(el) {
            el.remove();
        });

        // Supprimer le widget Poool et Taboola
        var pw = document.querySelectorAll('div#poool-widget, #poool-widget, div[id*="poool"], #taboola, [id*="taboola"]');
        pw.forEach(function(el) { el.remove(); });

        // Marquer l'article principal
        var mainArt = document.querySelector('main > article') || document.querySelector('section.content-rte');
        if (mainArt) {
            mainArt.setAttribute('id', 'js-article-content');
        }

        // S'assurer que le contenu premium est visible
        var prem = document.querySelectorAll('.premium, .premium-rte');
        prem.forEach(function(el) {
            el.removeAttribute('hidden');
            el.style.display = 'block';
            el.style.visibility = 'visible';
            el.style.filter = 'none';
        });

        // Supprimer les pubs, boutons de partage et "À lire aussi"
        var garbage = document.querySelectorAll('.block-share, .readtoo, [class*="ads-core-placer"], [class*="lmn-"]');
        garbage.forEach(function(el) { el.remove(); });

        console.log('[BPC MOBILE] lejdd.fr: identified main article, removed poool and reco articles');
    } catch(e) { console.error('[BPC MOBILE] lejdd.fr error:', e); }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Challenges & Sciences et Avenir (Groupe Perdriel)
        // ----------------------------------------------------------------
        {
            domains: ['challenges.fr', 'sciencesetavenir.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        var poool = document.querySelectorAll('#poool-widget, .poool-widget, .paywall-article, .paying');
        poool.forEach(function(el) { el.remove(); });
        var sidebar = document.querySelectorAll('.views-article-sidebar, .views-article__sticky-wrapper, .views-article__buttons--desktop, .views-article__buttons--mobile, [class*="feed-item-carousel"], a[href*="google.com"], .content-right, .article-share, .m-audio__bar, .article-reactions, .article-tags, .article-read-trigger, p.breadcrumb');
        sidebar.forEach(function(el) { el.remove(); });
        var imgs = document.querySelectorAll('img[data-src]');
        imgs.forEach(function(img) {
            var dataSrc = img.getAttribute('data-src');
            if (dataSrc && !dataSrc.includes('placeholder')) {
                img.src = dataSrc;
                img.removeAttribute('data-src');
                img.classList.remove('lazyload');
            }
        });
        console.log('[BPC MOBILE] challenges/sciencesetavenir: removed poool widget, sidebars, resolved lazyload images');
    } catch(e) { console.error('[BPC MOBILE] challenges/sciencesetavenir error:', e); }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Alternatives Économiques
        // ----------------------------------------------------------------
        {
            domains: ['alternatives-economiques.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        var poool = document.querySelectorAll('#poool-widget, .poool-widget, div[id*="poool"]');
        poool.forEach(function(el) { el.remove(); });
        var junk = document.querySelectorAll('aside.ae-article__aside, footer.ae-article__footer, div.article-header__rubriques, div.article-header__buttons, div.dialog-graphique-wrapper, .share-btn, .share-popin');
        junk.forEach(function(el) { el.remove(); });
        var imgs = document.querySelectorAll('img');
        imgs.forEach(function(img) {
            var src = img.getAttribute('src');
            if (src && src.startsWith('/')) {
                img.src = 'https://www.alternatives-economiques.fr' + src;
            }
            var srcset = img.getAttribute('srcset');
            if (srcset) {
                img.setAttribute('srcset', srcset.replace(/(^|,\\s*)\\//g, '$1https://www.alternatives-economiques.fr/'));
            }
            var dataSrc = img.getAttribute('data-src');
            if (dataSrc) {
                img.src = dataSrc.startsWith('/') ? ('https://www.alternatives-economiques.fr' + dataSrc) : dataSrc;
                img.removeAttribute('data-src');
            }
        });
        console.log('[BPC MOBILE] alternatives-economiques: removed poool widget, junk, and resolved relative images');
    } catch(e) { console.error('[BPC MOBILE] alternatives-economiques error:', e); }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Atlantico
        // ----------------------------------------------------------------
        {
            domains: ['atlantico.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        var junk = document.querySelectorAll('[class*="print:hidden"], nav.article-breadcrumb, .ad-slot-outer, .footer-ad, div.footer-ad, .tonos-offer, [class*="tonos"]');
        junk.forEach(function(el) { el.remove(); });
        console.log('[BPC MOBILE] atlantico: cleaned print:hidden, breadcrumbs and ads');
    } catch(e) { console.error('[BPC MOBILE] atlantico error:', e); }
})();`;
            }
        },

        // ----------------------------------------------------------------
        // Charlie Hebdo
        // ----------------------------------------------------------------
        // WordPress REST API provides full article text via internal app key.
        {
            domains: ['charliehebdo.fr'],
            script: function(articleUrl, articlePathname, articleOrigin) {
                return `(function() {
    try {
        var shortlink = document.querySelector('link[rel="shortlink"]');
        var m = shortlink && shortlink.href ? shortlink.href.match(/[?&]p=(\\d+)/) : null;
        var postId = m ? m[1] : null;
        if (!postId) {
            var art = document.querySelector('article[id^="post-"]');
            if (art) postId = art.id.replace('post-', '');
        }
        if (!postId) {
            var fav = document.querySelector('input[name="favorite_post"]');
            if (fav) postId = fav.value;
        }
        if (!postId) {
            console.warn('[BPC MOBILE] charliehebdo: post ID not found');
            return;
        }
        var apiUrl = 'https://charliehebdo.fr/wp-json/wp/v2/posts/' + postId + '?appkey=JeSuisCharlie2023';
        console.log('[BPC MOBILE] charliehebdo: fetching full text from API:', apiUrl);
        getExtFetch(apiUrl, 'content.rendered', {}, function(url, data) {
            try {
                if (!data) {
                    console.warn('[BPC MOBILE] charliehebdo: empty API response');
                    return;
                }
                var target = document.querySelector('div#principal, div.ch-paywalled-content');
                if (target) {
                    target.innerHTML = DOMPurify.sanitize(data, dompurify_options);
                    target.querySelectorAll('section[data-a_lire_aussi_article]').forEach(function(el) { el.remove(); });
                    var paywall = document.querySelectorAll('#paywall, .ch-paywall-container, .qiota_hidden');
                    paywall.forEach(function(el) { el.remove(); });
                    console.log('[BPC MOBILE] charliehebdo: full content injected, length:', target.textContent.length);
                }
            } catch(err) {
                console.error('[BPC MOBILE] charliehebdo callback error:', err);
            }
        });
    } catch(e) {
        console.error('[BPC MOBILE] charliehebdo error:', e);
    }
})();`;
            }
        }
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
