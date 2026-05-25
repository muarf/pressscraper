/**
 * cafeyn.js — Module Cafeyn pour Presse Scraper
 *
 * Gère l'authentification JWT et le scraping des articles via l'API Cafeyn.
 *
 * Dépendances :
 *   - window.DB (db.js)
 *   - window.Scraper (scraper.js)
 *   - window.Capacitor.Plugins.BnfLogin (optionnel, pour stockage sécurisé)
 */
(function(global) {
    'use strict';

    // ===== CONFIGURATION =====
    const API_BASE = 'https://api.cafeyn.co';
    const WEB_BASE = 'https://www.cafeyn.co';
    const STORE_ID = '1'; // France
    const TOKEN_KEY = 'cafeyn_jwt';
    const TOKEN_EXPIRY_KEY = 'cafeyn_jwt_expiry';

    // ===== ÉTAT =====
    let cafeynState = {
        token: '',
        tokenExpiry: null,
        isLoggedIn: false
    };

    // ===== INITIALISATION =====
    function init() {
        loadToken();
        console.log('[Cafeyn] Module initialisé, token:', cafeynState.token ? 'OK' : 'pas de token');
    }
    init();

    // ===== STOCKAGE TOKEN =====
    async function loadToken() {
        const nativePlugin = window.Capacitor?.Plugins?.CafeynLogin;
        if (nativePlugin && typeof nativePlugin.getJwt === 'function') {
            try {
                const res = await nativePlugin.getJwt();
                if (res.success && res.token && res.expiry) {
                    const expiryDate = new Date(res.expiry);
                    if (expiryDate > new Date()) {
                        cafeynState.token = res.token;
                        cafeynState.tokenExpiry = expiryDate;
                        cafeynState.isLoggedIn = true;
                        return;
                    }
                }
            } catch(e) {
                console.warn('[Cafeyn] Erreur chargement token natif:', e);
            }
        }
        try {
            const token = localStorage.getItem(TOKEN_KEY);
            const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
            if (token && expiry) {
                const expiryDate = new Date(expiry);
                if (expiryDate > new Date()) {
                    cafeynState.token = token;
                    cafeynState.tokenExpiry = expiryDate;
                    cafeynState.isLoggedIn = true;
                } else {
                    clearToken();
                }
            }
        } catch(e) {
            console.warn('[Cafeyn] Erreur chargement token localStorage:', e);
        }
    }

    async function saveToken(token, days = 30) {
        cafeynState.token = token;
        const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        cafeynState.tokenExpiry = expiry;
        cafeynState.isLoggedIn = true;
        const expiryStr = expiry.toISOString();

        const nativePlugin = window.Capacitor?.Plugins?.CafeynLogin;
        if (nativePlugin && typeof nativePlugin.saveJwt === 'function') {
            try {
                await nativePlugin.saveJwt({ token, expiry: expiryStr });
                console.log('[Cafeyn] Token sauvegardé via plugin natif');
                return;
            } catch(e) {
                console.warn('[Cafeyn] Erreur sauvegarde token natif, fallback localStorage:', e);
            }
        }
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(TOKEN_EXPIRY_KEY, expiryStr);
        console.log('[Cafeyn] Token sauvegardé dans localStorage');
    }

    async function clearToken() {
        cafeynState.token = '';
        cafeynState.tokenExpiry = null;
        cafeynState.isLoggedIn = false;

        const nativePlugin = window.Capacitor?.Plugins?.CafeynLogin;
        if (nativePlugin && typeof nativePlugin.clearJwt === 'function') {
            try {
                await nativePlugin.clearJwt();
            } catch(e) {
                console.warn('[Cafeyn] Erreur effacement token natif:', e);
            }
        }
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_EXPIRY_KEY);
        console.log('[Cafeyn] Token effacé');
    }

    function isTokenValid() {
        return cafeynState.isLoggedIn && new Date() < new Date(cafeynState.tokenExpiry);
    }

    async function apiCall(endpoint, options = {}) {
        if (!isTokenValid()) {
            throw new Error('Token Cafeyn expiré. Veuillez vous reconnecter.');
        }

        const url = API_BASE + endpoint;
        const defaultHeaders = {
            'Authorization': 'Bearer ' + cafeynState.token,
            'Origin': WEB_BASE,
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36',
            'Accept': 'application/json'
        };

        const headers = { ...defaultHeaders, ...options.headers };

        try {
            const BnfLogin = window.Capacitor?.Plugins?.BnfLogin || window.Capacitor?.Plugins?.CafeynLogin;
            if (BnfLogin && typeof BnfLogin.httpRequest === 'function') {
                const response = await BnfLogin.httpRequest({
                    url: url,
                    method: options.method || 'GET',
                    headers: headers,
                    body: options.body ? JSON.stringify(options.body) : undefined
                });

                if (response.error) {
                    throw new Error(response.error);
                }

                if (response.status === 401) {
                    await clearToken();
                    throw new Error('Token expiré — reconnexion nécessaire');
                }

                if (response.status >= 400) {
                    throw new Error(`API error ${response.status}`);
                }

                try {
                    return JSON.parse(response.data);
                } catch(e) {
                    return response.data;
                }
            } else {
                const response = await fetch(url, {
                    method: options.method || 'GET',
                    headers: headers,
                    body: options.body ? JSON.stringify(options.body) : undefined
                });

                if (response.status === 401) {
                    await clearToken();
                    throw new Error('Token expiré — reconnexion nécessaire');
                }

                if (!response.ok) {
                    throw new Error(`API error ${response.status}: ${response.statusText}`);
                }

                return await response.json();
            }
        } catch(e) {
            console.error('[Cafeyn] API call failed:', e);
            throw e;
        }
    }

    // ===== RECHERCHE =====
    async function search(query, options = {}) {
        if (!navigator.onLine) {
            throw new Error('Aucune connexion Internet');
        }
        const urlParams = new URLSearchParams({
            from: options.from || 0,
            size: options.size || 30
        });

        const body = {
            query: query,
            country: options.country || 'fr',
            lang: options.lang || 'fr'
        };

        const result = await apiCall(
            `/b2c/stores/${STORE_ID}/all/search?${urlParams.toString()}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: body
            }
        );

        return {
            issues: result.issues || [],
            articles: result.articles || { collection: [], totalCount: 0 },
            totalCount: result.articles?.totalCount || 0
        };
    }

    // ===== ARTICLE =====
    async function fetchArticle(slug) {
        return await apiCall(`/b2c/articles/${slug}`);
    }

    // ===== ISSUE =====
    async function fetchIssue(issueId) {
        return await apiCall(`/b2c/issues/${issueId}`);
    }

    // ===== PUBLICATIONS =====
    async function fetchPublications() {
        return await apiCall(`/b2c/stores/${STORE_ID}/publications/digital`);
    }

    // ===== CONVERSION JSON → HTML =====
    function articleToHtml(article) {
        if (!article || !article.elements) {
            return '<p>Contenu indisponible</p>';
        }

        let html = '';

        // YAML frontmatter
        const frontmatter = [
            `---`,
            `title: "${article.title || ''}"`,
            `publication: "${article.publicationName || ''}"`,
            `date: "${article.isoReleaseDate || ''}"`,
            `url: "${article.formattedUrl || ''}"`,
            `wordCount: ${article.wordCount || 0}`,
            `readingTime: ${article.readingTime || 0}`,
            `---`
        ].join('\n');

        // Éléments
        for (const el of article.elements) {
            switch (el.type) {
                case 'introduction':
                    html += `<p class="lead" style="font-style:italic;margin-bottom:16px;color:#555;">${el.value}</p>`;
                    break;
                case 'paragraph':
                    html += `<p>${el.value}</p>`;
                    break;
                case 'title':
                    html += `<h2>${el.value}</h2>`;
                    break;
                case 'subtitle':
                    html += `<h3>${el.value}</h3>`;
                    break;
                case 'heading':
                    html += `<h3>${el.value}</h3>`;
                    break;
                case 'image':
                    if (el.url) {
                        html += `<figure><img src="${el.url}" alt="${el.caption || ''}" style="max-width:100%;height:auto;"><figcaption>${el.caption || ''}</figcaption></figure>`;
                    }
                    break;
                case 'caption':
                    html += `<p class="caption" style="font-style:italic;color:#666;">${el.value}</p>`;
                    break;
                case 'quote':
                    html += `<blockquote style="border-left:3px solid #ccc;padding-left:16px;margin:16px 0;font-style:italic;">${el.value}</blockquote>`;
                    break;
                case 'byline':
                    html += `<p class="byline" style="color:#888;font-size:0.9em;">${el.value}</p>`;
                    break;
            }
        }

        return frontmatter + '\n' + html;
    }

    // ===== EXTRAIT SLUG DE L'URL =====
    function extractSlugFromUrl(url) {
        // Format: https://www.cafeyn.co/fr/article/hash/publication/date/slug
        // ou: https://www.cafeyn.co/fr/article/hash/publication/date/titre-du-slug
        const match = url.match(/\/fr\/article\/[^/]+\/[^/]+\/([^/]+)\/(.+)/);
        if (match) {
            return match[2];
        }
        // Format sans hash: https://www.cafeyn.co/fr/article/publication/date/slug
        const match2 = url.match(/\/fr\/article\/[^/]+\/([^/]+)\/(.+)/);
        if (match2) {
            return match2[2];
        }
        return null;
    }

    // ===== EXPORT =====
    global.Cafeyn = {
        init: init,
        saveToken: saveToken,
        clearToken: clearToken,
        isTokenValid: isTokenValid,
        search: search,
        fetchArticle: fetchArticle,
        fetchIssue: fetchIssue,
        fetchPublications: fetchPublications,
        articleToHtml: articleToHtml,
        extractSlugFromUrl: extractSlugFromUrl,
        apiCall: apiCall,
        state: cafeynState
    };

})(window);
