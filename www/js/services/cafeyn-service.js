(function(global) {
    'use strict';

    const API_BASE = 'https://api.cafeyn.co';
    const WEB_BASE = 'https://www.cafeyn.co';
    const STORE_ID = '1';

    let cafeynState = {
        token: '',
        tokenExpiry: null,
        isLoggedIn: false
    };

    function loadToken() {
        try {
            const token = localStorage.getItem('cafeyn_jwt');
            const expiry = localStorage.getItem('cafeyn_jwt_expiry');
            if (token && expiry) {
                const expiryDate = new Date(expiry);
                if (expiryDate > new Date()) {
                    cafeynState.token = token;
                    cafeynState.tokenExpiry = expiryDate;
                    cafeynState.isLoggedIn = true;
                }
            }
        } catch(e) {
            console.warn('[CafeynSvc] Erreur chargement token:', e);
        }
    }
    loadToken();

    function saveToken(token, days = 30) {
        cafeynState.token = token;
        const expiry = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        cafeynState.tokenExpiry = expiry;
        cafeynState.isLoggedIn = true;
        try {
            localStorage.setItem('cafeyn_jwt', token);
            localStorage.setItem('cafeyn_jwt_expiry', expiry.toISOString());
        } catch(e) {}
    }

    function isTokenValid() {
        return cafeynState.isLoggedIn && new Date() < new Date(cafeynState.tokenExpiry);
    }

    function extractSlugFromUrl(url) {
        const match = url.match(/\/fr\/article\/[^/]+\/[^/]+\/([^/]+)\/(.+)/);
        if (match) return match[2];
        const match2 = url.match(/\/fr\/article\/[^/]+\/([^/]+)\/(.+)/);
        if (match2) return match2[2];
        return null;
    }

    function articleToHtml(article) {
        if (!article || !article.elements) return '<p>Contenu indisponible</p>';
        let html = '';
        const frontmatter = [
            '---',
            `title: "${article.title || ''}"`,
            `publication: "${article.publicationName || ''}"`,
            `date: "${article.isoReleaseDate || ''}"`,
            `url: "${article.formattedUrl || ''}"`,
            `wordCount: ${article.wordCount || 0}`,
            `readingTime: ${article.readingTime || 0}`,
            '---'
        ].join('\n');
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
                case 'subtitle': case 'heading':
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

    const CafeynService = {
        id: 'cafeyn',
        name: 'Cafeyn',

        state: cafeynState,

        isTokenValid,

        async apiCall(endpoint, options = {}) {
            if (!isTokenValid()) throw new Error('Token Cafeyn expiré');
            const url = API_BASE + endpoint;
            const defaultHeaders = {
                'Authorization': 'Bearer ' + cafeynState.token,
                'Origin': WEB_BASE,
                'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36',
                'Accept': 'application/json'
            };
            const headers = { ...defaultHeaders, ...options.headers };
            const BnfLogin = window.Capacitor?.Plugins?.BnfLogin || window.Capacitor?.Plugins?.CafeynLogin;
            if (BnfLogin && typeof BnfLogin.httpRequest === 'function') {
                const response = await BnfLogin.httpRequest({
                    url, method: options.method || 'GET', headers,
                    body: options.body ? JSON.stringify(options.body) : undefined
                });
                if (response.error) throw new Error(response.error);
                if (response.status === 401) throw new Error('Token expiré');
                if (response.status >= 400) throw new Error(`API error ${response.status}`);
                try { return JSON.parse(response.data); }
                catch(e) { return response.data; }
            } else {
                const response = await fetch(url, {
                    method: options.method || 'GET', headers,
                    body: options.body ? JSON.stringify(options.body) : undefined
                });
                if (!response.ok) throw new Error(`API error ${response.status}`);
                return await response.json();
            }
        },

        async search(query, options = {}) {
            if (!navigator.onLine) throw new Error('Aucune connexion Internet');
            const urlParams = new URLSearchParams({
                from: options.from || 0, size: options.size || 30
            });
            const body = { query, country: options.country || 'fr', lang: options.lang || 'fr' };
            const result = await this.apiCall(
                `/b2c/stores/${STORE_ID}/all/search?${urlParams.toString()}`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
            );
            return {
                issues: result.issues || [],
                articles: result.articles || { collection: [], totalCount: 0 },
                totalCount: result.articles?.totalCount || 0
            };
        },

        async fetchArticle(slug) {
            return await this.apiCall(`/b2c/articles/${slug}`);
        },

        async fetchIssue(issueId) {
            return await this.apiCall(`/b2c/issues/${issueId}`);
        },

        async fetchPublications() {
            return await this.apiCall(`/b2c/stores/${STORE_ID}/publications/digital`);
        },

        saveToken,
        extractSlugFromUrl,
        articleToHtml
    };

    global.CafeynService = CafeynService;

})(window);
