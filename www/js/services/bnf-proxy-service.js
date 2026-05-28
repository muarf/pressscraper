(function(global) {
    'use strict';

    const BNF_PROXY_SITES = [
        {
            domains: ['mediapart.fr', 'www.mediapart.fr'],
            proxyHost: 'www-mediapart-fr.bnf.idm.oclc.org',
            name: 'Mediapart',
            contentSelector: '.paywall-restricted-content, .news__body__center__article, .content-article, .article__content, [data-module="article-body"], .article-body',
            paywallSelector: '#paywall, .paywall, .register-wall, .subscribe'
        },
        {
            domains: ['arretsurimages.net', 'www.arretsurimages.net'],
            proxyHost: 'www-arretsurimages-net.bnf.idm.oclc.org',
            name: 'Arrêt sur Images',
            contentSelector: '.page-content, .article-content, .entry-content, .post-content, article .content, [class*="article-body"]',
            paywallSelector: '.paywall-block.paywall-callToAction, .paywall, #paywall, .subscribe-wall'
        }
    ];

    function getBnfProxySiteConfig(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname;
            for (const site of BNF_PROXY_SITES) {
                if (site.domains.includes(hostname)) {
                    const proxyUrl = `https://${site.proxyHost}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
                    return { ...site, proxyUrl };
                }
                if (hostname === site.proxyHost) {
                    return { ...site, proxyUrl: url };
                }
            }
        } catch (e) {}
        return null;
    }

    const BnfProxyService = {
        id: 'bnf-proxy',
        name: 'BnF Proxy',

        /**
         * Check if the URL is a supported BnF proxy site.
         */
        supportsUrl(url) {
            return getBnfProxySiteConfig(url) !== null;
        },

        /**
         * Fetch an article via BnF EZProxy for supported sites.
         * Handles Mediapart (licence activation) and Arrêt sur Images (API token + API call).
         */
        async fetchByUrl(url, authHeaders, onProgress) {
            const BnfLogin = window.Capacitor.Plugins.BnfLogin;
            const cookieHeader = authHeaders?.['Cookie'] || '';
            const UA = authHeaders?.['User-Agent'] || '';

            const siteConfig = getBnfProxySiteConfig(url);
            if (!siteConfig) return null;

            const proxyUrl = siteConfig.proxyUrl;
            onProgress('BnF Proxy', `Téléchargement via BnF (${siteConfig.name})...`, 15);

            if (siteConfig.name === 'Arrêt sur Images') {
                onProgress('BnF Proxy', 'Authentification Arrêt sur Images...', 20);
                try {
                    const autologinRes = await BnfLogin.httpRequest({
                        url: 'https://bnf.idm.oclc.org/login?url=http://www.arretsurimages.net/autologin.php',
                        method: 'GET',
                        headers: {
                            'User-Agent': UA,
                            'Cookie': cookieHeader,
                            'Referer': 'https://www.google.com/'
                        }
                    });
                    if (autologinRes && !autologinRes.error && autologinRes.data) {
                        const tokenMatch = autologinRes.data.match(/localStorage\.setItem\('auth_access_token',\s*'([^']+)'\)/);
                        if (tokenMatch) {
                            const token = tokenMatch[1];
                            let type = 'articles', slug = '';
                            try {
                                const urlObj = new URL(url);
                                const pathSegments = urlObj.pathname.split('/').filter(Boolean);
                                if (pathSegments.length >= 2) {
                                    type = pathSegments[0];
                                    slug = pathSegments[pathSegments.length - 1];
                                } else {
                                    slug = pathSegments[0] || '';
                                }
                            } catch (e) {}
                            if (slug) {
                                onProgress('BnF Proxy', 'Récupération via l\'API...', 40);
                                const apiUrl = `https://api-arretsurimages-net.bnf.idm.oclc.org/api/public/contents/${type}/${slug}?access_token=${token}`;
                                const apiRes = await BnfLogin.httpRequest({
                                    url: apiUrl,
                                    method: 'GET',
                                    headers: { 'User-Agent': UA, 'Cookie': cookieHeader }
                                });
                                if (apiRes && !apiRes.error && apiRes.data) {
                                    const articleData = JSON.parse(apiRes.data);
                                    if (articleData && articleData.content) {
                                        const pageTitle = articleData.title || siteConfig.name;
                                        const subtitle = articleData.subtitle ? `<p class="subtitle" style="font-weight: bold; font-size: 1.2em; margin-bottom: 20px; color: #555;">${articleData.subtitle}</p>` : '';
                                        const lead = articleData.lead ? `<p class="lead" style="font-style: italic; margin-bottom: 20px; color: #333;">${articleData.lead}</p>` : '';
                                        const finalHtml = `<style>${window.PRINT_CSS}</style><h1>${pageTitle}</h1>${subtitle}${lead}${articleData.content}`;
                                        onProgress('BnF Proxy', 'Succès !', 95);
                                        return {
                                            html: finalHtml,
                                            title: pageTitle,
                                            source: siteConfig.name,
                                            url: url,
                                            publishedDate: articleData.date || '',
                                            author: articleData.author || '',
                                            publication: siteConfig.name,
                                            serviceUsed: 'BnF Europresse'
                                        };
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[BnF Proxy] API échoué, repli scrap standard:', err);
                }
            } else if (siteConfig.name === 'Mediapart') {
                onProgress('BnF Proxy', 'Activation de la licence Mediapart...', 20);
                try {
                    const licRes = await BnfLogin.httpRequest({
                        url: 'https://bnf.idm.oclc.org/login?url=http://www.mediapart.fr/licence',
                        method: 'GET',
                        headers: {
                            'User-Agent': UA,
                            'Cookie': cookieHeader,
                            'Referer': 'https://www.google.com/'
                        }
                    });
                    console.log('[BnF Proxy] Licence activation status:', licRes?.status, 'data.length:', (licRes?.data || '').length);
                } catch (err) {
                    console.warn('[BnF Proxy] Échec activation licence Mediapart:', err);
                }
            }

            onProgress('BnF Proxy', 'Téléchargement de la page...', 50);
            console.log('[BnF Proxy] DEBUG proxyUrl:', proxyUrl);
            console.log('[BnF Proxy] DEBUG cookieHeader length:', (cookieHeader || '').length, 'first 200:', (cookieHeader || '').substring(0, 200));
            const pageRes = await BnfLogin.httpRequest({
                url: proxyUrl,
                method: 'GET',
                headers: {
                    'User-Agent': UA,
                    'Cookie': cookieHeader,
                    'Referer': 'https://www.google.com/'
                }
            });
            if (!pageRes || pageRes.error) {
                throw new Error(`[BnF Proxy] Erreur réseau : ${pageRes?.error || 'inconnue'}`);
            }
            console.log('[BnF Proxy] DEBUG http status:', pageRes.status);
            console.log('[BnF Proxy] DEBUG html length:', (pageRes.data || '').length);
            console.log('[BnF Proxy] DEBUG html start:', (pageRes.data || '').substring(0, 1000));
            console.log('[BnF Proxy] DEBUG html end:', (pageRes.data || '').slice(-300));

            if (pageRes.status >= 400) {
                throw new Error(`[BnF Proxy] HTTP ${pageRes.status} pour ${proxyUrl}`);
            }

            const html = pageRes.data || '';
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // DEBUG: cherche le contenu article caché dans le HTML
            try {
                const ldJsonMatches = html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
                for (const m of ldJsonMatches) {
                    try {
                        const ldData = JSON.parse(m[1]);
                        const texts = [];
                        if (ldData.articleBody) texts.push('articleBody');
                        if (ldData.description) texts.push('description');
                        if (ldData.text) texts.push('text');
                        console.log('[BnF Proxy] DEBUG ld+json keys:', Object.keys(ldData).join(','), 'found:', texts.join(','));
                        if (ldData.articleBody) {
                            console.log('[BnF Proxy] DEBUG articleBody length:', ldData.articleBody.length, 'preview:', ldData.articleBody.substring(0, 200));
                        }
                    } catch(e) {}
                }
                // Cherche des gros blocs de texte dans les scripts
                const allScripts = doc.querySelectorAll('script');
                for (const s of allScripts) {
                    const t = (s.textContent || '').trim();
                    if (t.length > 1000 && /article|content|text|body/i.test(t.substring(0, 200))) {
                        console.log('[BnF Proxy] DEBUG large script:', (s.id || s.type || 'no-id'), 'length:', t.length, 'preview:', t.substring(0, 300));
                    }
                }
            } catch (e) {
                console.warn('[BnF Proxy] DEBUG content search error:', e.message);
            }

            const oclcUsernameInput = doc.querySelector('input[name="j_username"]');
            const oclcPasswordInput = doc.querySelector('input[name="j_password"]');
            const oclcLoginForm = doc.querySelector('form[action*="idm.oclc.org"], form[action*="bnf.idm"]');
            const pageDocTitle = (doc.title || '').toLowerCase();
            const isLoginPage = !!(oclcUsernameInput && oclcPasswordInput)
                || !!oclcLoginForm
                || pageDocTitle === 'login'
                || pageDocTitle === 'authentication required'
                || pageDocTitle === 'shibboleth authentication request'
                || !!doc.querySelector('form[action*="SAML2/POST/SSO"]');

            if (isLoginPage) {
                throw new Error('Session BnF expirée. Veuillez vous reconnecter dans les paramètres.');
            }

            onProgress('BnF Proxy', 'Extraction du contenu...', 60);
            const pageTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
                || doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
                || doc.title || siteConfig.name;

            let contentEl = null;
            const selectors = siteConfig.contentSelector.split(',').map(s => s.trim());
            for (const sel of selectors) {
                contentEl = doc.querySelector(sel);
                if (contentEl) break;
            }
            if (!contentEl) {
                contentEl = doc.querySelector('article')
                    || doc.querySelector('[itemprop="articleBody"]')
                    || doc.querySelector('.article-body')
                    || doc.querySelector('.article')
                    || doc.body;
            }

            const paywallEl = doc.querySelector(siteConfig.paywallSelector);
            const textLength = contentEl ? contentEl.textContent.trim().length : 0;
            console.log('[BnF Proxy] DEBUG paywallEl:', !!paywallEl, 'textLength:', textLength, 'contentEl:', !!contentEl);
            if (paywallEl && textLength < 800) {
                console.log('[BnF Proxy] DEBUG paywall HTML:', paywallEl.outerHTML.substring(0, 500));
                console.log('[BnF Proxy] DEBUG page title:', doc.title);
                console.log('[BnF Proxy] DEBUG meta robots:', doc.querySelector('meta[name="robots"]')?.getAttribute('content'));
                throw new Error(`Paywall encore actif sur ${siteConfig.name}. Vérifiez votre session BnF.`);
            }

            if (contentEl) {
                contentEl.querySelectorAll(
                    siteConfig.paywallSelector + ', .newsletter-block, .social-share, .related-articles, nav, footer, .ads, [class*="banner"]'
                ).forEach(el => el.remove());
            }

            onProgress('BnF Proxy', 'Mise en forme...', 85);
            const finalHtml = `<style>${window.PRINT_CSS}</style><h1>${pageTitle}</h1>${contentEl ? contentEl.innerHTML : ''}`;

            return {
                html: finalHtml,
                title: pageTitle,
                source: siteConfig.name,
                url: url,
                publishedDate: doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || '',
                author: doc.querySelector('meta[name="author"]')?.getAttribute('content') || doc.querySelector('meta[property="article:author"]')?.getAttribute('content') || '',
                publication: siteConfig.name,
                serviceUsed: 'BnF Europresse'
            };
        }
    };

    global.BnfProxyService = BnfProxyService;

})(window);
