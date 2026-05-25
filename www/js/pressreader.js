/**
 * pressreader.js — Module PressReader pour Presse Scraper
 *
 * Gère l'activation automatique du hotspot via Referer de la bibliothèque
 * Toulouse Métropole, la recherche avancée d'articles et le scraping de contenu
 * textuel propre.
 *
 * Dépendances :
 *   - window.Capacitor.Plugins.BnfLogin (pour les requêtes HTTP avec en-têtes)
 */
(function(global) {
    'use strict';

    const API_BASE = 'https://ingress.pressreader.com/services';
    const HOTSPOT_REFERER = 'https://mabm.toulouse-metropole.fr/default/presse.aspx?_lg=fr-FR';

    let prState = {
        token: '',
        tokenExpiry: null,
        isLoggedIn: false
    };

    /**
     * Tente de récupérer un bearer token d'authentification valide en activant le Hotspot.
     */
    async function getBearerToken(UA) {
        const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
        if (!BnfLogin) {
            throw new Error("Plugin BnfLogin non disponible pour l'appel natif.");
        }

        // Appel de l'initialisation avec le referrer de la bibliothèque pour activer le hotspot
        const response = await BnfLogin.httpRequest({
            url: 'https://www.pressreader.com/authentication/v1/initialize',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Referer': HOTSPOT_REFERER,
                'User-Agent': UA
            },
            body: JSON.stringify({
                tickets: [],
                language: 'fr-FR',
                url: 'https://www.pressreader.com/',
                urlReferrer: HOTSPOT_REFERER
            })
        });

        if (!response || response.error) {
            throw new Error("Erreur d'initialisation PressReader : " + (response?.error || "réseau"));
        }

        try {
            const data = JSON.parse(response.data);
            if (data.bearerToken) {
                prState.token = data.bearerToken;
                // Expiration estimée à 7 jours (168 heures)
                prState.tokenExpiry = Date.now() + (7 * 24 * 60 * 60 * 1000);
                prState.isLoggedIn = true;
                return data.bearerToken;
            }
        } catch (e) {
            throw new Error("Erreur de parsing de la réponse d'initialisation : " + e.message);
        }

        throw new Error("Aucun jeton d'authentification (bearerToken) reçu de PressReader.");
    }

    /**
     * Vérifie si la session actuelle est toujours valide.
     */
    function isSessionValid() {
        return prState.isLoggedIn && prState.token && Date.now() < prState.tokenExpiry;
    }

    /**
     * Assure qu'un token valide est disponible (le renouvelle si expiré/invalide).
     */
    async function ensureSession(UA) {
        if (isSessionValid()) {
            return prState.token;
        }
        console.log('[PressReader] Session inactive ou expirée. Initialisation du Hotspot...');
        return await getBearerToken(UA);
    }

    /**
     * Recherche des articles sur PressReader par mots-clés.
     */
    async function search(query, UA) {
        const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
        if (!BnfLogin) throw new Error("Appel natif requis.");

        const token = await ensureSession(UA);
        const searchUrl = `${API_BASE}/v2/search/?query=${encodeURIComponent(query)}&limit=15&continuationToken=0&hideSame=true&location=Everywhere&sortOrder=Relevance&documentsType=All&additionalFields=All&articleSearchFields=All&pageSearchFields=All&shortTextLength=100&period=AllTime`;

        const response = await BnfLogin.httpRequest({
            url: searchUrl,
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'User-Agent': UA,
                'Origin': 'https://www.pressreader.com'
            }
        });

        if (!response || response.error) {
            throw new Error("Erreur de recherche PressReader : " + (response?.error || "réseau"));
        }

        try {
            const data = JSON.parse(response.data);
            return data.items || [];
        } catch (e) {
            throw new Error("Erreur de décodage des résultats de recherche : " + e.message);
        }
    }

    /**
     * Récupère le contenu détaillé d'un article à partir de son ID.
     */
    async function fetchArticle(articleId, UA) {
        const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
        if (!BnfLogin) throw new Error("Appel natif requis.");

        const token = await ensureSession(UA);
        const articleUrl = `${API_BASE}/v1/articles/${articleId}/?articleFields=8175&isHyphenated=true&fullBody=true`;

        const response = await BnfLogin.httpRequest({
            url: articleUrl,
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token,
                'User-Agent': UA,
                'Origin': 'https://www.pressreader.com'
            }
        });

        if (!response || response.error) {
            throw new Error("Erreur lors de la récupération de l'article : " + (response?.error || "réseau"));
        }

        try {
            return JSON.parse(response.data);
        } catch (e) {
            throw new Error("Erreur de parsing de l'article : " + e.message);
        }
    }

    /**
     * Extrait l'ID de l'article depuis une URL PressReader.
     */
    function extractArticleIdFromUrl(url) {
        if (!url) return null;
        
        // Ex: https://www.pressreader.com/france/le-figaro/20260522/281895894890911
        const match = url.match(/\/(\d{13,16})(?:\?|$)/);
        if (match) {
            return match[1];
        }

        // Ex: https://www.pressreader.com/search?query=figaro&popupArticleId=281895894890911
        try {
            const urlObj = new URL(url);
            const popupId = urlObj.searchParams.get('popupArticleId');
            if (popupId) return popupId;
        } catch(e) {}

        return null;
    }

    /**
     * Formate un objet article PressReader en page HTML propre pour le viewer et l'impression.
     */
    function articleToHtml(article) {
        if (!article) return '<p>Contenu indisponible</p>';

        const title = article.title || 'Sans titre';
        const subtitle = article.subtitle || '';
        const author = article.author || '';
        const date = article.date || '';
        const pubName = article.issue?.newspaper?.name || '';

        const PRINT_CSS = `
            @page { margin: 15mm 20mm; size: A4; }
            @media print {
                body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.6; color: #000; background: #fff; padding: 0; margin: 0; }
                h1 { font-size: 18pt; font-weight: bold; margin-bottom: 12pt; line-height: 1.3; border-bottom: 1px solid #ccc; padding-bottom: 8pt; page-break-after: avoid; }
                p, li, blockquote, figure { page-break-inside: avoid; orphans: 3; widows: 3; }
                img { max-width: 100%; page-break-inside: avoid; }
                a::after { content: ""; }
            }
        `;

        let html = `<style>${PRINT_CSS}</style>`;
        html += `<h1>${title}</h1>`;
        
        if (subtitle) {
            html += `<p class="lead" style="font-weight: bold; font-size: 1.2em; margin-bottom: 12px; color: #333;">${subtitle}</p>`;
        }

        let meta = '';
        if (author) meta += `Par <strong>${author}</strong> · `;
        if (pubName) meta += `${pubName} · `;
        if (date) {
            try {
                const dateObj = new Date(date);
                meta += dateObj.toLocaleDateString('fr-FR');
            } catch(e) {
                meta += date;
            }
        }

        if (meta) {
            html += `<p class="meta" style="color: #666; font-size: 0.9em; margin-bottom: 24px; border-bottom: 1px solid #eee; padding-bottom: 12px;">${meta.replace(/ · $/, '')}</p>`;
        }

        // Rendu des paragraphes
        if (article.paragraphs && Array.isArray(article.paragraphs) && article.paragraphs.length > 0) {
            article.paragraphs.forEach(p => {
                html += `<p>${p}</p>`;
            });
        } else if (article.shortContent) {
            html += `<p>${article.shortContent}</p>`;
            html += `<p style="font-style: italic; color: var(--accent); margin-top: 16px;">[Note : Accès complet verrouillé par PressReader ou contenu court]</p>`;
        } else {
            html += `<p>Contenu textuel indisponible.</p>`;
        }

        return html;
    }

    // Exposition globale
    global.PressReader = {
        getBearerToken,
        ensureSession,
        search,
        fetchArticle,
        extractArticleIdFromUrl,
        articleToHtml,
        state: prState
    };

})(window);
