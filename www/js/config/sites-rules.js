/**
 * sites-rules.js — Configuration dynamique et communautaire des règles d'extraction
 * ==================================================================================
 * Gère les sélecteurs de contenu et conditions de contournement pour chaque média.
 * 
 * Priorité de résolution :
 *   1. Surcharges locales de l'utilisateur (localStorage: 'ps_user_sites_rules')
 *   2. Règles distantes synchronisées depuis GitHub (localStorage: 'ps_remote_sites_rules')
 *   3. Règles par défaut embarquées dans l'application (DEFAULT_RULES)
 */
(function(global) {
    'use strict';

    const STORAGE_KEY_USER = 'ps_user_sites_rules';
    const STORAGE_KEY_REMOTE = 'ps_remote_sites_rules';
    const REMOTE_RULES_URL = 'https://raw.githubusercontent.com/muarf/pressscraper/master/www/js/config/sites-rules.json';

    const DEFAULT_PAYWALL_SELECTOR = 'div[id*="paywall"], section[class*="paywall"], div[class*="paywall"], #poool-widget, meta[name="premium"][content="true"], div.post-subscribe, div.post__content--faded';
    const DEFAULT_CONTENT_SELECTOR = 'article, [itemprop="articleBody"], .article-body, .article';

    const DEFAULT_RULES = {
        version: 7,
        sites: {
            "lemonde.fr": {
                name: "Le Monde",
                contentSelector: ".article__content",
                paywallSelector: "section.lmd-paywall",
                paragraphSelector: ".article__paragraph",
                minParagraphs: 3
            },
            "lefigaro.fr": {
                name: "Le Figaro",
                contentSelector: "div[data-component=\"fig-content-body\"]",
                paywallSelector: "div#fig-premium-paywall",
                paragraphSelector: ".fig-paragraph",
                minParagraphs: 3
            },
            "leparisien.fr": {
                name: "Le Parisien",
                contentSelector: "section#left",
                paywallSelector: "div.paywall",
                minTextLength: 800
            },
            "liberation.fr": {
                name: "Libération",
                contentSelector: "article[data-datawall-status], article, .article-body, .article__content",
                paywallSelector: "div#poool-widget, div.post-subscribe"
            },
            "lepoint.fr": {
                name: "Le Point",
                contentSelector: ".article-content, .article-body"
            },
            "marianne.net": {
                name: "Marianne",
                contentSelector: ".article-body"
            },
            "mediapart.fr": {
                name: "Mediapart",
                contentSelector: ".content-article"
            },
            "la-croix.com": {
                name: "La Croix",
                contentSelector: ".article-body"
            },
            "lesoir.be": {
                name: "Le Soir",
                contentSelector: ".r-content, article.r-article"
            },
            "lamontagne.fr": {
                name: "La Montagne (Centre France)",
                aliases: ["lepopulaire.fr", "larep.fr", "le-pays.fr"],
                contentSelector: "div#content section > div.flex-col"
            },
            "letemps.ch": {
                name: "Le Temps",
                contentSelector: "div#article-body-wrapper"
            },
            "courrierinternational.com": {
                name: "Courrier International",
                contentSelector: "div.article-text"
            },
            "lesechos.fr": {
                name: "Les Échos",
                contentSelector: "article, div.post-paywall, .post-content, div[class*='article-body']",
                paywallSelector: "div#paywall, div#registerWall, div[class*='paywall']",
                minParagraphs: 4,
                minTextLength: 1200
            },
            "challenges.fr": {
                name: "Challenges",
                contentSelector: "article, .article-content, div[class*='article__content']",
                minParagraphs: 4,
                minTextLength: 1500
            },
            "alternatives-economiques.fr": {
                name: "Alternatives Économiques",
                contentSelector: "article, .article__content, div[class*='article-body']",
                minParagraphs: 3,
                minTextLength: 1200
            },
            "charliehebdo.fr": {
                name: "Charlie Hebdo",
                contentSelector: "article, .article-content, div[class*='article-body']",
                minParagraphs: 3,
                minTextLength: 1200
            },
            "sciencesetavenir.fr": {
                name: "Sciences et Avenir",
                contentSelector: "article, .article-content, div[class*='article__content']",
                minParagraphs: 3,
                minTextLength: 1000
            },
            "atlantico.fr": {
                name: "Atlantico",
                contentSelector: "article, div[class*='article-body'], .article-content",
                minParagraphs: 4,
                minTextLength: 1500
            },
            "lejdd.fr": {
                name: "Le Journal du Dimanche",
                contentSelector: "article, div[class*='article-body'], .article-content, div.article__content",
                paywallSelector: ".forbidden, div.paywall",
                removeSelector: ".forbidden, div.premium-hidden, div.p-aside--placeholder, section.outbrain-container",
                minParagraphs: 3,
                minTextLength: 1200
            },
            "sudouest.fr": {
                name: "Sud Ouest",
                aliases: ["charentelibre.fr", "larepubliquedespyrenees.fr"],
                contentSelector: "article, .article-content, div[class*='article-content'], div.content",
                removeSelector: ".visible-not-premium, .footer-premium, div.pub, div.ph-easy-subscription",
                minParagraphs: 3,
                minTextLength: 1200
            },
            "capital.fr": {
                name: "Capital",
                contentSelector: "article, div#articleWall, .article-content, div[class*='article-body']",
                removeSelector: "div#articleWall-wrapper, div.ap-AdContainer",
                minParagraphs: 3,
                minTextLength: 1200
            },
            "causeur.fr": {
                name: "Causeur",
                contentSelector: "article, .entry-content, .article-content, div[class*='article-body']",
                removeSelector: ".qiota-wrapper, .qiota-container, [id*='qiota']",
                minParagraphs: 3,
                minTextLength: 1200
            },
            "le1hebdo.fr": {
                name: "Le 1 Hebdo",
                contentSelector: "article, .article-content, div[class*='article']",
                removeSelector: ".qiota-wrapper, .qiota-container, [id*='qiota']",
                minParagraphs: 3,
                minTextLength: 1000
            },
            "60millions-mag.com": {
                name: "60 Millions de consommateurs",
                contentSelector: "article, .article-news__col-left, div[class*='article-news']",
                minParagraphs: 3,
                minTextLength: 1000
            },
            "actu.fr": {
                name: "Actu.fr",
                contentSelector: "article, .js-article-inner, .article-body",
                minParagraphs: 2,
                minTextLength: 800
            },
            "ladepeche.fr": {
                name: "Groupe La Dépêche",
                aliases: ["midilibre.fr", "lindependant.fr", "centrepresseaveyron.fr", "petitbleu.fr", "nrpyrenees.fr"],
                contentSelector: "article, .article-full, .content-article, div[class*='article']",
                minParagraphs: 3,
                minTextLength: 1000
            },
            "leprogres.fr": {
                name: "Groupe EBRA",
                aliases: ["dna.fr", "lalsace.fr", "estrepublicain.fr", "republicain-lorrain.fr", "vosgesmatin.fr"],
                contentSelector: "article, .richcontent, .article-body, div[class*='richcontent']",
                minParagraphs: 3,
                minTextLength: 1000
            },
            "elle.fr": {
                name: "Elle Magazine",
                contentSelector: "article, .article, .js-article, div[class*='article__content']",
                minParagraphs: 2,
                minTextLength: 800
            },
            "lalibre.be": {
                name: "Groupe IPM (La Libre Belgique)",
                aliases: ["dhnet.be", "moustique.be"],
                contentSelector: "article, .ap-Story, .article-body, div[class*='article']",
                minParagraphs: 3,
                minTextLength: 1000
            },
            "telerama.fr": {
                name: "Télérama",
                contentSelector: "article.article__page-content, article, div.article__content",
                paywallSelector: "section.paywall, div.paywall",
                paragraphSelector: "article.article__page-content p, article p",
                minParagraphs: 3,
                minTextLength: 1000
            },
            "franc-tireur.fr": {
                name: "Franc-Tireur",
                contentSelector: "#js-article-content, section.article-body, article.article, .article-body",
                paywallSelector: "div#poool-widget-content, #poool-widget, div[id*='poool']",
                minParagraphs: 3,
                minTextLength: 1000
            }
        }
    };

    function safeJsonParse(val, fallback) {
        if (!val) return fallback;
        try { return JSON.parse(val); } catch (e) { return fallback; }
    }

    function getUserRules() {
        return safeJsonParse(localStorage.getItem(STORAGE_KEY_USER), {});
    }

    function getRemoteRules() {
        const cached = safeJsonParse(localStorage.getItem(STORAGE_KEY_REMOTE), null);
        if (cached && (!cached.version || cached.version < DEFAULT_RULES.version)) {
            try { localStorage.removeItem(STORAGE_KEY_REMOTE); } catch(_) {}
            return null;
        }
        return cached;
    }

    /**
     * Retourne la liste fusionnée de toutes les règles (défaut < distant < utilisateur)
     */
    function getAllRules() {
        const remote = getRemoteRules();
        const baseSites = (remote && remote.sites) ? { ...DEFAULT_RULES.sites, ...remote.sites } : { ...DEFAULT_RULES.sites };
        const userSites = getUserRules();
        return { ...baseSites, ...userSites };
    }

    /**
     * Recherche la règle appropriée pour un nom de domaine donné (ex: 'www.lemonde.fr' -> 'lemonde.fr')
     */
    function getRuleForDomain(hostname) {
        if (!hostname) return null;
        const cleanHost = hostname.toLowerCase().replace(/^www\./, '');
        const all = getAllRules();

        // 1. Correspondance directe ou suffixe de domaine
        for (const [domainKey, rule] of Object.entries(all)) {
            if (cleanHost === domainKey || cleanHost.endsWith('.' + domainKey)) {
                return { domain: domainKey, ...rule };
            }
            // Vérification des alias (ex: lamontagne.fr regroupe lepopulaire, larep...)
            if (rule.aliases && Array.isArray(rule.aliases)) {
                for (const alias of rule.aliases) {
                    if (cleanHost === alias || cleanHost.endsWith('.' + alias)) {
                        return { domain: domainKey, alias, ...rule };
                    }
                }
            }
        }

        return null;
    }

    /**
     * Évalue si le contournement/l'extraction est terminée avec succès pour un document donné
     */
    function checkBypassSuccess(rule, iframeDoc, textLength, pendingAsync) {
        if (!iframeDoc) return false;

        const effectivePaywallSelector = rule?.paywallSelector || DEFAULT_PAYWALL_SELECTOR;
        const hasPaywall = iframeDoc.querySelector(effectivePaywallSelector);
        const paywallGone = !hasPaywall;

        // Condition par nombre de paragraphes
        if (rule?.paragraphSelector && rule?.minParagraphs) {
            const paragraphs = iframeDoc.querySelectorAll(rule.paragraphSelector).length;
            return paragraphs >= rule.minParagraphs && paywallGone;
        }

        // Condition par longueur minimale de texte
        if (rule?.minTextLength) {
            return textLength >= rule.minTextLength && paywallGone;
        }

        // Condition générique par défaut
        return paywallGone && textLength > 800 && (pendingAsync || 0) === 0;
    }

    /**
     * Enregistre ou met à jour une règle personnalisée locale
     */
    function setUserRule(domain, ruleObj) {
        if (!domain) return false;
        const cleanDomain = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        const userRules = getUserRules();
        userRules[cleanDomain] = {
            name: ruleObj.name || cleanDomain,
            contentSelector: ruleObj.contentSelector || DEFAULT_CONTENT_SELECTOR,
            paywallSelector: ruleObj.paywallSelector || '',
            minParagraphs: ruleObj.minParagraphs || undefined,
            minTextLength: ruleObj.minTextLength || undefined,
            updatedAt: Date.now()
        };
        localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userRules));
        return true;
    }

    /**
     * Supprime une règle personnalisée locale
     */
    function removeUserRule(domain) {
        const cleanDomain = domain.toLowerCase().trim();
        const userRules = getUserRules();
        if (userRules[cleanDomain]) {
            delete userRules[cleanDomain];
            localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(userRules));
            return true;
        }
        return false;
    }

    /**
     * Synchronise les règles depuis GitHub Raw en arrière-plan
     */
    async function syncFromRemote() {
        try {
            console.log('[SitesRules] Vérification des règles distantes...');
            const res = await fetch(REMOTE_RULES_URL, { cache: 'no-cache' });
            if (!res.ok) {
                console.warn('[SitesRules] Échec récupération règles distantes (HTTP ' + res.status + ')');
                return false;
            }
            const data = await res.json();
            if (data && data.sites && typeof data.sites === 'object') {
                if (data.version && data.version >= DEFAULT_RULES.version) {
                    localStorage.setItem(STORAGE_KEY_REMOTE, JSON.stringify(data));
                    console.log('[SitesRules] Règles distantes mises à jour :', Object.keys(data.sites).length, 'sites (v' + data.version + ').');
                    return true;
                } else {
                    console.log('[SitesRules] Règles distantes (v' + (data.version || 0) + ') inférieures aux règles embarquées (v' + DEFAULT_RULES.version + '), conservation des règles embarquées.');
                    try { localStorage.removeItem(STORAGE_KEY_REMOTE); } catch(_) {}
                }
            }
        } catch (e) {
            console.warn('[SitesRules] Erreur de synchronisation distante :', e.message);
        }
        return false;
    }

    global.SitesRules = {
        getRuleForDomain,
        getAllRules,
        getUserRules,
        setUserRule,
        removeUserRule,
        checkBypassSuccess,
        syncFromRemote,
        DEFAULT_CONTENT_SELECTOR,
        DEFAULT_PAYWALL_SELECTOR,
        DEFAULT_RULES
    };

})(window);
