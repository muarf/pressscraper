(function(global) {
    'use strict';

    const EUROPRESSE_DOMAIN = 'nouveau-europresse-com.bnf.idm.oclc.org';

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
        if (filtered.length < 1) return null;
        return filtered.join(' ');
    }

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
        } catch (e) { return '9'; }
    }

    function parseFrenchDate(dateStr) {
        if (!dateStr) return '';
        if (!isNaN(Date.parse(dateStr))) return dateStr;
        
        const months = {
            'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04', 'mai': '05', 'juin': '06',
            'juillet': '07', 'août': '08', 'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12'
        };
        const cleanStr = dateStr.toLowerCase().replace(/[.,]/g, '').trim();
        const parts = cleanStr.split(/\s+/);
        
        let day = '', month = '', year = '';
        for (const part of parts) {
            if (/^\d{1,2}$/.test(part)) {
                day = part.padStart(2, '0');
            } else if (months[part]) {
                month = months[part];
            } else if (/^\d{4}$/.test(part)) {
                year = part;
            }
        }
        
        if (day && month && year) {
            return `${year}-${month}-${day}T12:00:00Z`;
        }
        return dateStr;
    }

    function removeHighlightTags(html) {
        if (!html) return html;
        try {
            const parser = new DOMParser();
            const tempDoc = parser.parseFromString(html, 'text/html');
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
            tempDoc.querySelectorAll('.hlterms').forEach(el => el.classList.remove('hlterms'));
            return tempDoc.body.innerHTML;
        } catch (e) {
            console.error('[EUROPRESSE] Error removing highlights:', e);
            return html;
        }
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

    const EuropresseService = {
        id: 'europresse',
        name: 'Europresse',

        /**
         * Search Europresse for an article by title/query.
         * Returns the first page of results or null.
         */
        async search(query, authHeaders, onProgress) {
            const BnfLogin = window.Capacitor.Plugins.BnfLogin;
            const cookieHeader = authHeaders?.['Cookie'] || '';
            const UA = authHeaders?.['User-Agent'] || '';

            const parser = new DOMParser();

            onProgress('Europresse', 'Récupération du formulaire de recherche...', 25);
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

            const dateFilter = calculateDateFilter('');
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

            onProgress('Europresse', 'Analyse des résultats...', 60);
            const listRes = await BnfLogin.httpRequest({
                url: `https://${EUROPRESSE_DOMAIN}/Search/GetPage?pageNo=0&docPerPage=50`,
                method: 'GET',
                headers: { 'Cookie': cookieHeader, 'User-Agent': UA }
            });
            if (!listRes.data || !listRes.data.trim()) return null;
            const listDoc = parser.parseFromString(listRes.data, 'text/html');
            const items = listDoc.querySelectorAll('.docListItem');
            if (!items || items.length === 0) return null;

            const results = [];
            items.forEach(item => {
                const titleLink = item.querySelector('.docList-links');
                const docTitle = titleLink ? titleLink.textContent.trim() : '';
                const docId = item.querySelector('input[id="doc-name"]')?.value;
                const sourceName = item.querySelector('.source-name')?.textContent.trim() || '';
                if (docId && docTitle) {
                    results.push({ id: docId, title: docTitle, source: sourceName });
                }
            });

            if (results.length === 0) {
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
                            results.push({ id: docId, title: docTitle, source: sourceName });
                        }
                    });
                }
            }

            return results.length > 0 ? results : null;
        },

        /**
         * Fetch a full article from Europresse by document ID.
         */
        async fetchArticle(articleId, authHeaders, onProgress) {
            const BnfLogin = window.Capacitor.Plugins.BnfLogin;
            const cookieHeader = authHeaders?.['Cookie'] || '';
            const UA = authHeaders?.['User-Agent'] || '';
            const parser = new DOMParser();

            onProgress('Europresse', 'Téléchargement de l\'article...', 80);
            const viewUrl = `https://${EUROPRESSE_DOMAIN}/Document/ViewMobile?docKey=${articleId}&fromBasket=false&viewEvent=1&invoiceCode=`;
            const docRes = await BnfLogin.httpRequest({
                url: viewUrl,
                method: 'GET',
                headers: { 'Cookie': cookieHeader, 'User-Agent': UA }
            });
            const docDoc = parser.parseFromString(docRes.data, 'text/html');
            const contentContainer = docDoc.querySelector('.docOcurrContainer');
            if (!contentContainer) return null;

            const visTitle = docDoc.querySelector('.titreArticleVisu')?.innerHTML || '';
            const cleanTitle = removeHighlightTags(visTitle);
            const cleanContent = removeHighlightTags(contentContainer.innerHTML);
            const finalHtml = `<style>${window.PRINT_CSS}</style><h1>${cleanTitle}</h1>${cleanContent}`;

            let bnfDate = docDoc.querySelector('.dateTimeArticleVisu')?.textContent?.trim()
                || docDoc.querySelector('meta[name="citation_date"]')?.getAttribute('content') || '';

            // Fallback : extraire la date du docKey si présent au format news·YYYYMMDD·...
            if (!bnfDate && articleId) {
                const dateMatch = articleId.match(/^news·(\d{8})·/i);
                if (dateMatch) {
                    const rawDate = dateMatch[1];
                    const y = rawDate.substring(0, 4);
                    const m = rawDate.substring(4, 6);
                    const d = rawDate.substring(6, 8);
                    bnfDate = `${y}-${m}-${d}T12:00:00Z`;
                }
            }

            if (bnfDate) {
                bnfDate = parseFrenchDate(bnfDate);
            }

            const bnfAuthor = docDoc.querySelector('.auteurArticleVisu')?.textContent?.trim()
                || docDoc.querySelector('meta[name="citation_author"]')?.getAttribute('content') || '';
            const bnfSource = docDoc.querySelector('.sourceArticleVisu')?.textContent?.trim() || '';

            return {
                html: finalHtml,
                title: cleanTitle,
                source: bnfSource,
                publishedDate: bnfDate,
                author: bnfAuthor,
                publication: bnfSource,
                serviceUsed: 'BnF Europresse'
            };
        },

        /**
         * Search for the best matching article, then fetch it.
         * Returns the unified result object or null.
         */
        async searchAndFetch(query, authHeaders, originalTitle, onProgress) {
            onProgress('Europresse', 'Recherche sur Europresse...', 25);
            const results = await this.search(query, authHeaders, onProgress);
            if (!results || results.length === 0) return null;

            let bestMatch = null;
            let maxSim = 0;
            results.forEach(item => {
                const sim = calculateSimilarity(originalTitle, item.title);
                if (sim > maxSim) {
                    maxSim = sim;
                    bestMatch = item;
                }
            });

            if (!bestMatch || maxSim < 20) {
                console.warn('[Europresse] Aucun article avec une similarité suffisante (maxSim: ' + maxSim + '%)');
                return null;
            }

            onProgress('Europresse', 'Meilleur match trouvé (' + maxSim + '%)', 75);
            const article = await this.fetchArticle(bestMatch.id, authHeaders, onProgress);
            if (!article) return null;

            article.url = '';
            return article;
        }
    };

    global.EuropresseService = EuropresseService;

})(window);
