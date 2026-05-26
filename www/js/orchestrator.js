(function(global) {
    'use strict';

    const UA_FALLBACK = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

    // ─── Shared Utilities ───

    async function getUA() {
        try {
            if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
                const res = await window.Capacitor.Plugins.BnfLogin.getWebViewUserAgent();
                if (res && res.userAgent) return res.userAgent;
            }
        } catch (e) {}
        return UA_FALLBACK;
    }

    function processTitleToQuery(title) {
        if (!title) return null;
        let cleanTitle = title.split(/ - | \| | — | · /)[0];
        cleanTitle = cleanTitle.replace(/[''""'‘`]/g, ' ');
        cleanTitle = cleanTitle.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()…?–—«»]/g, ' ');
        const words = cleanTitle.toLowerCase().split(/\s+/).filter(Boolean);
        const filtered = [];
        const seen = new Set();
        const frenchStopwords = new Set([
            'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'en', 'et', 'au', 'aux',
            'ce', 'ces', 'cette', 'cet', 'mon', 'ton', 'son', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses',
            'nos', 'vos', 'notre', 'votre', 'leur', 'leurs',
            'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
            'me', 'te', 'se', 'y', 'moi', 'toi', 'soi', 'lui',
            'celui', 'celle', 'ceux', 'celles',
            'qui', 'que', 'quoi', 'dont', 'ou', 'où',
            'lequel', 'laquelle', 'lesquels', 'lesquelles',
            'quel', 'quelle', 'quels', 'quelles',
            'et', 'mais', 'donc', 'or', 'ni', 'car', 'si',
            'par', 'sur', 'dans', 'avec', 'sans', 'sous', 'pour', 'chez', 'vers',
            'depuis', 'pendant', 'devant', 'derrière', 'avant', 'après',
            'entre', 'comme', 'quand', 'pourquoi', 'comment',
            'est', 'ont', 'sont', 'suis', 'es', 'sommes', 'êtes',
            'ai', 'as', 'avez', 'avons', 'aura', 'auront', 'sera', 'seront',
            'était', 'étaient', 'avait', 'avaient', 'avoir', 'être', 'fait', 'faire',
            'ne', 'pas', 'plus', 'bien', 'ici', 'tout', 'tous', 'toute', 'toutes',
            'autre', 'autres', 'même', 'mêmes', 'qu'
        ]);
        for (const raw of words) {
            let cw = raw.replace(/[^\p{L}\d]/gu, '');
            if (!cw || cw.length <= 1 || frenchStopwords.has(cw)) continue;
            if (!seen.has(cw)) {
                seen.add(cw);
                filtered.push(cw);
            }
        }
        return filtered.length >= 1 ? filtered.join(' ') : null;
    }

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
     * Transforme une description (chapeau) en requête de recherche.
     * Nettoie, retire les mots vides et ne garde que les 15 premiers mots significatifs.
     */
    function processDescriptionToQuery(description) {
        if (!description) return null;

        // Remplacer les apostrophes par des espaces plutôt que de les supprimer directement
        let cleanDesc = description.replace(/[''""’‘`]/g, ' ');
        cleanDesc = cleanDesc.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()…?–—«»]/g, ' ');

        const words = cleanDesc.toLowerCase().split(/\s+/).filter(Boolean);
        const filtered = [];
        const seen = new Set();

        const frenchStopwords = new Set([
            // Articles & Déterminants
            'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'en', 'et', 'au', 'aux',
            'ce', 'ces', 'cette', 'cet', 'mon', 'ton', 'son', 'ma', 'ta', 'sa', 'mes', 'tes', 'ses',
            'nos', 'vos', 'notre', 'votre', 'leur', 'leurs',
            // Pronoms
            'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles',
            'me', 'te', 'se', 'y', 'moi', 'toi', 'soi', 'lui',
            'celui', 'celle', 'ceux', 'celles',
            'qui', 'que', 'quoi', 'dont', 'ou', 'où',
            'lequel', 'laquelle', 'lesquels', 'lesquelles',
            'quel', 'quelle', 'quels', 'quelles',
            // Conjonctions & Prépositions
            'et', 'mais', 'donc', 'or', 'ni', 'car', 'si',
            'par', 'sur', 'dans', 'avec', 'sans', 'sous', 'pour', 'chez', 'vers',
            'depuis', 'pendant', 'devant', 'derrière', 'avant', 'après',
            'entre', 'comme', 'quand', 'pourquoi', 'comment',
            // Auxiliaires & Verbes communs
            'est', 'ont', 'sont', 'suis', 'es', 'sommes', 'êtes',
            'ai', 'as', 'avez', 'avons', 'aura', 'auront', 'sera', 'seront',
            'était', 'étaient', 'avait', 'avaient', 'avoir', 'être', 'fait', 'faire',
            // Adverbes & divers
            'ne', 'pas', 'plus', 'bien', 'ici', 'tout', 'tous', 'toute', 'toutes',
            'autre', 'autres', 'même', 'mêmes', 'qu'
        ]);

        for (const raw of words) {
            let cw = raw.replace(/[^\p{L}\d]/gu, '');
            if (!cw || cw.length <= 1 || frenchStopwords.has(cw)) continue;

            if (!seen.has(cw)) {
                seen.add(cw);
                filtered.push(cw);
            }
        }

        if (filtered.length < 1) return null;

        return filtered.slice(0, 15).join(' ');
    }

    // ─── URL / Title Extraction ───

    let cachedTitle = null;
    let cachedDate = null;
    let cachedDescription = null;
    let cachedIsUrl = false;


    async function extractTitleFromUrl(url, fallbackTitle, state, onProgress) {
        if (cachedTitle !== null && cachedIsUrl === url.startsWith('http')) {
            return { title: cachedTitle, date: cachedDate, description: cachedDescription };
        }
        if (!url.startsWith('http')) {
            cachedTitle = url;
            cachedDate = '';
            cachedDescription = '';
            cachedIsUrl = false;
            return { title: cachedTitle, date: cachedDate, description: cachedDescription };
        }

        cachedIsUrl = true;
        onProgress('Scraper', 'Récupération du titre...', 10);
        let articleTitle = fallbackTitle || '';
        let publishedDate = '';
        let articleDescription = '';

        try {
            const UA = await getUA();
            const BnfLogin = window.Capacitor.Plugins.BnfLogin;
            const pageRes = await BnfLogin.httpRequest({
                url, method: 'GET',
                headers: { 'User-Agent': UA }
            });
            if (pageRes.status === 200 && pageRes.data) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(pageRes.data, 'text/html');
                if (!articleTitle) {
                    articleTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
                        || doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
                        || doc.title || '';
                }
                publishedDate = doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content')
                    || doc.querySelector('meta[name="publication_date"]')?.getAttribute('content') || '';
                articleDescription = doc.querySelector('meta[property="og:description"]')?.getAttribute('content')
                    || doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content')
                    || doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            }
        } catch (e) {
            console.warn('[ORCH] Failed to fetch original page:', e);
        }

        const knownSiteNames = ['liberation.fr', 'le monde', 'le figaro'];
        if (!articleTitle || knownSiteNames.includes(articleTitle.toLowerCase().trim())) {
            try {
                const urlObj = new URL(url);
                const pathSegments = urlObj.pathname.split('/').filter(Boolean);
                let slug = pathSegments.pop() || '';
                slug = slug.replace(/\.html?$/, '');
                if (slug.includes('_')) slug = slug.split('_')[0];
                articleTitle = slug.replace(/[-]/g, ' ').replace(/\s+\d{2,}\s*$/g, '').trim();
            } catch (e) {}
        }

        cachedTitle = articleTitle;
        cachedDate = publishedDate;
        cachedDescription = articleDescription;
        return { title: cachedTitle, date: cachedDate, description: cachedDescription };
    }

    // ─── Retry helpers (for search) ───

    async function retrySearch(searchFn, query) {
        let items = [];
        try {
            items = await searchFn(query);
        } catch (e) {
            console.warn('[ORCH] Search failed with full query, will try shortened:', e.message);
        }

        const words = query.split(/\s+/);

        // Étape 2 : Réessai avec 15 mots si la requête initiale était plus longue
        if ((!items || items.length === 0) && words.length > 15) {
            const query15 = words.slice(0, 15).join(' ');
            console.log('[ORCH] Retry with 15-word query:', query15);
            try {
                items = await searchFn(query15);
            } catch (e) {
                console.warn('[ORCH] Search failed with 15-word query:', e.message);
            }
        }

        // Étape 3 : Réessai avec 5 mots si toujours aucun résultat
        if ((!items || items.length === 0) && words.length > 5) {
            const query5 = words.slice(0, 5).join(' ');
            console.log('[ORCH] Retry with 5-word query:', query5);
            try {
                items = await searchFn(query5);
            } catch (e) {
                console.warn('[ORCH] Search failed with 5-word query:', e.message);
            }
        }

        // Étape 4 : Réessai sans élisions
        if (!items || items.length === 0) {
            const filteredWords = words.filter(w => !/^l[aeiouyéàèùâêîôûëïü]/i.test(w));
            if (filteredWords.length > 0 && filteredWords.length < words.length) {
                const elisionFreeQuery = filteredWords.slice(0, 5).join(' ');
                console.log('[ORCH] Retry without elisions (5 words):', elisionFreeQuery);
                try {
                    items = await searchFn(elisionFreeQuery);
                } catch (e) {
                    console.warn('[ORCH] Search failed without elisions:', e.message);
                }
            }
        }
        return items;
    }

    function findBestMatch(items, originalTitle, titleField = 'title') {
        let bestMatch = null;
        let maxSim = 0;
        (items || []).forEach(item => {
            const itemTitle = item[titleField] || '';
            if (itemTitle) {
                const sim = calculateSimilarity(originalTitle, itemTitle);
                if (sim > maxSim) { maxSim = sim; bestMatch = item; }
            }
        });
        return { bestMatch, maxSim };
    }

    // ─── Main Orchestrator ───

    /**
     * Main entry point for scraping.
     * Accepts the same interface as the old Scraper.scrapeArticle.
     */
    async function scrapeArticle(titleOrUrl, fallbackTitle, state, onProgress) {
        cachedTitle = null;
        cachedDate = null;
        const isUrl = titleOrUrl.startsWith('http');
        const UA = await getUA();

        // Build prioritized list of (connector, service) pairs from registry
        const providerOrder = state.providerOrder || ['bpc', 'pressreader', 'cafeyn', 'bnf', 'bnf-proxy'];
        const providerEnabled = state.providerEnabled || {};

        // Map provider IDs to registry pair IDs
        const idMap = {
            'bpc': 'bpc',
            'pressreader': 'pressreader',
            'cafeyn': 'cafeyn',
            'bnf': 'bnf',
            'bnf-proxy': 'bnf-proxy'
        };

        const pairs = providerOrder
            .filter(k => providerEnabled[k] !== false)
            .map(k => idMap[k])
            .filter(Boolean)
            .map(id => global.Registry.getPair(id))
            .filter(Boolean);

        if (pairs.length === 0) {
            throw new Error('Aucun fournisseur activé. Vérifiez vos paramètres.');
        }

        let lastError = null;

        for (const pair of pairs) {
            const { id, name, connector, service } = pair;
            console.log(`[ORCH] Trying pair: ${id} (connector: ${connector?.id}, service: ${service.id})`);

            // ── Check connector readiness ──
            if (connector && !connector.isReady(state)) {
                console.log(`[ORCH] Connector ${connector.id} not ready, skipping`);
                continue;
            }

            // ── Get auth headers from connector ──
            let authHeaders = { 'User-Agent': UA };
            if (connector) {
                try {
                    const h = await connector.getAuthHeaders(state);
                    if (h) Object.assign(authHeaders, h);
                } catch (e) {
                    console.warn(`[ORCH] Connector ${connector.id} getAuthHeaders failed:`, e);
                }
            }

            // ── Try service ──
            try {
                // Service-specific dispatch based on service.id
                let result = null;

                if (service.id === 'bpc') {
                    if (!isUrl) continue;
                    onProgress('Bypass Direct', 'Bypass direct...', 10);
                    result = await service.fetchByUrl(titleOrUrl, authHeaders, onProgress);
                    if (result) return result;
                    continue;
                }

                if (service.id === 'bnf-proxy') {
                    if (!isUrl) continue;
                    if (!service.supportsUrl(titleOrUrl)) continue;
                    onProgress('BnF Proxy', `Accès BnF...`, 10);
                    try {
                        result = await service.fetchByUrl(titleOrUrl, authHeaders, onProgress);
                        if (result) return result;
                    } catch (bnfErr) {
                        if (bnfErr.message && bnfErr.message.includes('Session BnF expirée')) {
                            throw bnfErr;
                        }
                        console.warn('[ORCH] BnF Proxy failed:', bnfErr.message);
                    }
                    continue;
                }

                if (service.id === 'pressreader') {
                    onProgress('PressReader', 'Authentification...', 10);
                    let articleId = null;
                    if (isUrl) {
                        articleId = PressReader.extractArticleIdFromUrl(titleOrUrl);
                    }

                    if (articleId) {
                        onProgress('PressReader', 'Téléchargement...', 40);
                        const referer = state.pressReaderReferer || 'https://mabm.toulouse-metropole.fr/default/presse.aspx?_lg=fr-FR';
                        const article = await service.fetchArticle(articleId, referer, UA);
                        const finalHtml = PressReader.articleToHtml(article);
                        onProgress('PressReader', 'Succès !', 95);
                        return {
                            html: finalHtml,
                            title: article.title || fallbackTitle || 'Article PressReader',
                            source: article.issue?.newspaper?.name || 'PressReader',
                            url: titleOrUrl,
                            publishedDate: article.date || article.issue?.date || '',
                            author: article.author || '',
                            publication: article.issue?.newspaper?.name || '',
                            serviceUsed: 'PressReader'
                        };
                    } else {
                        const { title: extractedTitle, description: extractedDescription } = await extractTitleFromUrl(titleOrUrl, fallbackTitle, state, onProgress);
                        if (!extractedTitle) continue;
                        const query = processTitleToQuery(extractedTitle) || extractedTitle;
                        const referer = state.pressReaderReferer || 'https://mabm.toulouse-metropole.fr/default/presse.aspx?_lg=fr-FR';

                        onProgress('PressReader', `Recherche: "${query.substring(0, 40)}..."`, 30);
                        let items = await retrySearch(
                            (q) => service.search(q, referer, UA),
                            query
                        );

                        let bestMatch = null;
                        let maxSim = 0;
                        if (isUrl && items && items.length > 0) {
                            const match = findBestMatch(items, extractedTitle);
                            bestMatch = match.bestMatch;
                            maxSim = match.maxSim;
                        }

                        let matchedByDescription = false;
                        if ((!bestMatch || maxSim < 35) && isUrl) {
                            const descQuery = processDescriptionToQuery(extractedDescription);
                            if (descQuery) {
                                onProgress('PressReader', `Recherche par description: "${descQuery.substring(0, 40)}..."`, 35);
                                console.log('[PressReader] Retrying search with description query:', descQuery);
                                const descItems = await retrySearch(
                                    (q) => service.search(q, referer, UA),
                                    descQuery
                                );
                                if (descItems && descItems.length > 0) {
                                    const descMatch = findBestMatch(descItems, extractedTitle);
                                    if (descMatch.maxSim >= maxSim) {
                                        bestMatch = descMatch.bestMatch;
                                        maxSim = descMatch.maxSim;
                                        matchedByDescription = true;
                                    }
                                }
                            }
                        }

                        if (!bestMatch) continue;

                        if (isUrl) {
                            const minSim = matchedByDescription ? 15 : 35;
                            if (maxSim < minSim) {
                                console.warn(`[PressReader] Similarité insuffisante: ${maxSim}%`);
                                continue;
                            }
                        } else {
                            bestMatch = items[0];
                            maxSim = 100;
                        }

                        onProgress('PressReader', `Meilleur match (${maxSim}%)`, 70);
                        const article = await service.fetchArticle(bestMatch.id, referer, UA);
                        const finalHtml = PressReader.articleToHtml(article);
                        onProgress('PressReader', 'Succès !', 95);
                        return {
                            html: finalHtml,
                            title: article.title || bestMatch.title || extractedTitle,
                            source: article.issue?.newspaper?.name || bestMatch.publication?.name || 'PressReader',
                            url: isUrl ? titleOrUrl : `https://www.pressreader.com/article/${bestMatch.id}`,
                            publishedDate: article.date || article.issue?.date || '',
                            author: article.author || '',
                            publication: article.issue?.newspaper?.name || bestMatch.publication?.name || '',
                            serviceUsed: 'PressReader'
                        };
                    }
                }

                if (service.id === 'cafeyn') {
                    if (!window.CafeynService) continue;
                    if (!window.CafeynService.isTokenValid()) {
                        if (connector && typeof connector.refresh === 'function' && (state.cafeynUsername && state.cafeynPassword || state.cafeynJwt)) {
                            try {
                                console.log('[ORCH] Cafeyn token invalid, attempting automatic refresh/login...');
                                onProgress('Cafeyn', 'Reconnexion automatique...', 5);
                                const refreshRes = await connector.refresh(state);
                                if (refreshRes && refreshRes.jwt) {
                                    state.cafeynJwt = refreshRes.jwt;
                                }
                            } catch (refreshErr) {
                                console.warn('[ORCH] Cafeyn auto-refresh failed:', refreshErr.message);
                            }
                        }
                    }
                    if (!window.CafeynService.isTokenValid()) {
                        console.log('[ORCH] Cafeyn token is still invalid, skipping Cafeyn');
                        continue;
                    }
                    onProgress('Cafeyn', 'Récupération via Cafeyn...', 10);

                    let slug = null;
                    if (isUrl) {
                        slug = window.CafeynService.extractSlugFromUrl(titleOrUrl);
                    }

                    if (slug) {
                        onProgress('Cafeyn', 'Téléchargement...', 40);
                        const details = await window.CafeynService.fetchArticle(slug);
                        const finalHtml = window.CafeynService.articleToHtml(details);
                        onProgress('Cafeyn', 'Succès !', 95);
                        return {
                            html: finalHtml,
                            title: details.title || fallbackTitle || '',
                            source: details.publicationName || 'Cafeyn',
                            url: titleOrUrl,
                            publishedDate: details.isoReleaseDate || '',
                            author: details.authors?.map(a => a.name).join(', ') || details.author || '',
                            publication: details.publicationName || '',
                            serviceUsed: 'Cafeyn'
                        };
                    } else {
                        const { title: extractedTitle, description: extractedDescription } = await extractTitleFromUrl(titleOrUrl, fallbackTitle, state, onProgress);
                        if (!extractedTitle) continue;
                        const query = processTitleToQuery(extractedTitle) || extractedTitle;

                        onProgress('Cafeyn', `Recherche: "${query.substring(0, 40)}..."`, 30);
                        let searchRes = await retrySearch(
                            (q) => window.CafeynService.search(q).then(r => r.articles?.collection || []),
                            query
                        );

                        let bestMatch = null;
                        let maxSim = 0;
                        if (isUrl && searchRes && searchRes.length > 0) {
                            const match = findBestMatch(searchRes, extractedTitle);
                            bestMatch = match.bestMatch;
                            maxSim = match.maxSim;
                        }

                        let matchedByDescription = false;
                        if ((!bestMatch || maxSim < 35) && isUrl) {
                            const descQuery = processDescriptionToQuery(extractedDescription);
                            if (descQuery) {
                                onProgress('Cafeyn', `Recherche par description: "${descQuery.substring(0, 40)}..."`, 35);
                                console.log('[Cafeyn] Retrying search with description query:', descQuery);
                                const descRes = await retrySearch(
                                    (q) => window.CafeynService.search(q).then(r => r.articles?.collection || []),
                                    descQuery
                                );
                                if (descRes && descRes.length > 0) {
                                    const descMatch = findBestMatch(descRes, extractedTitle);
                                    if (descMatch.maxSim >= maxSim) {
                                        bestMatch = descMatch.bestMatch;
                                        maxSim = descMatch.maxSim;
                                        matchedByDescription = true;
                                    }
                                }
                            }
                        }

                        if (!bestMatch) continue;

                        if (isUrl) {
                            const minSim = matchedByDescription ? 15 : 35;
                            if (maxSim < minSim) {
                                console.warn(`[Cafeyn] Similarité insuffisante: ${maxSim}%`);
                                continue;
                            }
                        } else {
                            bestMatch = searchRes[0];
                            maxSim = 100;
                        }

                        onProgress('Cafeyn', `Meilleur match (${maxSim}%)`, 70);
                        const details = await window.CafeynService.fetchArticle(bestMatch.formattedUrl);
                        const finalHtml = window.CafeynService.articleToHtml(details);
                        onProgress('Cafeyn', 'Succès !', 95);
                        return {
                            html: finalHtml,
                            title: details.title || fallbackTitle || '',
                            source: details.publicationName || 'Cafeyn',
                            url: titleOrUrl,
                            publishedDate: details.isoReleaseDate || '',
                            author: details.authors?.map(a => a.name).join(', ') || details.author || '',
                            publication: details.publicationName || '',
                            serviceUsed: 'Cafeyn'
                        };
                    }
                }

                if (service.id === 'europresse') {
                    const hasBnfSession = !!(state.bnfCookiesHeader || state.bnfUsername);
                    if (!hasBnfSession) {
                        console.log('[ORCH] BnF session not available, skipping Europresse');
                        continue;
                    }

                    const { title: extractedTitle, date: publishedDate, description: extractedDescription } = await extractTitleFromUrl(titleOrUrl, fallbackTitle, state, onProgress);
                    if (!extractedTitle) continue;
                    const query = processTitleToQuery(extractedTitle);
                    if (!query) continue;
                    if (global.Scraper) global.Scraper.lastQuery = query;

                    onProgress('BnF Europresse', `Recherche: "${query.substring(0, 40)}..."`, 25);
                    let results = await service.search(query, authHeaders, onProgress);

                    let matchedByDescription = false;
                    let bestMatch = null;
                    let maxSim = 0;
                    if (isUrl) {
                        if (results && results.length > 0) {
                            const match = findBestMatch(results, extractedTitle);
                            bestMatch = match.bestMatch;
                            maxSim = match.maxSim;
                        }

                        if ((!bestMatch || maxSim < 20) && isUrl) {
                            const descQuery = processDescriptionToQuery(extractedDescription);
                            if (descQuery) {
                                console.log('[ORCH] Retrying search with description strategy on Europresse...', descQuery);
                                onProgress('BnF Europresse', 'Recherche par description...', 68);
                                results = await service.search(descQuery, authHeaders, onProgress);
                                if (results && results.length > 0) {
                                    const descMatch = findBestMatch(results, extractedTitle);
                                    if (descMatch.maxSim >= maxSim) {
                                        bestMatch = descMatch.bestMatch;
                                        maxSim = descMatch.maxSim;
                                        matchedByDescription = true;
                                    }
                                }
                            }
                        }

                        const minSim = matchedByDescription ? 15 : 20;
                        if (!bestMatch || maxSim < minSim) {
                            console.warn(`[Europresse] Similarité insuffisante: ${maxSim}%`);
                            continue;
                        }
                    } else {
                        bestMatch = results[0];
                        maxSim = 100;
                    }

                    onProgress('BnF Europresse', `Meilleur match (${maxSim}%)`, 70);
                    const article = await service.fetchArticle(bestMatch.id, authHeaders, onProgress);
                    if (!article) continue;

                    article.url = isUrl ? titleOrUrl : '';
                    onProgress('BnF Europresse', 'Succès !', 95);
                    return article;
                }

            } catch (err) {
                console.warn(`[ORCH] Pair ${id} failed:`, err.message);
                lastError = err;
                // If session expired, propagate immediately
                if (err.message && err.message.includes('Session BnF expirée')) {
                    throw err;
                }
                // Try next pair
            }
        }

        // All pairs exhausted — build error message
        const { title: finalTitle, date: finalDate } = await extractTitleFromUrl(titleOrUrl, fallbackTitle, state, onProgress);
        let errorMsg = "Aucun fournisseur n'a pu récupérer cet article.";
        if (finalTitle) errorMsg += ` Termes recherchés : "${finalTitle.substring(0, 60)}".`;
        if (finalDate) {
            try {
                const pubDate = new Date(finalDate);
                const diffHours = (Date.now() - pubDate.getTime()) / 3600000;
                if (diffHours < 24) {
                    errorMsg += " L'article vient d'être publié (moins de 24h). Réessayez dans quelques heures.";
                } else {
                    errorMsg += ` Date de publication : ${pubDate.toLocaleDateString('fr-FR')}.`;
                }
            } catch(e) {}
        }
        errorMsg += " Vérifiez votre configuration et vos sessions.";
        throw new Error(errorMsg);
    }

    // ─── Old Scraper compatibility ───
    if (!global.Scraper) global.Scraper = {};

    // Save old initBpc (from scraper.js) before overriding
    if (typeof global.Scraper._oldInitBpc === 'undefined') {
        global.Scraper._oldInitBpc = global.Scraper.initBpc;
    }

    // Override: new orchestrator-based scrapeArticle
    global.Scraper.scrapeArticle = scrapeArticle;

    // initBpc must propagate to BpcService (used by orchestrator for BPC)
    global.Scraper.initBpc = async function() {
        if (global.Scraper._oldInitBpc) await global.Scraper._oldInitBpc();
        if (global.BpcService && global.BpcService.reinit) await global.BpcService.reinit();
    };

    // Expose the orchestrator directly
    global.Orchestrator = {
        scrapeArticle,
        getUA,
        processTitleToQuery,
        calculateSimilarity
    };

})(window);
