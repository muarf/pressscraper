/**
 * scraper.js — Moteur de scraping client-side pour Presse Scraper
 *
 * Expose: Scraper.scrapeArticle(titleOrUrl, fallbackTitle, state)
 *
 * Dépendances:
 *   - window.Capacitor.Plugins.BnfLogin (plugin natif Android)
 */
(function (global) {
    'use strict';

    const EUROPRESSE_DOMAIN = 'nouveau-europresse-com.bnf.idm.oclc.org';
    // UA de secours utilisé si le plugin natif n'est pas disponible (tests navigateur)
    const UA_FALLBACK = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

    // CSS pour le rendu PDF et la visionneuse
    global.PRINT_CSS = `
        @page { margin: 15mm 20mm; size: A4; }
        @media print {
            body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.6; color: #000; background: #fff; padding: 0; margin: 0; }
            h1 { font-size: 18pt; font-weight: bold; margin-bottom: 12pt; line-height: 1.3; border-bottom: 1px solid #ccc; padding-bottom: 8pt; page-break-after: avoid; }
            p, li, blockquote, figure { page-break-inside: avoid; orphans: 3; widows: 3; }
            img { max-width: 100%; page-break-inside: avoid; }
            a::after { content: ""; }
        }
    `;

    // ===== BnF PROXY CONFIG =====
    // Correspondances : domaine original → sous-domaine EZProxy BnF
    const BNF_PROXY_SITES = [
        {
            // Mediapart
            domains: ['mediapart.fr', 'www.mediapart.fr'],
            proxyHost: 'www-mediapart-fr.bnf.idm.oclc.org',
            name: 'Mediapart',
            contentSelector: '.paywall-restricted-content, .news__body__center__article, .content-article, .article__content, [data-module="article-body"], .article-body',
            paywallSelector: '#paywall, .paywall, .register-wall, .subscribe'
        },
        {
            // Arrêt sur Images
            domains: ['arretsurimages.net', 'www.arretsurimages.net'],
            proxyHost: 'www-arretsurimages-net.bnf.idm.oclc.org',
            name: 'Arrêt sur Images',
            contentSelector: '.page-content, .article-content, .entry-content, .post-content, article .content, [class*="article-body"]',
            paywallSelector: '.paywall-block.paywall-callToAction, .paywall, #paywall, .subscribe-wall'
        }
    ];

    /**
     * Retourne la config BnF proxy si l'URL correspond à un site supporté,
     * qu'il s'agisse de l'URL originale ou d'une URL déjà proxifiée.
     * @param {string} url
     * @returns {{ proxyHost, name, contentSelector, paywallSelector, proxyUrl } | null}
     */
    function getBnfProxySiteConfig(url) {
        try {
            const urlObj = new URL(url);
            const hostname = urlObj.hostname;

            for (const site of BNF_PROXY_SITES) {
                // Cas 1 : URL originale (ex: www.mediapart.fr)
                if (site.domains.includes(hostname)) {
                    // Convertir en URL proxy : même chemin sur le proxyHost
                    const proxyUrl = `https://${site.proxyHost}${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
                    return { ...site, proxyUrl };
                }
                // Cas 2 : URL déjà proxifiée (ex: www-mediapart-fr.bnf.idm.oclc.org)
                if (hostname === site.proxyHost) {
                    return { ...site, proxyUrl: url };
                }
            }
        } catch (e) {/* URL invalide */ }
        return null;
    }

    /**
     * Scrape un article via la session BnF EZProxy active.
     * Le cookie ezproxy est automatiquement injecté par la couche native Java
     * (CookieManager partagé) pour tous les sous-domaines *.bnf.idm.oclc.org.
     *
     * @param {string} proxyUrl  — URL complète sur le domaine BnF proxy
     * @param {object} siteConfig — Config du site BnF (name, contentSelector, paywallSelector)
     * @param {string} cookieHeader — Cookies Europresse/BnF pour l'authentification JS
     * @param {string} UA — User-Agent
     * @param {function} onProgress — Callback de progression
     * @returns {Promise<{html, title, source, url}>}
     */
    async function scrapeBnfProxy(proxyUrl, originalUrl, siteConfig, cookieHeader, UA, onProgress) {
        const BnfLogin = window.Capacitor.Plugins.BnfLogin;
        onProgress('BnF Proxy', `Téléchargement via BnF (${siteConfig.name})...`, 15);

        // ── Authentification / Initialisation spécifique des sessions proxy ──
        if (siteConfig.name === 'Arrêt sur Images') {
            onProgress('BnF Proxy', 'Authentification Arrêt sur Images...', 20);
            try {
                const autologinRes = await BnfLogin.httpRequest({
                    url: 'https://bnf.idm.oclc.org/login?url=https://www.arretsurimages.net/autologin.php',
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
                        let type = 'articles';
                        let slug = '';
                        try {
                            const urlObj = new URL(originalUrl || proxyUrl);
                            const pathSegments = urlObj.pathname.split('/').filter(Boolean);
                            if (pathSegments.length >= 2) {
                                type = pathSegments[0];
                                slug = pathSegments[pathSegments.length - 1];
                            } else {
                                slug = pathSegments[0] || '';
                            }
                        } catch (e) { }

                        if (slug) {
                            onProgress('BnF Proxy', 'Récupération via l\'API...', 40);
                            const apiUrl = `https://api-arretsurimages-net.bnf.idm.oclc.org/api/public/contents/${type}/${slug}?access_token=${token}`;
                            const apiRes = await BnfLogin.httpRequest({
                                url: apiUrl,
                                method: 'GET',
                                headers: {
                                    'User-Agent': UA,
                                    'Cookie': cookieHeader
                                }
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
                                        url: originalUrl || proxyUrl,
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
                console.warn('[BnF Proxy] Échec de la récupération Arrêt sur Images via API, repli sur le scrap standard :', err);
            }
        } else if (siteConfig.name === 'Mediapart') {
            onProgress('BnF Proxy', 'Activation de la licence Mediapart...', 20);
            try {
                // Initialise la session de licence sur Mediapart en suivant les redirections
                await BnfLogin.httpRequest({
                    url: 'https://bnf.idm.oclc.org/login?url=https://www.mediapart.fr/licence',
                    method: 'GET',
                    headers: {
                        'User-Agent': UA,
                        'Cookie': cookieHeader,
                        'Referer': 'https://www.google.com/'
                    }
                });
            } catch (err) {
                console.warn('[BnF Proxy] Échec d\'activation de la licence Mediapart :', err);
            }
        }

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
        if (pageRes.status >= 400) {
            throw new Error(`[BnF Proxy] HTTP ${pageRes.status} pour ${proxyUrl}`);
        }

        const html = pageRes.data || '';

        // ── Détection de la page de login BnF (session expirée) ──
        // IMPORTANT : l'EZProxy injecte dans TOUTES les pages proxifiées une barre
        // de navigation contenant un lien de déconnexion du type :
        //   https://bnf.idm.oclc.org/login?action=logout&...
        // Donc on ne peut PAS détecter la session expirée avec une simple recherche
        // de chaîne sur 'bnf.idm.oclc.org/login' — ça génère des faux positifs.
        //
        // La vraie page de login BnF contient des <input> réels nommés j_username
        // et j_password. On parse d'abord le DOM pour une détection précise.
        onProgress('BnF Proxy', 'Extraction du contenu...', 50);

        // ── Parsing DOM ──
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Détecter la vraie page de login BnF/OCLC par des marqueurs SPÉCIFIQUES à OCLC.
        // Les sites comme Mediapart ont leurs propres formulaires de login dans les pages
        // d'articles — on ne peut donc pas chercher des noms génériques comme "username".
        // On cherche uniquement les champs nommés j_username/j_password (propres à OCLC)
        // ou une action de formulaire pointant vers idm.oclc.org.
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

        console.log('[BnF Proxy] Login page check — title:', doc.title, '| isLoginPage:', isLoginPage);

        if (isLoginPage) {
            throw new Error('Session BnF expirée. Veuillez vous reconnecter dans les paramètres.');
        }

        onProgress('BnF Proxy', 'Extraction du contenu...', 60);

        // Récupération du titre
        const pageTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
            || doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
            || doc.title
            || siteConfig.name;

        // Recherche du bloc de contenu
        let contentEl = null;
        const selectors = siteConfig.contentSelector.split(',').map(s => s.trim());
        for (const sel of selectors) {
            contentEl = doc.querySelector(sel);
            if (contentEl) break;
        }
        // Fallback générique
        if (!contentEl) {
            contentEl = doc.querySelector('article')
                || doc.querySelector('[itemprop="articleBody"]')
                || doc.querySelector('.article-body')
                || doc.querySelector('.article')
                || doc.body;
        }

        // ── Validation : vérifier que le paywall n'est pas encore actif ──
        const paywallEl = doc.querySelector(siteConfig.paywallSelector);
        const textLength = contentEl ? contentEl.textContent.trim().length : 0;
        console.log(`[BnF Proxy] ${siteConfig.name} — textLength: ${textLength}, hasPaywall: ${!!paywallEl}`);

        if (paywallEl && textLength < 800) {
            // Probablement non authentifié ou accès refusé
            throw new Error(`[BnF Proxy] Paywall encore actif sur ${siteConfig.name}. Vérifiez que votre session BnF donne accès à ce titre.`);
        }

        // ── Nettoyage : supprimer les éléments parasites ──
        if (contentEl) {
            // Supprimer les widgets d'inscription/abonnement résiduels
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
            url: originalUrl || proxyUrl,
            publishedDate: doc.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || '',
            author: doc.querySelector('meta[name="author"]')?.getAttribute('content') || doc.querySelector('meta[property="article:author"]')?.getAttribute('content') || '',
            publication: siteConfig.name,
            serviceUsed: 'BnF Europresse'
        };
    }

    // ===== BPC STATE & CONFIG =====
    let bpcSites = null;
    let bpcScript = null;
    let bpcScriptFr = null;
    let bpcPurify = null;

    /**
     * Évalue sites.js dans un Web Worker pour sandboxer l'exécution.
     * Le worker n'a pas accès à window, document, localStorage.
     */
    async function evalSitesDataInWorker(sitesData) {
        return new Promise((resolve, reject) => {
            const worker = new Worker('js/bpc-worker.js');
            worker.onmessage = function(e) {
                worker.terminate();
                if (e.data.success) {
                    resolve(e.data.sites);
                } else {
                    reject(new Error('[BPC] Worker evaluation failed: ' + e.data.error));
                }
            };
            worker.onerror = function(err) {
                worker.terminate();
                reject(new Error('[BPC] Worker error: ' + err.message));
            };
            worker.postMessage({ sitesData });
        });
    }

    /**
     * Initialise le framework BPC en chargeant sites.js, contentScript.js, contentScript_fr.js et purify.min.js
     * (uniquement depuis le cache localStorage — pas de fichiers embarqués).
     */
    async function initBpc() {
        try {
            console.log('[BPC] Initializing rules...');

            // 1. Charger sites.js
            let sitesData = localStorage.getItem('bpc_sites_js');
            if (!sitesData) {
                console.warn('[BPC] Aucune règle BPC en cache. L\'utilisateur doit les installer via l\'onboarding ou les paramètres.');
                return;
            }

            // Evaluer sites.js dans un Web Worker (pas d'accès window/DOM/localStorage)
            bpcSites = await evalSitesDataInWorker(sitesData);
            console.log('[BPC] Sites loaded. Domains count:', Object.keys(bpcSites).length);

            // 2. Charger contentScript.js (générique)
            bpcScript = localStorage.getItem('bpc_script_js');
            if (!bpcScript) {
                console.warn('[BPC] contentScript.js manquant');
                return;
            }
            console.log('[BPC] contentScript.js loaded. Length:', bpcScript.length);

            // 3. Charger contentScript_fr.js
            bpcScriptFr = localStorage.getItem('bpc_script_fr_js');
            if (!bpcScriptFr) {
                console.warn('[BPC] contentScript_fr.js manquant');
                return;
            }
            console.log('[BPC] contentScript_fr.js loaded. Length:', bpcScriptFr.length);
        } catch (e) {
            console.error('[BPC] Failed to initialize BPC framework:', e);
        }
    }

    // Lancement automatique à l'import
    initBpc().catch(e => console.error('[BPC] Auto-init failed:', e));

    /**
     * Recherche la configuration BPC pour un hostname donné.
     */
    function findBpcSiteConfig(hostname) {
        if (!bpcSites) return null;
        for (const key in bpcSites) {
            const site = bpcSites[key];
            if (!site || (!site.domain && !site.group)) continue;

            // Si c'est un domaine direct
            if (site.domain && (hostname === site.domain || hostname.endsWith('.' + site.domain))) {
                return { name: key, ...site };
            }
            // Si c'est un groupe de domaines
            if (site.group && Array.isArray(site.group)) {
                for (const domain of site.group) {
                    if (hostname === domain || hostname.endsWith('.' + domain)) {
                        return { name: key, ...site, domain: domain };
                    }
                }
            }
        }
        return null;
    }

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
        } catch (e) {
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
        // Remplacer les apostrophes par des espaces plutôt que de les supprimer directement
        cleanTitle = cleanTitle.replace(/[''""’‘`]/g, ' ');
        cleanTitle = cleanTitle.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()…?–—«»]/g, ' ');

        const words = cleanTitle.toLowerCase().split(/\s+/).filter(Boolean);
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

        return filtered.join(' ');
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
        } catch (e) { return '9'; }
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
        } catch (e) {
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
        const UA = await getUA();

        const isUrl = titleOrUrl.startsWith('http');
        const providerOrder = state.providerOrder || ['bpc', 'pressreader', 'cafeyn', 'bnf'];
        const providerEnabled = state.providerEnabled || {};
        const activeProviders = providerOrder.filter(k => providerEnabled[k] !== false);

        let extractedTitle = null;
        let extractedDate = null;
        let extractedDescription = null;

        async function getExtractedTitleAndDate() {
            if (extractedTitle !== null) {
                return { title: extractedTitle, date: extractedDate, description: extractedDescription };
            }
            if (!isUrl) {
                extractedTitle = titleOrUrl;
                extractedDate = '';
                extractedDescription = '';
                return { title: extractedTitle, date: extractedDate, description: extractedDescription };
            }

            onProgress('Récupération', 'Récupération du titre...', 10);
            let articleTitle = fallbackTitle || '';
            let publishedDate = '';
            let articleDescription = '';

            try {
                const pageRes = await BnfLogin.httpRequest({
                    url: titleOrUrl,
                    method: 'GET',
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
                console.warn('[SCRAPE] Failed to fetch original page:', e);
            }

            // Fallback : extraction depuis le slug de l'URL
            const knownSiteNames = ['liberation.fr', 'le monde', 'le figaro'];
            if (!articleTitle || knownSiteNames.includes(articleTitle.toLowerCase().trim())) {
                try {
                    const urlObj = new URL(titleOrUrl);
                    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
                    let slug = pathSegments.pop() || '';
                    slug = slug.replace(/\.html?$/, '');
                    if (slug.includes('_')) slug = slug.split('_')[0];
                    articleTitle = slug.replace(/[-]/g, ' ').replace(/\s+\d{2,}\s*$/g, '').trim();
                } catch (e) { }
            }

            extractedTitle = articleTitle;
            extractedDate = publishedDate;
            extractedDescription = articleDescription;
            return { title: extractedTitle, date: extractedDate, description: extractedDescription };
        }

        // ===========================================
        // === ITÉRATION PAR PRIORITÉ (providerOrder) ===
        // ===========================================
        for (const provider of activeProviders) {
            if (provider === 'cafeyn') {
                if (!window.Cafeyn || !window.Cafeyn.isTokenValid()) continue;
                onProgress('Cafeyn', 'Récupération via Cafeyn...', 10);
                try {
                    let slug = null;
                    if (isUrl) {
                        slug = window.Cafeyn.extractSlugFromUrl(titleOrUrl);
                    }

                    if (slug) {
                        onProgress('Cafeyn', 'Téléchargement de l\'article...', 40);
                        const details = await window.Cafeyn.fetchArticle(slug);
                        const finalHtml = window.Cafeyn.articleToHtml(details);

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
                        // Mode recherche par mots-clés ou URL de presse qu'on doit chercher
                        let searchQuery = '';
                        let originalTitle = '';
                        if (isUrl) {
                            const { title } = await getExtractedTitleAndDate();
                            if (!title) {
                                console.warn('[Cafeyn] Aucun titre extrait pour la recherche de l\'URL');
                                continue;
                            }
                            originalTitle = title;
                            searchQuery = processTitleToQuery(title) || title;
                        } else {
                            originalTitle = titleOrUrl;
                            searchQuery = titleOrUrl;
                        }

                        onProgress('Cafeyn', `Recherche: "${searchQuery}"...`, 30);
                        let searchRes = await window.Cafeyn.search(searchQuery);
                        let items = searchRes?.articles?.collection || [];

                        if (items.length === 0) {
                            const queryWords = searchQuery.split(/\s+/);
                            if (queryWords.length > 5) {
                                const shortenedQuery = queryWords.slice(0, 5).join(' ');
                                onProgress('Cafeyn', `Aucun résultat. Nouvelle tentative avec : "${shortenedQuery}"...`, 35);
                                console.log('[Cafeyn] Retrying search with shortened query:', shortenedQuery);
                                searchRes = await window.Cafeyn.search(shortenedQuery);
                                items = searchRes?.articles?.collection || [];
                            }
                        }

                        if (items.length === 0) {
                            const queryWords = searchQuery.split(/\s+/);
                            const filteredWords = queryWords.filter(w => !/^l[aeiouyéàèùâêîôûëïü]/i.test(w));
                            if (filteredWords.length > 0 && filteredWords.length < queryWords.length) {
                                const elisionFreeQuery = filteredWords.slice(0, 5).join(' ');
                                onProgress('Cafeyn', `Aucun résultat. Nouvelle tentative sans élisions : "${elisionFreeQuery}"...`, 38);
                                console.log('[Cafeyn] Retrying search without potential elisions:', elisionFreeQuery);
                                searchRes = await window.Cafeyn.search(elisionFreeQuery);
                                items = searchRes?.articles?.collection || [];
                            }
                        }

                        let matchedByDescription = false;
                        if (items.length === 0 && isUrl) {
                            const { description } = await getExtractedTitleAndDate();
                            const descQuery = processDescriptionToQuery(description);
                            if (descQuery) {
                                onProgress('Cafeyn', `Aucun résultat pour le titre. Recherche par description: "${descQuery}"...`, 39);
                                console.log('[Cafeyn] Retrying search with description query:', descQuery);
                                searchRes = await window.Cafeyn.search(descQuery);
                                items = searchRes?.articles?.collection || [];
                                if (items.length > 0) {
                                    matchedByDescription = true;
                                }
                            }
                        }

                        if (items.length === 0) {
                            console.warn('[Cafeyn] Aucun résultat pour :', searchQuery);
                            continue;
                        }

                        // Trouver le meilleur match par similarité
                        let bestMatch = null;
                        let maxSim = 0;

                        if (isUrl) {
                            items.forEach(item => {
                                if (item.formattedUrl && item.title) {
                                    const sim = calculateSimilarity(originalTitle, item.title);
                                    if (sim > maxSim) {
                                        maxSim = sim;
                                        bestMatch = item;
                                    }
                                }
                            });

                            const minSim = matchedByDescription ? 15 : 35;
                            if (!bestMatch || maxSim < minSim) {
                                console.warn('[Cafeyn] Aucun article avec une similarité suffisante trouvé (maxSim: ' + maxSim + '%)');
                                continue;
                            }
                        } else {
                            bestMatch = items[0];
                        }

                        onProgress('Cafeyn', `Téléchargement de l'article...`, 70);
                        const details = await window.Cafeyn.fetchArticle(bestMatch.formattedUrl);
                        const finalHtml = window.Cafeyn.articleToHtml(details);

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
                } catch (cafeynErr) {
                    console.warn('[Cafeyn] Échec :', cafeynErr.message);
                    continue;
                }
            }

            if (provider === 'pressreader') {
                onProgress('PressReader', 'Authentification PressReader...', 10);
                try {
                    let articleId = null;
                    if (isUrl) {
                        articleId = window.PressReader.extractArticleIdFromUrl(titleOrUrl);
                    }

                    if (articleId) {
                        onProgress('PressReader', 'Téléchargement de l\'article...', 40);
                        const article = await window.PressReader.fetchArticle(articleId, UA);
                        const finalHtml = window.PressReader.articleToHtml(article);

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
                        // Soit mode recherche par mots-clés, soit URL de presse qu'on doit chercher
                        let searchQuery = '';
                        let originalTitle = '';
                        if (isUrl) {
                            const { title } = await getExtractedTitleAndDate();
                            if (!title) {
                                console.warn('[PressReader] Aucun titre extrait pour la recherche de l\'URL');
                                continue;
                            }
                            originalTitle = title;
                            searchQuery = processTitleToQuery(title) || title;
                        } else {
                            originalTitle = titleOrUrl;
                            searchQuery = titleOrUrl;
                        }

                        onProgress('PressReader', `Recherche: "${searchQuery}"...`, 30);
                        let items = await window.PressReader.search(searchQuery, UA);

                        if (!items || items.length === 0) {
                            const queryWords = searchQuery.split(/\s+/);
                            if (queryWords.length > 5) {
                                const shortenedQuery = queryWords.slice(0, 5).join(' ');
                                onProgress('PressReader', `Aucun résultat. Nouvelle tentative avec : "${shortenedQuery}"...`, 35);
                                console.log('[PressReader] Retrying search with shortened query:', shortenedQuery);
                                items = await window.PressReader.search(shortenedQuery, UA);
                            }
                        }

                        if (!items || items.length === 0) {
                            const queryWords = searchQuery.split(/\s+/);
                            const filteredWords = queryWords.filter(w => !/^l[aeiouyéàèùâêîôûëïü]/i.test(w));
                            if (filteredWords.length > 0 && filteredWords.length < queryWords.length) {
                                const elisionFreeQuery = filteredWords.slice(0, 5).join(' ');
                                onProgress('PressReader', `Aucun résultat. Nouvelle tentative sans élisions : "${elisionFreeQuery}"...`, 38);
                                console.log('[PressReader] Retrying search without potential elisions:', elisionFreeQuery);
                                items = await window.PressReader.search(elisionFreeQuery, UA);
                            }
                        }

                        let matchedByDescription = false;
                        if ((!items || items.length === 0) && isUrl) {
                            const { description } = await getExtractedTitleAndDate();
                            const descQuery = processDescriptionToQuery(description);
                            if (descQuery) {
                                onProgress('PressReader', `Aucun résultat pour le titre. Recherche par description: "${descQuery}"...`, 39);
                                console.log('[PressReader] Retrying search with description query:', descQuery);
                                items = await window.PressReader.search(descQuery, UA);
                                if (items && items.length > 0) {
                                    matchedByDescription = true;
                                }
                            }
                        }

                        if (!items || items.length === 0) {
                            console.warn('[PressReader] Aucun résultat de recherche pour :', searchQuery);
                            continue;
                        }

                        // Trouver le meilleur match par similarité
                        let bestMatch = null;
                        let maxSim = 0;

                        if (isUrl) {
                            items.forEach(item => {
                                if (item.id && item.title) {
                                    const sim = calculateSimilarity(originalTitle, item.title);
                                    if (sim > maxSim) {
                                        maxSim = sim;
                                        bestMatch = item;
                                    }
                                }
                            });

                            const minSim = matchedByDescription ? 15 : 35;
                            if (!bestMatch || maxSim < minSim) {
                                console.warn('[PressReader] Aucun article avec une similarité suffisante trouvé (maxSim: ' + maxSim + '%)');
                                continue;
                            }
                        } else {
                            bestMatch = items[0];
                        }

                        onProgress('PressReader', `Téléchargement de l'article...`, 70);
                        const article = await window.PressReader.fetchArticle(bestMatch.id, UA);
                        const finalHtml = window.PressReader.articleToHtml(article);

                        onProgress('PressReader', 'Succès !', 95);
                        return {
                            html: finalHtml,
                            title: article.title || bestMatch.title || originalTitle,
                            source: article.issue?.newspaper?.name || bestMatch.publication?.name || 'PressReader',
                            url: isUrl ? titleOrUrl : `https://www.pressreader.com/article/${bestMatch.id}`,
                            publishedDate: article.date || article.issue?.date || '',
                            author: article.author || '',
                            publication: article.issue?.newspaper?.name || bestMatch.publication?.name || '',
                            serviceUsed: 'PressReader'
                        };
                    }
                } catch (prErr) {
                    console.warn('[PressReader] Échec :', prErr.message);
                    continue;
                }
            }

            if (provider === 'bnf') {
                const hasBnfSession = !!(cookieHeader || state.bnfUsername);
                console.log('[BnF Proxy] Check — isUrl:', isUrl, '| hasBnfSession:', hasBnfSession, '| cookieHeader length:', cookieHeader.length, '| username:', !!state.bnfUsername);

                if (isUrl && hasBnfSession) {
                    const bnfProxyConfig = getBnfProxySiteConfig(titleOrUrl);
                    console.log('[BnF Proxy] proxyConfig for URL:', titleOrUrl, '→', bnfProxyConfig ? bnfProxyConfig.name : 'no match');
                    if (bnfProxyConfig) {
                        console.log('[BnF Proxy] Match trouvé pour:', titleOrUrl, '→', bnfProxyConfig.proxyUrl);
                        onProgress('BnF Proxy', `Accès BnF pour ${bnfProxyConfig.name}...`, 10);
                        try {
                            const scraped = await scrapeBnfProxy(
                                bnfProxyConfig.proxyUrl,
                                titleOrUrl,
                                bnfProxyConfig,
                                cookieHeader,
                                UA,
                                onProgress
                            );
                            onProgress('BnF Proxy', 'Succès !', 95);
                            return scraped;
                        } catch (bnfErr) {
                            if (bnfErr.message && bnfErr.message.includes('Session BnF expirée')) {
                                throw bnfErr;
                            }
                            console.warn('[BnF Proxy] Échec, tentative de fallback BPC:', bnfErr.message);
                        }
                    }
                }

                // Si Europresse n'est pas configuré, on continue au prochain provider
                if (!state.bnfUsername || !state.bnfPassword) {
                    console.warn('[BnF] Pas de credentials Europresse, passage au provider suivant');
                    continue;
                }

                const { title: articleTitle, date: publishedDate, description: articleDescription } = await getExtractedTitleAndDate();
                if (!articleTitle) {
                    console.warn('[BnF] Impossible d\'obtenir le titre de l\'article, passage au suivant');
                    continue;
                }
                const articleUrl = isUrl ? titleOrUrl : '';

                // === Étape 2 : Construction de la requête ===
                const query = processTitleToQuery(articleTitle);
                if (!query) {
                    console.warn('[BnF] Impossible de construire des mots-clés, passage au suivant');
                    continue;
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

                let matchedByDescription = false;
                if ((!bestMatch || maxSim < 30) && isUrl) {
                    const descQuery = processDescriptionToQuery(articleDescription);
                    if (descQuery) {
                        console.log('[SCRAPE] Retrying search with description strategy on Europresse...', descQuery);
                        onProgress('Étape 4/5', 'Recherche par description...', 68);

                        const searchBodyDesc = `Keywords=${encodeURIComponent(descQuery)}` +
                            `&CriteriaKeys[0].Operator=%26&CriteriaKeys[0].Key=TEXT&CriteriaKeys[0].Text=${encodeURIComponent(descQuery)}` +
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
                            body: searchBodyDesc
                        });

                        const listResDesc = await BnfLogin.httpRequest({
                            url: `https://${EUROPRESSE_DOMAIN}/Search/GetPage?pageNo=0&docPerPage=50`,
                            method: 'GET',
                            headers: { 'Cookie': cookieHeader, 'User-Agent': UA }
                        });

                        if (listResDesc.data && listResDesc.data.trim()) {
                            const listDocDesc = parser.parseFromString(listResDesc.data, 'text/html');
                            listDocDesc.querySelectorAll('.docListItem').forEach(item => {
                                const titleLink = item.querySelector('.docList-links');
                                const docTitle = titleLink ? titleLink.textContent.trim() : '';
                                const docId = item.querySelector('input[id="doc-name"]')?.value;
                                const sourceName = item.querySelector('.source-name')?.textContent.trim() || '';
                                if (docId && docTitle) {
                                    const sim = calculateSimilarity(articleTitle, docTitle);
                                    if (sim > maxSim) {
                                        maxSim = sim;
                                        bestMatch = { id: docId, title: docTitle, source: sourceName };
                                        matchedByDescription = true;
                                    }
                                }
                            });
                        }
                    }
                }

                const minSim = matchedByDescription ? 15 : 20;
                if (!bestMatch || maxSim < minSim) {
                    console.warn('[BnF] Aucun article trouvé sur Europresse, passage au suivant');
                    continue;
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
                    console.warn('[BnF] Contenu introuvable, passage au suivant');
                    continue;
                }

                const visTitle = docDoc.querySelector('.titreArticleVisu')?.innerHTML || bestMatch.title;
                const cleanTitle = removeHighlightTags(visTitle);
                const cleanContent = removeHighlightTags(contentContainer.innerHTML);

                const finalHtml = `<style>${window.PRINT_CSS}</style><h1>${cleanTitle}</h1>${cleanContent}`;

                const bnfDate = docDoc.querySelector('.dateTimeArticleVisu')?.textContent?.trim() || docDoc.querySelector('meta[name="citation_date"]')?.getAttribute('content') || '';
                const bnfAuthor = docDoc.querySelector('.auteurArticleVisu')?.textContent?.trim() || docDoc.querySelector('meta[name="citation_author"]')?.getAttribute('content') || '';

                return {
                    html: finalHtml,
                    title: bestMatch.title,
                    source: bestMatch.source,
                    url: articleUrl,
                    publishedDate: bnfDate || publishedDate || '',
                    author: bnfAuthor || '',
                    publication: bestMatch.source || '',
                    serviceUsed: 'BnF Europresse'
                };
            }

            if (provider === 'bpc') {
                if (!isUrl) continue;
                onProgress('Plugin', 'Lecture directe...', 10);
                try {
                    const urlObj = new URL(titleOrUrl);
                    const hostname = urlObj.hostname;
                    const bpcConfig = findBpcSiteConfig(hostname);

                    if (bpcConfig) {
                        console.log('[BPC] Direct scraping match found for:', hostname, '| Rule:', bpcConfig.name);
                        const scrapedDirect = await runBpcDirectScraping(titleOrUrl, bpcConfig, UA, onProgress);
                        if (scrapedDirect) {
                            return scrapedDirect;
                        }
                    }
                } catch (bpcError) {
                    console.warn('[BPC] Direct bypass failed:', bpcError);
                    continue;
                }
            }
        }

        // Aucun fournisseur n'a pu récupérer l'article
        const { title: finalTitle, date: finalDate } = await getExtractedTitleAndDate();
        let errorMsg = "Aucune source n'a pu récupérer cet article.";
        if (finalTitle) {
            errorMsg += ` Termes recherchés : "${finalTitle.substring(0, 60)}".`;
        }
        if (finalDate) {
            try {
                const pubDate = new Date(finalDate);
                const diffHours = (Date.now() - pubDate.getTime()) / 3600000;
                if (diffHours < 24) {
                    errorMsg += " L'article vient d'être publié (moins de 24h). Il peut ne pas encore être indexé sur les services de presse. Réessayez dans quelques heures.";
                } else {
                    errorMsg += ` Date de publication : ${pubDate.toLocaleDateString('fr-FR')}.`;
                }
            } catch(e) {}
        }
        errorMsg += " Vérifiez votre configuration et vos sessions.";
        throw new Error(errorMsg);
    }

    /**
     * Effectue le scraping direct et applique le bypass BPC via un DOM virtuel (Iframe).
     */
    async function runBpcDirectScraping(articleUrl, siteConfig, defaultUA, onProgress) {
        const BnfLogin = window.Capacitor.Plugins.BnfLogin;

        // 1. Détermination du User-Agent
        let customUA = defaultUA;
        if (siteConfig.useragent === 'googlebot') {
            customUA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
        } else if (siteConfig.useragent === 'bingbot') {
            customUA = 'Mozilla/5.0 (compatible; Bingbot/2.0; +http://www.bing.com/bingbot.htm)';
        } else if (siteConfig.useragent === 'facebookbot') {
            customUA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_voiced.html)';
        } else if (siteConfig.useragent_custom) {
            customUA = siteConfig.useragent_custom;
        }

        // 2. Préparation des headers de requête
        const headers = {
            'User-Agent': customUA,
            'Referer': 'https://www.google.com/' // Moteur de recherche comme Referer par défaut
        };

        onProgress('Plugin', 'Téléchargement de la page...', 20);

        // 3. Téléchargement du HTML original
        let pageRes;
        if (BnfLogin) {
            pageRes = await BnfLogin.httpRequest({
                url: articleUrl,
                method: 'GET',
                headers: headers
            });
        } else {
            const r = await fetch(articleUrl, { headers: headers });
            pageRes = { status: r.status, data: await r.text() };
        }

        if (!pageRes || pageRes.status !== 200 || !pageRes.data) {
            throw new Error(`HTTP error ${pageRes?.status || 'unknown'} during direct fetch`);
        }

        onProgress('Plugin', 'Extraction du contenu...', 40);

        // 4. Création de l'Iframe sandboxé pour exécuter le bypass
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const iframeWindow = iframe.contentWindow;
        const iframeDocument = iframe.contentDocument;

        // Neutraliser les scripts exécutables de la page d'origine pour éviter tout crash de document.write
        // et interférence, tout en gardant les balises JSON/JSON-LD contenant les données d'article.
        let sanitizedHtml = pageRes.data.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, content) => {
            if (attrs.includes('application/ld+json') || attrs.includes('application/json')) {
                return match;
            }
            return `<script type="disabled-javascript" ${attrs.replace(/\bsrc=/gi, 'data-src=')}>/* disabled */</script>`;
        });

        // Écrire le HTML original dans l'Iframe pour recréer le DOM
        iframeDocument.open();
        iframeDocument.write(sanitizedHtml);
        iframeDocument.close();

        // 5. Configurer l'environnement de l'Iframe (BpcBridge)
        const urlObj = new URL(articleUrl);
        const articleDomain = urlObj.hostname;
        const articlePathname = urlObj.pathname;
        const articleOrigin = urlObj.origin;

        // Mock window.location, document and window with proxies to bypass configurable=false restrictions
        const locationProxy = new Proxy(iframeWindow.location, {
            get(target, prop) {
                if (prop === 'hostname') return articleDomain;
                if (prop === 'href') return articleUrl;
                if (prop === 'pathname') return articlePathname;
                if (prop === 'origin') return articleOrigin;
                const val = target[prop];
                if (typeof val === 'function') return val.bind(target);
                return val;
            }
        });

        const documentProxy = new Proxy(iframeDocument, {
            get(target, prop) {
                if (prop === 'location') return locationProxy;
                if (prop === 'referrer') return 'https://www.google.com/';
                const val = target[prop];
                if (typeof val === 'function') return val.bind(target);
                return val;
            }
        });

        const windowProxy = new Proxy(iframeWindow, {
            get(target, prop) {
                if (prop === 'location') return locationProxy;
                if (prop === 'document') return documentProxy;
                if (prop === 'window' || prop === 'self' || prop === 'globalThis') return windowProxy;
                const val = target[prop];
                if (typeof val === 'function') return val.bind(target);
                return val;
            }
        });

        // Attach proxies to iframe window for the IIFE boostrap wrapper
        iframeWindow.__windowProxy__ = windowProxy;
        iframeWindow.__documentProxy__ = documentProxy;
        iframeWindow.__locationProxy__ = locationProxy;

        // Stubs de l'API Chrome Extension
        iframeWindow.chrome = {
            runtime: {
                sendMessage: () => { },
                getManifest: () => ({ version: '1.0.0' }),
                onMessage: { addListener: () => { } },
                onMessageExternal: { addListener: () => { } }
            }
        };
        iframeWindow.browser = iframeWindow.chrome;
        iframeWindow.ext_api = iframeWindow.chrome;
        iframeWindow.ext_chromium = true;
        iframeWindow.mobile = true;
        iframeWindow.dompurify_loaded = true;
        iframeWindow.dompurify_options = {
            ADD_TAGS: ['amp-img', 'embed', 'iframe', 'list'],
            ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'itemprop', 'layout', 'target']
        };

        // Fonctions d'émulation BPC
        iframeWindow.matchDomain = function (domains, hostname = articleDomain) {
            if (typeof domains === 'string') domains = [domains];
            return domains.find(domain => hostname === domain || hostname.endsWith('.' + domain)) || false;
        };

        iframeWindow.removeDOMElement = function (...elements) {
            for (let element of elements) {
                if (element) element.remove();
            }
        };

        iframeWindow.hideDOMElement = function (...elements) {
            for (let element of elements) {
                if (element) element.style = 'display:none !important;';
            }
        };

        iframeWindow.hideDOMStyle = function (selector, id = 1) {
            let style = iframeDocument.querySelector('head > style#ext' + id);
            if (!style && iframeDocument.head) {
                let sheet = iframeDocument.createElement('style');
                sheet.id = 'ext' + id;
                sheet.innerText = selector + ' {display: none !important;}';
                iframeDocument.head.appendChild(sheet);
            }
        };

        iframeWindow.addStyle = function (css, id = 1) {
            let style = iframeDocument.querySelector('head > style#add' + id);
            if (!style && iframeDocument.head) {
                let sheet = iframeDocument.createElement('style');
                sheet.id = 'add' + id;
                sheet.innerText = css;
                iframeDocument.head.appendChild(sheet);
            }
        };

        iframeWindow.matchKeyJson = function (key, keys) {
            let match = false;
            if (typeof keys === 'string') match = (key === keys);
            else if (Array.isArray(keys)) match = keys.includes(key);
            else if (keys instanceof RegExp) match = keys.test(key);
            return match;
        };

        iframeWindow.findKeyJson = function (json, keys, min_val_len = 0) {
            let source = '';
            if (Array.isArray(json)) {
                for (let elem of json)
                    source = source || iframeWindow.findKeyJson(elem, keys, min_val_len);
            } else if (typeof json === 'object') {
                for (let elem in json) {
                    let json_elem = json[elem];
                    if (typeof json_elem === 'string' && iframeWindow.matchKeyJson(elem, keys)) {
                        if (json_elem.length > min_val_len) return json_elem;
                    } else if (Array.isArray(json_elem) && json_elem.length > 1 && iframeWindow.matchKeyJson(elem, keys)) {
                        return json_elem;
                    } else {
                        source = source || iframeWindow.findKeyJson(json_elem, keys, min_val_len);
                    }
                }
            }
            return source;
        };

        iframeWindow.getNestedKeys = function (obj, key) {
            if (key in obj) return obj[key];
            let keys = key.split('.');
            let value = obj;
            for (let i = 0; i < keys.length; i++) {
                value = value[keys[i]];
                if (value === undefined) break;
            }
            return value;
        };

        iframeWindow.makeFigure = function (url, caption_text, img_attrib = {}, caption_attrib = {}) {
            let elem = iframeDocument.createElement('figure');
            let img = iframeDocument.createElement('img');
            img.src = url;
            for (let attrib in img_attrib) {
                if (img_attrib[attrib]) img.setAttribute(attrib, img_attrib[attrib]);
            }
            elem.appendChild(img);
            if (caption_text) {
                let caption = iframeDocument.createElement('figcaption');
                for (let attrib in caption_attrib) {
                    if (caption_attrib[attrib]) caption.setAttribute(attrib, caption_attrib[attrib]);
                }
                let cap_par = iframeDocument.createElement('p');
                cap_par.innerText = caption_text;
                caption.appendChild(cap_par);
                elem.appendChild(caption);
            }
            return elem;
        };

        iframeWindow.makeLink = function (url, title, style = '') {
            let a_link = iframeDocument.createElement('a');
            a_link.href = url;
            a_link.innerText = title;
            if (style) a_link.style = style;
            return a_link;
        };

        iframeWindow.clearPaywall = function (paywall, paywall_action) {
            if (paywall) {
                if (!paywall_action) iframeWindow.removeDOMElement(...paywall);
                else {
                    for (let elem of paywall) {
                        if (paywall_action.rm_class) elem.classList.remove(paywall_action.rm_class);
                        else if (paywall_action.rm_attrib) elem.removeAttribute(paywall_action.rm_attrib);
                    }
                }
            }
        };

        iframeWindow.randomInt = function (max) {
            return Math.floor(Math.random() * Math.floor(max));
        };

        iframeWindow.parseHtmlEntities = function (encodedString) {
            let parser = new DOMParser();
            let doc = parser.parseFromString('<textarea>' + encodedString + '</textarea>', 'text/html');
            let dom = doc.querySelector('textarea');
            return dom.value;
        };

        iframeWindow.breakText = function (str, headers = false) {
            str = str.replace(/(?:^|[A-Za-z\"\“\”\)])(\.+|\?|!)(?=[A-ZÖÜ\„\”\d][A-Za-zÀ-ÿ\„\d]{1,})/gm, "$&\n\n");
            if (headers)
                str = str.replace(/(([a-z]{2,}|[\"\“]))(?=[A-Z](?=[A-Za-z\u00C0-\u00FF]+))/gm, "$&\n\n");
            return str;
        };

        iframeWindow.decode_utf8 = function (str) {
            return decodeURIComponent(escape(str));
        };

        iframeWindow.getArticleJsonScript = function () {
            let scripts = iframeDocument.querySelectorAll('script[type="application/ld+json"]');
            return Array.prototype.find.call(scripts, s => s.text.includes('"articleBody"') || s.text.includes('"articlebody"'));
        };

        iframeWindow.getSourceJsonScript = function (filter, attributes = ':not([src], [type])') {
            let scripts = iframeDocument.querySelectorAll('script' + attributes);
            return Array.prototype.find.call(scripts, s => filter.test(s.text));
        };

        iframeWindow.archiveRandomDomain = function () {
            const domains = ['archive.ph', 'archive.is', 'archive.li', 'archive.today', 'archive.md', 'archive.vn'];
            return domains[Math.floor(Math.random() * domains.length)];
        };

        iframeWindow.archiveLink = function (url, text_fail = 'BPC > Try for full article text:\r\n') {
            let a_link = iframeDocument.createElement('a');
            a_link.href = 'https://' + iframeWindow.archiveRandomDomain() + '/' + url;
            a_link.innerText = text_fail + a_link.href;
            a_link.target = '_blank';
            a_link.style = 'color: red; font-weight: bold;';
            return a_link;
        };

        iframeWindow.archiveLink_renew = function (url, text_fail = 'BPC > Renew if incomplete:\r\n') {
            return iframeWindow.archiveLink(url, text_fail);
        };

        iframeWindow.getSelectorLevel = function (selector) {
            if (selector.replace(/,\s+/g, ',').match(/[>\s]+/) && !selector.includes(':has(>'))
                selector = selector.replace(/,\s+/g, ',').split(',').map(x => x.match(/[>\s]+/) ? x + ', ' + x.split(/[>\s]+/).pop() : x).join(', ');
            return selector;
        };

        iframeWindow.header_nofix = function () { };
        iframeWindow.blockJsReferrer = function () { };
        iframeWindow.refreshCurrentTab = function () { };
        iframeWindow.refreshCurrentTab_bg = function () { };

        // Fonctions réseau asynchrones
        iframeWindow.data_ext_fetch_id = 0;
        iframeWindow.data_ext_fetch = [];

        iframeWindow.getExtFetch = async function (url, json_key = '', options = {}, callback, data_ext_fetch_id = 0, args = []) {
            try {
                console.log('[BPC BRIDGE] getExtFetch:', url);
                const BnfLogin = window.parent.Capacitor?.Plugins?.BnfLogin || window.Capacitor?.Plugins?.BnfLogin;

                let res;
                const reqHeaders = options.headers || {};
                reqHeaders['User-Agent'] = customUA;

                if (BnfLogin) {
                    res = await BnfLogin.httpRequest({
                        url: url,
                        method: options.method || 'GET',
                        headers: reqHeaders,
                        body: options.body || null
                    });
                } else {
                    const r = await fetch(url, { method: options.method || 'GET', headers: reqHeaders, body: options.body || null });
                    res = { status: r.status, data: await r.text() };
                }

                if (res && (res.status === 200 || res.status === 201)) {
                    let responseData = res.data;
                    if (json_key) {
                        try {
                            const parsed = JSON.parse(res.data);
                            responseData = iframeWindow.getNestedKeys(parsed, json_key);
                        } catch (e) {
                            console.warn('[BPC BRIDGE] JSON extract error:', e);
                        }
                    }
                    if (callback) callback(url, responseData, ...args);
                } else {
                    if (callback) callback(url, null, ...args);
                }
            } catch (e) {
                console.error('[BPC BRIDGE] getExtFetch error:', e);
                if (callback) callback(url, null, ...args);
            }
        };

        iframeWindow.replaceDomElementExt = async function (url, proxy, base64, selector, text_fail = '', selector_source = selector, selector_archive = selector) {
            try {
                console.log('[BPC BRIDGE] replaceDomElementExt:', url);
                const BnfLogin = window.parent.Capacitor?.Plugins?.BnfLogin || window.Capacitor?.Plugins?.BnfLogin;

                let res;
                if (BnfLogin) {
                    res = await BnfLogin.httpRequest({
                        url: url,
                        method: 'GET',
                        headers: { 'User-Agent': customUA }
                    });
                } else {
                    const r = await fetch(url);
                    res = { status: r.status, data: await r.text() };
                }

                if (res && res.status === 200 && res.data) {
                    let html = res.data;
                    if (base64) {
                        html = iframeWindow.decode_utf8(atob(html));
                        selector_source = 'body';
                    }

                    let sanitizedHtml = html;
                    if (iframeWindow.DOMPurify) {
                        sanitizedHtml = iframeWindow.DOMPurify.sanitize(html, iframeWindow.dompurify_options);
                    }

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(sanitizedHtml, 'text/html');

                    if (iframeWindow.selector_level) {
                        selector_source = iframeWindow.getSelectorLevel(selector_source);
                    }

                    const articleNew = doc.querySelector(selector_source);
                    const article = iframeDocument.querySelector(selector);

                    if (articleNew && article) {
                        article.parentNode.replaceChild(articleNew, article);
                        if (typeof iframeWindow.func_post === 'function') {
                            iframeWindow.func_post();
                        }
                    }
                }
            } catch (e) {
                console.error('[BPC BRIDGE] replaceDomElementExt error:', e);
            }
        };

        iframeWindow.getArchive = function (url, paywall_sel, paywall_action = '', selector, text_fail = '', selector_source = selector, selector_archive = selector) {
            let url_archive = 'https://' + iframeWindow.archiveRandomDomain() + '/' + (url.includes('/#/') ? encodeURIComponent(url.split('?')[0]) : url.split(/[#\?]/)[0]);
            let paywall = iframeDocument.querySelectorAll(paywall_sel);
            if (paywall.length && iframeWindow.dompurify_loaded) {
                iframeWindow.clearPaywall(paywall, paywall_action);
                iframeWindow.csDoneOnce = true;
                iframeWindow.replaceDomElementExt(url_archive, true, false, selector, text_fail, selector_source, selector_archive);
            }
        };

        // Redirection de fetch global dans l'Iframe
        iframeWindow.fetch = async function (resource, init) {
            let url = (typeof resource === 'string') ? resource : resource.url;
            console.log('[BPC BRIDGE] fetch override intercepted:', url);

            if (url.startsWith('http') && !url.includes(iframeWindow.location.host)) {
                const BnfLogin = window.parent.Capacitor?.Plugins?.BnfLogin || window.Capacitor?.Plugins?.BnfLogin;
                if (BnfLogin) {
                    try {
                        let headers = {};
                        if (init && init.headers) {
                            if (init.headers instanceof Headers) {
                                init.headers.forEach((value, key) => { headers[key] = value; });
                            } else if (typeof init.headers === 'object') {
                                headers = init.headers;
                            }
                        }
                        headers['User-Agent'] = customUA;

                        let body = null;
                        if (init && init.body) body = init.body;

                        const res = await BnfLogin.httpRequest({
                            url: url,
                            method: (init && init.method) || 'GET',
                            headers: headers,
                            body: body
                        });

                        return {
                            ok: res.status >= 200 && res.status < 300,
                            status: res.status,
                            statusText: 'OK',
                            text: async () => res.data,
                            json: async () => JSON.parse(res.data)
                        };
                    } catch (e) {
                        console.error('[BPC BRIDGE] Fetch redirect failed:', e);
                        throw e;
                    }
                }
            }
            return window.parent.fetch(resource, init);
        };

        // 6. Injection de DOMPurify et exécution du contentScript dans l'IIFE avec nos proxies
        iframeWindow.DOMPurify = {
            sanitize: (x, y = '') => x,
            removed: []
        };

        const bootstrapScript = iframeDocument.createElement('script');
        bootstrapScript.text = `
            (function(window, self, globalThis, document, location) {
                // Déclarer les variables d'état BPC attendues par le content script
                window.csDone = false;
                window.csDoneOnce = false;
                try {
                    // 1. Charger le contentScript générique (framework de helpers)
                    ${bpcScript}
                    
                    // 2. Charger le contentScript localisé (règles fr)
                    ${bpcScriptFr}
                    
                    // Exécuter le bypass
                    if (typeof cs_default === "function") {
                        console.log("[BPC BRIDGE] Running cs_default() inside sandboxed IIFE...");
                        cs_default();
                    } else {
                        console.warn("[BPC BRIDGE] cs_default function not found");
                    }
                } catch (e) {
                    console.error("[BPC BRIDGE] Error inside IIFE execution:", e);
                }
            })(window.__windowProxy__, window.__windowProxy__, window.__windowProxy__, window.__documentProxy__, window.__locationProxy__);
        `;
        iframeDocument.head.appendChild(bootstrapScript);

        // 7. Attente active de la résolution du bypass
        onProgress('Plugin', 'Récupération du contenu...', 60);

        const startTime = Date.now();
        const checkInterval = 100;
        const maxWaitTime = 8000; // archive.is can be slow, allow up to 8s

        // 8. Extraction du contenu et validation - Définition des sélecteurs
        let contentSelector = '';
        if (articleDomain.includes('lemonde.fr')) contentSelector = '.article__content';
        else if (articleDomain.includes('lefigaro.fr')) contentSelector = 'div[data-component="fig-content-body"]';
        else if (articleDomain.includes('leparisien.fr')) contentSelector = 'section#left';
        else if (articleDomain.includes('liberation.fr')) contentSelector = '.article-body, .article__content';
        else if (articleDomain.includes('lepoint.fr')) contentSelector = '.article-content, .article-body';
        else if (articleDomain.includes('marianne.net')) contentSelector = '.article-body';
        else if (articleDomain.includes('mediapart.fr')) contentSelector = '.content-article';
        else if (articleDomain.includes('la-croix.com')) contentSelector = '.article-body';
        else if (articleDomain.includes('lesoir.be')) contentSelector = '.r-content, article.r-article';
        else if (articleDomain.includes('lamontagne.fr') || articleDomain.includes('lepopulaire.fr') || articleDomain.includes('larep.fr') || articleDomain.includes('le-pays.fr')) contentSelector = 'div#content section > div.flex-col';
        else if (articleDomain.includes('letemps.ch')) contentSelector = 'div#article-body-wrapper';

        const paywallSelector = 'div[id*="paywall"], section[class*="paywall"], div[class*="paywall"], #poool-widget, meta[name="premium"][content="true"], div.post-subscribe, div.post__content--faded';

        await new Promise((resolve) => {
            const timer = setInterval(() => {
                const elapsed = Date.now() - startTime;
                let bypassSuccess = false;

                let contentEl = null;
                if (contentSelector) {
                    contentEl = iframeDocument.querySelector(contentSelector);
                }
                if (!contentEl) {
                    contentEl = iframeDocument.querySelector('article') || iframeDocument.querySelector('[itemprop="articleBody"]') || iframeDocument.querySelector('.article-body') || iframeDocument.querySelector('.article');
                }

                const hasPaywall = iframeDocument.querySelector(paywallSelector);
                const textLength = contentEl ? contentEl.textContent.trim().length : 0;

                if (articleDomain === 'lemonde.fr') {
                    const hasParagraphs = iframeDocument.querySelectorAll('.article__paragraph').length >= 3;
                    const paywallGone = !iframeDocument.querySelector('section.lmd-paywall');
                    if (hasParagraphs && paywallGone) bypassSuccess = true;
                } else if (articleDomain === 'lefigaro.fr') {
                    const hasParagraphs = iframeDocument.querySelectorAll('.fig-paragraph').length >= 3;
                    const paywallGone = !iframeDocument.querySelector('div#fig-premium-paywall');
                    if (hasParagraphs && paywallGone) bypassSuccess = true;
                } else if (articleDomain === 'leparisien.fr') {
                    const leftSection = iframeDocument.querySelector('section#left');
                    const paywallGone = !iframeDocument.querySelector('div.paywall');
                    if (leftSection && leftSection.textContent.length > 800 && paywallGone) bypassSuccess = true;
                } else {
                    // Règle générique basée sur les sélecteurs
                    if (!hasPaywall && textLength > 800) {
                        bypassSuccess = true;
                    }
                }

                if (bypassSuccess || elapsed >= maxWaitTime) {
                    clearInterval(timer);
                    resolve();
                }
            }, checkInterval);
        });

        // Extraction finale du contenu
        onProgress('Plugin', 'Extraction du texte...', 80);

        let contentEl = null;
        if (contentSelector) {
            contentEl = iframeDocument.querySelector(contentSelector);
        }
        if (!contentEl) {
            contentEl = iframeDocument.querySelector('article') || iframeDocument.querySelector('[itemprop="articleBody"]') || iframeDocument.querySelector('.article-body') || iframeDocument.querySelector('.article') || iframeDocument.body;
        }

        const hasPaywall = iframeDocument.querySelector(paywallSelector);
        const textLength = contentEl ? contentEl.textContent.trim().length : 0;

        console.log('[BPC] Validation - text length:', textLength, 'has paywall:', !!hasPaywall);

        if (hasPaywall && textLength < 800) {
            iframe.remove();
            throw new Error("Direct bypass resulted in paywall still active or insufficient text.");
        }

        // Récupération des métadonnées
        const pageTitle = iframeDocument.querySelector('meta[property="og:title"]')?.getAttribute('content')
            || iframeDocument.querySelector('meta[name="twitter:title"]')?.getAttribute('content')
            || iframeDocument.title || 'Article direct';

        const sourceName = siteConfig.name.split(' (')[0].split(' (+')[0];

        // Formatage final avec CSS d'impression
        const finalHtml = `<style>${window.PRINT_CSS}</style><h1>${pageTitle}</h1>${contentEl.innerHTML}`;

        iframe.remove();

        return {
            html: finalHtml,
            title: pageTitle,
            source: sourceName,
            url: articleUrl,
            publishedDate: iframeDocument.querySelector('meta[property="article:published_time"]')?.getAttribute('content') || iframeDocument.querySelector('meta[name="publication_date"]')?.getAttribute('content') || '',
            author: iframeDocument.querySelector('meta[name="author"]')?.getAttribute('content') || iframeDocument.querySelector('meta[property="article:author"]')?.getAttribute('content') || '',
            publication: sourceName,
            serviceUsed: 'BPC'
        };
    }

    // Exposition globale
    global.Scraper = { scrapeArticle, initBpc };

})(window);
