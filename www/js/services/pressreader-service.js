(function(global) {
    'use strict';

    const API_BASE = 'https://ingress.pressreader.com/services';

    let prToken = '';
    let prTokenExpiry = null;

    function isSessionValid() {
        return !!(prToken && Date.now() < prTokenExpiry);
    }

    function extractArticleIdFromUrl(url) {
        if (!url) return null;
        const match = url.match(/\/(\d{13,16})(?:\?|$)/);
        if (match) return match[1];
        try {
            const urlObj = new URL(url);
            const popupId = urlObj.searchParams.get('popupArticleId');
            if (popupId) return popupId;
        } catch(e) {}
        return null;
    }

    function articleToHtml(article) {
        if (!article) return '<p>Contenu indisponible</p>';
        const title = article.title || 'Sans titre';
        const subtitle = article.subtitle || '';
        const author = article.author || '';
        const date = article.date || '';
        const pubName = article.issue?.newspaper?.name || '';

        let html = `<style>${window.PRINT_CSS}</style><h1>${title}</h1>`;
        if (subtitle) {
            html += `<p class="lead" style="font-weight: bold; font-size: 1.2em; margin-bottom: 12px; color: #333;">${subtitle}</p>`;
        }
        let meta = '';
        if (author) meta += `Par <strong>${author}</strong> · `;
        if (pubName) meta += `${pubName} · `;
        if (date) {
            try { meta += new Date(date).toLocaleDateString('fr-FR'); }
            catch(e) { meta += date; }
        }
        if (meta) {
            html += `<p class="meta" style="color: #666; font-size: 0.9em; margin-bottom: 24px; border-bottom: 1px solid #eee; padding-bottom: 12px;">${meta.replace(/ · $/, '')}</p>`;
        }
        if (article.paragraphs && Array.isArray(article.paragraphs) && article.paragraphs.length > 0) {
            article.paragraphs.forEach(p => {
                if (p.type === 'text' && p.text) {
                    html += `<p>${p.text}</p>`;
                } else if (p.type === 'image' && p.imageId) {
                    html += `<figure><img src="https://ingress.pressreader.com/services/v1/images/${encodeURIComponent(p.imageId)}" alt="${p.caption || ''}" style="max-width:100%"/></figure>`;
                } else if (p.type === 'image' && p.text) {
                    html += `<figure><img src="https://ingress.pressreader.com/services/v1/images/${encodeURIComponent(p.text)}" alt="" style="max-width:100%"/></figure>`;
                }
            });
        } else if (article.shortContent) {
            html += `<p>${article.shortContent}</p>`;
            html += `<p style="font-style: italic; color: var(--accent); margin-top: 16px;">[Note : Accès complet verrouillé]</p>`;
        } else {
            html += `<p>Contenu textuel indisponible.</p>`;
        }
        return html;
    }

    const PressReaderService = {
        id: 'pressreader',
        name: 'PressReader',

        /**
         * Get a bearer token using the library referer.
         * The referer is provided by the connector.
         */
        async getBearerToken(referer, UA) {
            const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
            if (!BnfLogin) throw new Error('Plugin BnfLogin non disponible');

            const response = await BnfLogin.httpRequest({
                url: 'https://www.pressreader.com/authentication/v1/initialize',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Referer': referer,
                    'User-Agent': UA
                },
                body: JSON.stringify({
                    tickets: [],
                    language: 'fr-FR',
                    url: 'https://www.pressreader.com/',
                    urlReferrer: referer
                })
            });
            if (!response || response.error) {
                throw new Error("Erreur d'initialisation PressReader : " + (response?.error || 'réseau'));
            }
            const data = JSON.parse(response.data);
            if (!data.bearerToken) {
                throw new Error('Aucun bearerToken reçu de PressReader');
            }
            prToken = data.bearerToken;
            prTokenExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000);
            return data.bearerToken;
        },

        async ensureSession(referer, UA) {
            if (isSessionValid()) return prToken;
            return await this.getBearerToken(referer, UA);
        },

        async search(query, referer, UA) {
            const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
            if (!BnfLogin) throw new Error('Appel natif requis');
            const token = await this.ensureSession(referer, UA);
            const searchUrl = `${API_BASE}/v2/search/?query=${encodeURIComponent(query)}&limit=15&continuationToken=0&hideSame=true&location=Everywhere&sortOrder=Relevance&documentsType=All&additionalFields=All&articleSearchFields=All&pageSearchFields=All&shortTextLength=100&period=AllTime`;
            const response = await BnfLogin.httpRequest({
                url: searchUrl, method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'User-Agent': UA,
                    'Origin': 'https://www.pressreader.com'
                }
            });
            if (!response || response.error) {
                throw new Error('Erreur de recherche PressReader : ' + (response?.error || 'réseau'));
            }
            try { return JSON.parse(response.data).items || []; }
            catch (e) { throw new Error('Erreur décodage résultats : ' + e.message); }
        },

        async fetchArticle(articleId, referer, UA) {
            const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
            if (!BnfLogin) throw new Error('Appel natif requis');
            const token = await this.ensureSession(referer, UA);
            const articleUrl = `${API_BASE}/v1/articles/${articleId}/?articleFields=8191&isHyphenated=true&fullBody=true`;
            const response = await BnfLogin.httpRequest({
                url: articleUrl, method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'User-Agent': UA,
                    'Origin': 'https://www.pressreader.com'
                }
            });
            if (!response || response.error) {
                throw new Error("Erreur récupération article : " + (response?.error || 'réseau'));
            }
            try { return JSON.parse(response.data); }
            catch (e) { throw new Error('Erreur parsing article : ' + e.message); }
        }
    };

    global.PressReaderService = PressReaderService;

})(window);
