/**
 * scraper.js — Moteur de scraping client-side pour Presse Scraper
 *
 * Expose: Scraper.scrapeArticle(titleOrUrl, fallbackTitle, state)
 *
 * Dépendances:
 *   - window.Capacitor.Plugins.BnfLogin (plugin natif Android)
 */
(function(global) {
    'use strict';

    const EUROPRESSE_DOMAIN = 'nouveau-europresse-com.bnf.idm.oclc.org';
    // UA de secours utilisé si le plugin natif n'est pas disponible (tests navigateur)
    const UA_FALLBACK = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

    /**
     * Récupère le User-Agent réel de la WebView Android via le plugin natif.
     * Retourne le UA de secours si le plugin n'est pas disponible.
     */
    async function getUA() {
        try {
            if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
                const res = await window.Capacitor.Plugins.BnfLogin.getWebViewUserAgent();
                if (res && res.userAgent) return res.userAgent;
            }
        } catch(e) {
            console.warn('[SCRAPE] Could not get native UA, using fallback:', e);
        }
        return UA_FALLBACK;
    }

    // ===== HELPERS INTERNES =====

    /**
     * Transforme un titre en requête de recherche Europresse.
     * Nettoie et prépare le titre pour la recherche sans filtre ni limite de mots.
     */
    function processTitleToQuery(title) {
        if (!title) return null;

        let cleanTitle = title.split(/ - | \| | — | · /)[0];
        // On supprime les apostrophes pour que "c'est" -> "cest", "l'info" -> "linfo"
        cleanTitle = cleanTitle.replace(/[''""’‘`]/g, '');
        cleanTitle = cleanTitle.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()…?–—«»]/g, ' ');

        const words = cleanTitle.toLowerCase().split(/\s+/).filter(Boolean);
        const filtered = [];
        const seen = new Set();

        for (const raw of words) {
            const cw = raw.replace(/[^\p{L}\d]/gu, '');
            // On exclut uniquement les lettres isolées de 1 caractère car non-indexées par Europresse
            if (!cw || cw.length <= 1) continue;
            if (!seen.has(cw)) {
                seen.add(cw);
                filtered.push(cw);
            }
        }

        if (filtered.length < 1) return null;
        return filtered.join(' ');
    }

    /**
     * Retourne le code de filtre de date Europresse en fonction de l'âge de l'article.
     */
    function calculateDateFilter(publishedDate) {
        if (!publishedDate) return '9';
        try {
            const pub = new Date(publishedDate);
            const diffDays = Math.ceil(Math.abs(Date.now() - pub.getTime()) / 86400000);
            if (diffDays <= 1) return '2';
            if (diffDays <= 3) return '11';
            if (diffDays <= 7) return '3';
            if (diffDays <= 30) return '4';
            if (diffDays <= 90) return '5';
            return '9';
        } catch(e) { return '9'; }
    }

    /**
     * Calcule un score de similarité (0-100) entre deux titres d'articles.
     * Basé sur le recouvrement de mots significatifs (longueur pondérée).
     */
    function calculateSimilarity(titleA, titleB) {
        if (!titleA || !titleB) return 0;
        const clean = (t) => t.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        const setA = new Set(clean(titleA));
        const setB = new Set(clean(titleB));
        if (setA.size === 0) return 0;
        let score = 0, total = 0;
        setA.forEach(w => { total += w.length; if (setB.has(w)) score += w.length; });
        return total === 0 ? 0 : Math.round((score / total) * 100);
    }

    /**
     * Supprime les balises de surlignage (<mark>, .hlterms) injectées par Europresse.
     */
    function removeHighlightTags(html) {
        if (!html) return html;
        try {
            const parser = new DOMParser();
            const tempDoc = parser.parseFromString(html, 'text/html');

            // 1. Unwrap all <mark> tags
            let marks = tempDoc.querySelectorAll('mark');
            while (marks.length > 0) {
                marks.forEach(mark => {
                    const parent = mark.parentNode;
                    if (parent) {
                        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
                        parent.removeChild(mark);
                    }
                });
                marks = tempDoc.querySelectorAll('mark');
            }

            // 2. Remove hlterms classes
            tempDoc.querySelectorAll('.hlterms').forEach(el => el.classList.remove('hlterms'));

            return tempDoc.body.innerHTML;
        } catch(e) {
            console.error('[CLEAN] Error removing highlights:', e);
            return html;
        }
    }

    // ===== MOTEUR PRINCIPAL =====

    /**
     * Scrape un article depuis Europresse via la session BnF active.
     *
     * @param {string} titleOrUrl  — URL de l'article original ou mots-clés de recherche
     * @param {string} fallbackTitle — Titre fourni manuellement (optionnel, pour URL partagée avec titre)
     * @param {object} state — État de l'app contenant bnfCookiesHeader
     * @param {function} onProgress — Callback (phase, message, progress%) pour les mises à jour UI
     * @returns {Promise<{html, title, source, url}>}
     */
    async function scrapeArticle(titleOrUrl, fallbackTitle, state, onProgress) {
        const BnfLogin = window.Capacitor.Plugins.BnfLogin;
        const cookieHeader = state.bnfCookiesHeader || '';
        const UA = await getUA(); // UA dynamique depuis la WebView système

        const isUrl = titleOrUrl.startsWith('http');
        let articleTitle = '';
        let publishedDate = '';
        let articleUrl = isUrl ? titleOrUrl : '';

        // === Étape 1 : Récupération du titre ===
        if (isUrl) {
            onProgress('Étape 1/5', 'Récupération du titre...', 10);
            articleTitle = fallbackTitle || '';

            if (!articleTitle) {
                try {
                    const pageRes = await BnfLogin.httpRequest({
                        url: articleUrl,
                        method: 'GET',
                        headers: { 'User-Agent': UA }
                    });
                    if (pageRes.status === 200 && pageRes.data) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(pageRes.data, 'text/html');
                        articleTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
                            || doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
                            || doc.title || '';
                        publishedDate = doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content')
                            || doc.querySelector('meta[name="publication_date"]')?.getAttribute('content') || '';
                    }
                } catch(e) {
                    console.warn('[SCRAPE] Failed to fetch original page:', e);
                }
            }

            // Fallback : extraction depuis le slug de l'URL
            const knownSiteNames = ['liberation.fr', 'le monde', 'le figaro'];
            if (!articleTitle || knownSiteNames.includes(articleTitle.toLowerCase().trim())) {
                try {
                    const urlObj = new URL(articleUrl);
                    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
                    let slug = pathSegments.pop() || '';
                    slug = slug.replace(/\.html?$/, '');
                    if (slug.includes('_')) slug = slug.split('_')[0];
                    articleTitle = slug.replace(/[-]/g, ' ').replace(/\s+\d{2,}\s*$/g, '').trim();
                } catch(e) {}
            }
        } else {
            // Mode recherche par mots-clés
            articleTitle = titleOrUrl;
        }

        // === Étape 2 : Construction de la requête ===
        const query = processTitleToQuery(articleTitle);
        if (!query) {
            throw new Error(`Impossible de construire des mots-clés depuis : « ${articleTitle} »`);
        }
        window.Scraper.lastQuery = query;
        console.log('[SCRAPE] Query:', query, '| Original title:', articleTitle);
        onProgress('Étape 2/5', `Recherche: "${query.substring(0, 40)}..."`, 25);

        // === Étape 3 : Token CSRF + soumission de la recherche avancée ===
        const parser = new DOMParser();
        const readingRes = await BnfLogin.httpRequest({
            url: `https://${EUROPRESSE_DOMAIN}/Search/Reading`,
            method: 'GET',
            headers: { 'Cookie': cookieHeader, 'User-Agent': UA }
        });

        const readDoc = parser.parseFromString(readingRes.data, 'text/html');
        const csrfToken = readDoc.querySelector('input[name="__RequestVerificationToken"]')?.value;
        if (!csrfToken) {
            throw new Error('Session BnF expirée. Veuillez vous reconnecter dans les paramètres.');
        }

        onProgress('Étape 3/5', 'Recherche sur Europresse...', 45);

        const dateFilter = calculateDateFilter(publishedDate);
        const searchBody = `Keywords=${encodeURIComponent(query)}` +
            `&CriteriaKeys[0].Operator=%26&CriteriaKeys[0].Key=TIT_HEAD&CriteriaKeys[0].Text=${encodeURIComponent(query)}` +
            `&CriteriaKeys[1].Operator=%26&CriteriaKeys[1].Key=LEAD&CriteriaKeys[1].Text=` +
            `&CriteriaKeys[2].Operator=%26&CriteriaKeys[2].Key=AUT_BY&CriteriaKeys[2].Text=` +
            `&sources=2&CriteriaSet=-1&sourcesFilter=` +
            `&PostedFilters.FiltersIDs=8001` +
            `&DateFilter.DateRange=${dateFilter}&DateFilter.DateStart=1970-01-01&DateFilter.DateStop=2050-01-01` +
            `&SourcesForm=2` +
            `&CriteriaExp[0].CriteriaName=Anglais&CriteriaExp[0].CriteriaId=2&CriteriaExp[0].OperatorId=2` +
            `&CriteriaExp[1].CriteriaName=Fran%C3%A7ais&CriteriaExp[1].CriteriaId=1&CriteriaExp[1].OperatorId=2` +
            `&__RequestVerificationToken=${csrfToken}`;

        await BnfLogin.httpRequest({
            url: `https://${EUROPRESSE_DOMAIN}/Search/AdvancedMobile`,
            method: 'POST',
            headers: { 'Cookie': cookieHeader, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
            body: searchBody
        });

        // === Étape 4 : Analyse des résultats ===
        onProgress('Étape 4/5', 'Analyse des résultats...', 60);

        let bestMatch = null;
        let maxSim = 0;

        for (let page = 0; page < 2; page++) {
            const listRes = await BnfLogin.httpRequest({
                url: `https://${EUROPRESSE_DOMAIN}/Search/GetPage?pageNo=${page}&docPerPage=50`,
                method: 'GET',
                headers: { 'Cookie': cookieHeader, 'User-Agent': UA }
            });

            if (!listRes.data || !listRes.data.trim()) break;

            const listDoc = parser.parseFromString(listRes.data, 'text/html');
            const items = listDoc.querySelectorAll('.docListItem');
            if (!items || items.length === 0) break;

            items.forEach(item => {
                const titleLink = item.querySelector('.docList-links');
                const docTitle = titleLink ? titleLink.textContent.trim() : '';
                const docId = item.querySelector('input[id="doc-name"]')?.value;
                const sourceName = item.querySelector('.source-name')?.textContent.trim() || '';

                if (docId && docTitle) {
                    const sim = calculateSimilarity(articleTitle, docTitle);
                    if (sim > maxSim) {
                        maxSim = sim;
                        bestMatch = { id: docId, title: docTitle, source: sourceName };
                    }
                }
            });

            if (maxSim >= 80) break;
        }

        // Retry avec recherche plein-texte si résultats insuffisants
        if (!bestMatch || maxSim < 30) {
            console.log('[SCRAPE] TIT_HEAD failed, retrying with TEXT strategy...');
            onProgress('Étape 4/5', 'Recherche élargie...', 65);

            const searchBody2 = searchBody.replace('CriteriaKeys[0].Key=TIT_HEAD', 'CriteriaKeys[0].Key=TEXT');
            await BnfLogin.httpRequest({
                url: `https://${EUROPRESSE_DOMAIN}/Search/AdvancedMobile`,
                method: 'POST',
                headers: { 'Cookie': cookieHeader, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
                body: searchBody2
            });

            const listRes2 = await BnfLogin.httpRequest({
                url: `https://${EUROPRESSE_DOMAIN}/Search/GetPage?pageNo=0&docPerPage=50`,
                method: 'GET',
                headers: { 'Cookie': cookieHeader, 'User-Agent': UA }
            });

            if (listRes2.data && listRes2.data.trim()) {
                const listDoc2 = parser.parseFromString(listRes2.data, 'text/html');
                listDoc2.querySelectorAll('.docListItem').forEach(item => {
                    const titleLink = item.querySelector('.docList-links');
                    const docTitle = titleLink ? titleLink.textContent.trim() : '';
                    const docId = item.querySelector('input[id="doc-name"]')?.value;
                    const sourceName = item.querySelector('.source-name')?.textContent.trim() || '';
                    if (docId && docTitle) {
                        const sim = calculateSimilarity(articleTitle, docTitle);
                        if (sim > maxSim) {
                            maxSim = sim;
                            bestMatch = { id: docId, title: docTitle, source: sourceName };
                        }
                    }
                });
            }
        }

        if (!bestMatch || maxSim < 20) {
            throw new Error(`Aucun article trouvé sur Europresse pour « ${articleTitle.substring(0, 60)} » (similarité max: ${maxSim}%).`);
        }

        console.log('[SCRAPE] Best match:', bestMatch.title, '| Similarity:', maxSim + '%');

        // === Étape 5 : Téléchargement du contenu ===
        onProgress('Étape 5/5', `Téléchargement (${maxSim}% match)...`, 80);

        const viewUrl = `https://${EUROPRESSE_DOMAIN}/Document/ViewMobile?docKey=${bestMatch.id}&fromBasket=false&viewEvent=1&invoiceCode=`;
        const docRes = await BnfLogin.httpRequest({
            url: viewUrl,
            method: 'GET',
            headers: { 'Cookie': cookieHeader, 'User-Agent': UA }
        });

        const docDoc = parser.parseFromString(docRes.data, 'text/html');
        const contentContainer = docDoc.querySelector('.docOcurrContainer');
        if (!contentContainer) {
            throw new Error("Contenu de l'article introuvable sur Europresse (.docOcurrContainer absent).");
        }

        const visTitle = docDoc.querySelector('.titreArticleVisu')?.innerHTML || bestMatch.title;
        const cleanTitle = removeHighlightTags(visTitle);
        const cleanContent = removeHighlightTags(contentContainer.innerHTML);

        // CSS d'impression injecté dans le HTML envoyé à printHtmlToPdf.
        // Permet à la WebView Android d'appliquer des styles propres au rendu PDF.
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

        const finalHtml = `<style>${PRINT_CSS}</style><h1>${cleanTitle}</h1>${cleanContent}`;

        return {
            html: finalHtml,
            title: bestMatch.title,
            source: bestMatch.source,
            url: articleUrl
        };
    }

    // Exposition globale
    global.Scraper = { scrapeArticle };

})(window);
