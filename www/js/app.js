/**
 * app.js — Logique UI principale, gestion de l'état et navigation — Presse Scraper
 *
 * Dépendances (chargées avant ce fichier dans index.html) :
 *   - db.js   → window.DB
 *   - scraper.js → window.Scraper
 */
(function() {
    'use strict';

    // ===== CONFIG =====
    const STORAGE_KEY = 'presse_scraper_v3';

    // ===== ÉTAT GLOBAL =====
    let state = {
        // Ordre des providers (priorité de scraping)
        providerOrder: ['bpc', 'pressreader', 'cafeyn', 'bnf'],
        // Providers activés/désactivés
        providerEnabled: {
            bnf: true,
            cafeyn: true,
            pressreader: true,
            bpc: true
        },
        bnfUsername: '',
        bnfPassword: '',
        cafeynUsername: '',
        cafeynPassword: '',
        pressReaderCredentials: null,
        bnfCookies: null,
        bnfCookiesHeader: null,
        bnfCookiesExpiry: null,
        cafeynJwt: '',
        cafeynCookies: null,
        cafeynCookiesHeader: null,
        history: [],
        currentArticleId: null,
        sharedText: null,
        directScrapingEnabled: true,
        bpcRulesUpdated: false,
        bpcLastUpdated: '',
        onboardingSkipped: false
    };

    // ===== PERSISTANCE =====
    // Les identifiants (username/password) sont stockés exclusivement via le
    // plugin natif BnfLogin (EncryptedSharedPreferences + Keystore Android).
    // Les données de session (cookies, expiry) et l'historique restent dans
    // localStorage car ils ne constituent pas des secrets long-terme.

    function loadFromLocalStorage() {
        try {
            const s = localStorage.getItem(STORAGE_KEY);
            if (s) {
                const parsed = JSON.parse(s);
                // Migration de l'ancien format (provider unique) vers le nouveau (providerOrder)
                if (parsed.provider && !parsed.providerOrder) {
                    parsed.providerOrder = ['bpc', 'pressreader', 'cafeyn', 'bnf'];
                    parsed.providerEnabled = parsed.providerEnabled || {};
                    // Marquer l'ancien provider comme actif, désactiver les autres
                    const oldProvider = parsed.provider;
                    const providers = ['bpc', 'pressreader', 'cafeyn', 'bnf'];
                    providers.forEach(p => { parsed.providerEnabled[p] = (p === oldProvider); });
                }
                // Migration v2 : réordonner si l'ordre commence encore par 'bnf' (ancienne valeur par défaut)
                if (parsed.providerOrder && parsed.providerOrder[0] === 'bnf') {
                    parsed.providerOrder = ['bpc', 'pressreader', 'cafeyn', 'bnf'];
                    console.log('[MIGRATE] providerOrder réinitialisé à bpc-first');
                }
                Object.assign(state, parsed);
            }
        } catch(e) {}
    }

    function save() {
        // Persister les données non-sensibles dans localStorage
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            providerOrder: state.providerOrder || ['bpc', 'pressreader', 'cafeyn', 'bnf'],
            providerEnabled: state.providerEnabled || {},
            bnfCookies: state.bnfCookies,
            bnfCookiesHeader: state.bnfCookiesHeader,
            bnfCookiesExpiry: state.bnfCookiesExpiry,
            cafeynJwt: state.cafeynJwt || '',
            cafeynCookies: state.cafeynCookies,
            cafeynCookiesHeader: state.cafeynCookiesHeader,
            directScrapingEnabled: state.directScrapingEnabled !== false,
            bpcRulesUpdated: state.bpcRulesUpdated || false,
            bpcLastUpdated: state.bpcLastUpdated || '',
            onboardingSkipped: state.onboardingSkipped || false,
            history: state.history.map(h => ({
                id: h.id, title: h.title, url: h.url,
                source: h.source || h.site_source || '', date: h.date
            }))
        }));

        // Persister les identifiants de manière sécurisée via les plugins natifs
        if (typeof window.Capacitor !== 'undefined') {
            if (window.Capacitor.Plugins?.BnfLogin) {
                window.Capacitor.Plugins.BnfLogin.saveCredentials({
                    username: state.bnfUsername || '',
                    password: state.bnfPassword || ''
                }).catch(e => console.warn('[CREDS] BnF saveCredentials failed:', e));
            }
            if (window.Capacitor.Plugins?.CafeynLogin) {
                window.Capacitor.Plugins.CafeynLogin.saveCredentials({
                    username: state.cafeynUsername || '',
                    password: state.cafeynPassword || ''
                }).catch(e => console.warn('[CREDS] Cafeyn saveCredentials failed:', e));
            }
        }
    }

    // ===== INIT ASYNCHRONE =====
    async function init() {
        // 1. Charger les données non-sensibles depuis localStorage
        loadFromLocalStorage();

        // 2. Récupérer les identifiants depuis le stockage sécurisé natif
        if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
            try {
                const creds = await window.Capacitor.Plugins.BnfLogin.getCredentials();
                if (creds.username) state.bnfUsername = creds.username;
                if (creds.password) state.bnfPassword = creds.password;

                // Migration : si des identifiants existent encore dans localStorage en clair,
                // les sauvegarder dans le stockage sécurisé puis les effacer de localStorage
                const oldRaw = localStorage.getItem(STORAGE_KEY);
                if (oldRaw) {
                    try {
                        const old = JSON.parse(oldRaw);
                        if ((old.bnfUsername || old.bnfPassword) && !creds.username) {
                            state.bnfUsername = old.bnfUsername || '';
                            state.bnfPassword = old.bnfPassword || '';
                            await window.Capacitor.Plugins.BnfLogin.saveCredentials({
                                username: state.bnfUsername,
                                password: state.bnfPassword
                            });
                            console.log('[CREDS] Migration localStorage → EncryptedSharedPreferences OK');
                        }
                    } catch(e) {}
                }
            } catch(e) {
                console.warn('[CREDS] getCredentials failed, fallback localStorage:', e);
                // Fallback : tenter de lire depuis l’ancienne clé localStorage
                try {
                    const s = localStorage.getItem(STORAGE_KEY);
                    if (s) {
                        const parsed = JSON.parse(s);
                        if (parsed.bnfUsername) state.bnfUsername = parsed.bnfUsername;
                        if (parsed.bnfPassword) state.bnfPassword = parsed.bnfPassword;
                    }
                } catch(e2) {}
            }
        } else {
            // Hors contexte natif Android : fallback localStorage (ne devrait pas arriver en prod)
            try {
                const s = localStorage.getItem(STORAGE_KEY);
                if (s) {
                    const parsed = JSON.parse(s);
                    if (parsed.bnfUsername) state.bnfUsername = parsed.bnfUsername;
                    if (parsed.bnfPassword) state.bnfPassword = parsed.bnfPassword;
                }
            } catch(e) {}
        }

        // 2b. Charger les identifiants Cafeyn depuis le stockage sécurisé
        if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.CafeynLogin) {
            try {
                const creds = await window.Capacitor.Plugins.CafeynLogin.getCredentials();
                if (creds.username) state.cafeynUsername = creds.username;
                if (creds.password) state.cafeynPassword = creds.password;
            } catch(e) {
                console.warn('[CREDS] Cafeyn getCredentials failed:', e);
            }
        }

        // 3. Décider quel écran afficher
        if ((!state.bnfUsername || !state.bnfPassword) && !state.onboardingSkipped) {
            showOnboarding();
        } else {
            showMainApp();
        }
    }

    init();

    // ===== GESTION DES ÉCRANS =====
    let currentOnboardingSlide = 0;
    const totalOnboardingSlides = 6;

    window.toggleOnboardCafeynFields = function(visible) {
        document.getElementById('onboardCafeynFields').style.display = visible ? 'block' : 'none';
    };

    window.toggleOnboardCafeynAdvanced = function() {
        const el = document.getElementById('onboardCafeynAdvanced');
        el.style.display = el.style.display === 'none' ? 'block' : 'none';
    };

    window.toggleOnboardBnfFields = function(visible) {
        document.getElementById('onboardBnfFields').style.display = visible ? 'block' : 'none';
    };

    window.goToOnboardingSlide = function(index) {
        if (index < 0 || index >= totalOnboardingSlides) return;
        currentOnboardingSlide = index;
        updateOnboardingSlidesUI();
    };

    window.nextOnboardingSlide = function() {
        if (currentOnboardingSlide < totalOnboardingSlides - 1) {
            currentOnboardingSlide++;
            updateOnboardingSlidesUI();
        }
    };

    window.prevOnboardingSlide = function() {
        if (currentOnboardingSlide > 0) {
            currentOnboardingSlide--;
            updateOnboardingSlidesUI();
        }
    };

    function updateOnboardingSlidesUI() {
        const slides = document.querySelectorAll('.onboarding-slide');
        slides.forEach(s => {
            const idx = parseInt(s.getAttribute('data-slide'), 10);
            if (idx === currentOnboardingSlide) {
                s.classList.add('active');
            } else {
                s.classList.remove('active');
            }
        });

        document.getElementById('onboardingStepInfo').textContent = `Étape ${currentOnboardingSlide + 1} sur ${totalOnboardingSlides}`;

        const dots = document.querySelectorAll('.onboarding-dots .dot');
        dots.forEach((dot, idx) => {
            if (idx === currentOnboardingSlide) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });

        const prevBtn = document.getElementById('onboardPrevBtn');
        const nextBtn = document.getElementById('onboardNextBtn');

        if (currentOnboardingSlide === 0) {
            prevBtn.style.visibility = 'hidden';
        } else {
            prevBtn.style.visibility = 'visible';
        }

        if (currentOnboardingSlide === totalOnboardingSlides - 1) {
            nextBtn.style.visibility = 'hidden';
        } else {
            nextBtn.style.visibility = 'visible';
            if (currentOnboardingSlide === totalOnboardingSlides - 2) {
                nextBtn.innerHTML = 'Terminer <i class="fas fa-check"></i>';
            } else {
                nextBtn.innerHTML = 'Suivant <i class="fas fa-chevron-right"></i>';
            }
        }
    }

    function showOnboarding() {
        document.getElementById('onboardingScreen').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';

        if (state.bnfUsername) document.getElementById('onboardBnfUser').value = state.bnfUsername;
        if (state.bnfPassword) document.getElementById('onboardBnfPass').value = state.bnfPassword;
        if (state.cafeynUsername) document.getElementById('onboardCafeynUser').value = state.cafeynUsername;
        if (state.cafeynPassword) document.getElementById('onboardCafeynPass').value = state.cafeynPassword;
        if (window.Cafeyn?.cafeynState?.token) {
            document.getElementById('onboardCafeynToken').value = window.Cafeyn.cafeynState.token;
        }

        document.getElementById('onboardDirectToggle').checked = state.directScrapingEnabled !== false;
        document.getElementById('onboardPressreaderToggle').checked = state.providerEnabled.pressreader !== false;
        document.getElementById('onboardCafeynToggle').checked = state.providerEnabled.cafeyn !== false;
        document.getElementById('onboardBnfToggle').checked = state.providerEnabled.bnf !== false;

        toggleOnboardCafeynFields(state.providerEnabled.cafeyn !== false);
        toggleOnboardBnfFields(state.providerEnabled.bnf !== false);

        currentOnboardingSlide = 0;
        updateOnboardingSlidesUI();
    }

    async function showMainApp() {
        document.getElementById('onboardingScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        updateCookieStatusUI();
        await loadLocalHistory();
        updateSettingsUI();
        if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
            try { await window.Capacitor.Plugins.BnfLogin.requestNotificationPermission(); } catch(e) {}
        }
    }

    window.switchScreen = function(screenId) {
        const mainScreens = ['homeScreen', 'historyScreen', 'settingsScreen'];
        if (mainScreens.includes(screenId)) state.lastActiveScreen = screenId;

        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-btn').forEach(n => n.classList.remove('active'));
        document.getElementById(screenId).classList.add('active');
        document.querySelector(`.nav-btn[data-screen="${screenId}"]`)?.classList.add('active');

        if (screenId === 'historyScreen') renderFullHistory();
        if (screenId === 'settingsScreen') updateSettingsUI();
    };

    // ===== ONBOARDING WIZARD LOGIC =====
    window.onboardBnfLogin = async function() {
        const username = document.getElementById('onboardBnfUser').value.trim();
        const password = document.getElementById('onboardBnfPass').value;
        const errorEl = document.getElementById('onboardError');
        const successEl = document.getElementById('onboardSuccess');
        const btn = document.getElementById('onboardLoginBtn');

        if (!username || !password) {
            errorEl.textContent = 'Entrez vos identifiants BnF';
            errorEl.style.display = 'block';
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Connexion...';
        errorEl.style.display = 'none';
        successEl.style.display = 'none';

        try {
            const result = await nativeLogin(username, password);
            if (result.success && result.cookies) {
                state.bnfUsername = username;
                state.bnfPassword = password;
                state.bnfCookies = result.cookies;
                state.bnfCookiesHeader = result.cookieHeader || '';
                state.bnfCookiesExpiry = Date.now() + (8 * 60 * 60 * 1000);
                save();

                successEl.textContent = 'Connexion BnF réussie !';
                successEl.style.display = 'block';
                setTimeout(() => nextOnboardingSlide(), 1000);
            } else {
                errorEl.textContent = result.error || 'Échec de connexion';
                errorEl.style.display = 'block';
            }
        } catch(e) {
            errorEl.textContent = 'Erreur: ' + e.message;
            errorEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-key"></i> Tester et enregistrer la connexion';
        }
    };

    window.finishOnboarding = function() {
        const bpcActive = document.getElementById('onboardDirectToggle').checked;
        const prActive = document.getElementById('onboardPressreaderToggle').checked;
        const cafeynActive = document.getElementById('onboardCafeynToggle').checked;
        const bnfActive = document.getElementById('onboardBnfToggle').checked;

        state.providerEnabled.bpc = bpcActive;
        state.directScrapingEnabled = bpcActive;
        state.providerEnabled.pressreader = prActive;
        state.providerEnabled.cafeyn = cafeynActive;
        state.providerEnabled.bnf = bnfActive;

        if (cafeynActive) {
            const cafUser = document.getElementById('onboardCafeynUser').value.trim();
            const cafPass = document.getElementById('onboardCafeynPass').value;
            const cafToken = document.getElementById('onboardCafeynToken').value.trim();

            if (cafUser && cafPass) {
                state.cafeynUsername = cafUser;
                state.cafeynPassword = cafPass;
            }
            if (cafToken) {
                if (cafToken.startsWith('eyJ')) {
                    window.Cafeyn.saveToken(cafToken);
                }
            }
        }

        if (bnfActive) {
            const bnfUser = document.getElementById('onboardBnfUser').value.trim();
            const bnfPass = document.getElementById('onboardBnfPass').value;
            if (bnfUser && bnfPass) {
                state.bnfUsername = bnfUser;
                state.bnfPassword = bnfPass;
            }
        }

        state.onboardingSkipped = true;
        save();
        showMainApp();
    };

    window.skipOnboarding = function() {
        state.onboardingSkipped = true;
        save();
        showMainApp();
    };

    // ===== ACCÈS NATIF =====
    async function nativeLogin(username, password) {
        if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
            return await window.Capacitor.Plugins.BnfLogin.login({ username, password });
        }
        return { success: false, error: 'Plugin BnfLogin non disponible (mode navigateur)' };
    }

    async function showNativeNotification(title, body, articleId) {
        if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
            try {
                await window.Capacitor.Plugins.BnfLogin.showNotification({ title, body, articleId: articleId || '' });
            } catch(e) {}
        }
    }

    // ===== SESSION BnF =====
    function areCookiesValid() {
        if (!state.bnfCookies?.length) return false;
        if (!state.bnfCookiesExpiry) return false;
        return Date.now() < (state.bnfCookiesExpiry - 300000);
    }

    function updateCookieStatusUI() {
        const dot = document.getElementById('cookieDot');
        const text = document.getElementById('cookieText');
        const userDisplay = document.getElementById('bnfUserDisplay');

        if (areCookiesValid()) {
            dot.className = 'dot ok';
            const exp = new Date(state.bnfCookiesExpiry);
            text.textContent = `Session valide (expire ${exp.toLocaleDateString('fr-FR')} ${exp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`;
        } else if (state.bnfCookies?.length) {
            dot.className = 'dot expired';
            text.textContent = 'Session expirée';
        } else {
            dot.className = 'dot none';
            text.textContent = 'Non connecté';
        }

        userDisplay.textContent = state.bnfUsername ? `Connecté en tant que : ${state.bnfUsername}` : '';

        const headerDot = document.getElementById('sessionDot');
        if (headerDot) {
            headerDot.className = 'session-dot ' + (areCookiesValid() ? 'ok' : (state.bnfCookies?.length ? 'expired' : 'none'));
        }
    }

    // ===== UI STATUT =====
    function updateStatusUI(phase, message, progress) {
        document.getElementById('statusCard').className = 'status-card visible processing';
        document.getElementById('statusIcon').className = 'fas fa-spinner fa-spin';
        document.getElementById('statusTitle').textContent = message;
        document.getElementById('statusSub').textContent = phase;
        document.getElementById('progressFill').style.width = progress + '%';
    }

    // ===== SCRAPING =====
    window.startScraping = async function() {
        const input = document.getElementById('urlInput').value.trim();
        if (!input) { toast('Entrez un lien d\'article ou des mots-clés', 'error'); return; }

        if (window.Scraper) {
            window.Scraper.lastQuery = null;
        }

        let targetUrlOrQuery = '';
        let fallbackTitle = '';

        const urlMatch = input.match(/(https?:\/\/[^\s]+)/i);
        if (urlMatch) {
            targetUrlOrQuery = urlMatch[0];
            let restText = input.replace(targetUrlOrQuery, '').trim();
            restText = restText.replace(/^["'«"\s:—–-]+|["'»"\s:—–-]+$/g, '').trim();
            if (restText.length > 5) fallbackTitle = restText;
        } else {
            targetUrlOrQuery = input;
        }

        const btn = document.getElementById('scrapeBtn');
        const card = document.getElementById('statusCard');
        const icon = document.getElementById('statusIcon');
        const titleEl = document.getElementById('statusTitle');
        const sub = document.getElementById('statusSub');
        const fill = document.getElementById('progressFill');
        const actions = document.getElementById('actionRow');
        const openBtn = document.getElementById('openArticleBtn');

        btn.disabled = true;
        btn.classList.add('loading');
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>...';
        card.className = 'status-card visible processing';
        icon.className = 'fas fa-spinner fa-spin';
        titleEl.textContent = 'Vérification de la session BnF...';
        sub.textContent = '';
        fill.style.width = '5%';
        actions.style.display = 'none';
        openBtn.style.display = 'none';

        let sessionRetry = false;
        const startTime = Date.now();
        const MAX_SCRAPE_DURATION_MS = 120_000;
        try {
            while (true) {
                if (Date.now() - startTime > MAX_SCRAPE_DURATION_MS) {
                    throw new Error('Timeout global de scraping dépassé (120s)');
                }
                // Renouvellement automatique de session si expirée localement
                if (!areCookiesValid() && state.bnfUsername && state.bnfPassword) {
                    titleEl.textContent = 'Renouvellement de la session BnF...';
                    fill.style.width = '8%';
                    try {
                        const result = await nativeLogin(state.bnfUsername, state.bnfPassword);
                        if (result.success && result.cookies) {
                            state.bnfCookies = result.cookies;
                            state.bnfCookiesHeader = result.cookieHeader || '';
                            state.bnfCookiesExpiry = Date.now() + (8 * 60 * 60 * 1000);
                            save();
                        } else {
                            throw new Error(result.error || 'Reconnexion BnF échouée');
                        }
                    } catch(e) {
                        throw new Error('Session BnF invalide: ' + e.message + '. Reconnectez-vous dans Paramètres.');
                    }
                }
                updateCookieStatusUI();

                try {
                    // Scraping via le module Scraper
                    const scraped = await window.Scraper.scrapeArticle(targetUrlOrQuery, fallbackTitle, state, updateStatusUI);

                    // Génération PDF
                    updateStatusUI('PDF', 'Génération du PDF local...', 90);

                    const articleId = 'art_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
                    const pdfFileName = articleId + '.pdf';
                    let pdfPath = '';

                    if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
                        try {
                            const pdfRes = await window.Capacitor.Plugins.BnfLogin.printHtmlToPdf({
                                html: scraped.html,
                                filename: pdfFileName
                            });
                            if (pdfRes.success && pdfRes.path) pdfPath = pdfRes.path;
                        } catch(e) {
                            console.warn('[PDF] Generation failed:', e);
                        }
                    }

                    // Sauvegarde en IndexedDB
                    const articleRecord = {
                        id: articleId,
                        url: scraped.url,
                        title: scraped.title,
                        html_content: scraped.html,
                        pdf_path: pdfPath,
                        site_source: scraped.source,
                        date: new Date().toISOString()
                    };

                    await window.DB.saveArticleToDb(articleRecord);

                    state.history.unshift({
                        id: articleId, title: scraped.title, url: scraped.url,
                        source: scraped.source, date: articleRecord.date
                    });
                    if (state.history.length > 100) state.history = state.history.slice(0, 100);
                    save();

                    // UI succès
                    fill.style.width = '100%';
                    card.className = 'status-card visible success';
                    icon.className = 'fas fa-check-circle';
                    titleEl.textContent = '✅ Article téléchargé !';
                    sub.textContent = scraped.title;
                    state.currentArticleId = articleId;
                    actions.style.display = 'flex';
                    openBtn.style.display = 'flex';

                    resetScrapeBtn();
                    toast('✅ Article sauvegardé localement !', 'success');
                    showNativeNotification('📰 Article téléchargé', scraped.title, articleId);
                    renderHistory();
                    openArticleById(articleId);
                    break; // Sortie de la boucle si tout a réussi
                } catch(scrapeErr) {
                    // Si la session BnF a expiré et qu'on n'a pas encore réessayé, on se reconnecte et on boucle
                    if (scrapeErr.message && scrapeErr.message.includes('Session BnF expirée') && !sessionRetry && state.bnfUsername && state.bnfPassword) {
                        console.log('[SCRAPE] Session expired during scrape. Retrying login...');
                        titleEl.textContent = 'Session expirée, reconnexion BnF...';
                        fill.style.width = '15%';
                        
                        const result = await nativeLogin(state.bnfUsername, state.bnfPassword);
                        if (result.success && result.cookies) {
                            state.bnfCookies = result.cookies;
                            state.bnfCookiesHeader = result.cookieHeader || '';
                            state.bnfCookiesExpiry = Date.now() + (8 * 60 * 60 * 1000);
                            save();
                            sessionRetry = true;
                            continue; // Relancer le scraping
                        }
                    }
                    throw scrapeErr; // Lancer l'erreur si c'est un autre problème ou si le retry a déjà été tenté
                }
            }

        } catch(e) {
            console.error('[SCRAPE] Error:', e);
            card.className = 'status-card visible error';
            icon.className = 'fas fa-exclamation-triangle';
            document.getElementById('statusTitle').textContent = 'Erreur';
            document.getElementById('statusSub').textContent = e.message;
            
            // Si disponible, pré-remplit l'input avec les mots-clés générés pour modification
            if (window.Scraper && window.Scraper.lastQuery) {
                document.getElementById('urlInput').value = window.Scraper.lastQuery;
            }
            
            resetScrapeBtn();
        }
    };

    function resetScrapeBtn() {
        const btn = document.getElementById('scrapeBtn');
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.innerHTML = '<i class="fas fa-magic"></i> Scraper';
    }

    // ===== VISIONNEUSE D'ARTICLE =====
    window.openArticle = async function() {
        if (!state.currentArticleId) return;
        await openArticleById(state.currentArticleId);
    };

    async function openArticleById(articleId) {
        try {
            const article = await window.DB.getArticleFromDb(articleId);
            if (!article) { toast('Article introuvable', 'error'); return; }

            switchScreen('articleScreen');
            document.getElementById('viewerArticleTitle').textContent = article.title || 'Article';
            document.getElementById('articleContent').innerHTML = article.html_content || '<p>Contenu indisponible</p>';
            state.currentArticleId = articleId;
        } catch(e) {
            toast('Erreur: ' + e.message, 'error');
        }
    }

    window.closeArticle = function() {
        document.getElementById('articleContent').innerHTML = '';
        switchScreen(state.lastActiveScreen || 'homeScreen');
    };

    window.openPdf = async function() {
        if (!state.currentArticleId) return;
        try {
            const article = await window.DB.getArticleFromDb(state.currentArticleId);
            if (!article || !article.pdf_path) { toast('PDF non disponible', 'error'); return; }
            if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
                const res = await window.Capacitor.Plugins.BnfLogin.openPdfFile({ path: article.pdf_path });
                if (!res.success) toast(res.error || 'Erreur ouverture PDF', 'error');
            } else {
                toast('Ouverture PDF disponible uniquement sur Android', 'error');
            }
        } catch(e) {
            toast('Erreur: ' + e.message, 'error');
        }
    };

    window.shareArticle = async function() {
        const articleId = state.currentArticleId;
        if (!articleId) return;

        const article = await window.DB.getArticleFromDb(articleId);
        if (!article) return;
        const articleTitle = article.title || 'Article';
        const articleUrl = article.url || '';

        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = article.html_content || '';
        tempDiv.querySelectorAll('style').forEach(s => s.remove());
        const plainText = tempDiv.innerText || tempDiv.textContent || '';
        const shareText = plainText || articleTitle;

        if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.Share) {
            try {
                await window.Capacitor.Plugins.Share.share({
                    title: articleTitle,
                    text: shareText,
                    url: articleUrl,
                    dialogTitle: 'Partager l\'article'
                });
            } catch(e) {}
        } else if (navigator.share) {
            try { await navigator.share({ title: articleTitle, text: shareText, url: articleUrl }); } catch(e) {}
        } else {
            try {
                await navigator.clipboard.writeText(shareText);
                toast('Texte copié !', 'success');
            } catch(e) {
                // fallback
                await navigator.clipboard.writeText(articleUrl);
                toast('Lien copié !', 'success');
            }
        }
    };

    window.copyArticleText = async function() {
        const articleId = state.currentArticleId;
        if (!articleId) return;

        try {
            const article = await window.DB.getArticleFromDb(articleId);
            if (!article) return;

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = article.html_content || '';
            tempDiv.querySelectorAll('style').forEach(s => s.remove());
            const plainText = tempDiv.innerText || tempDiv.textContent || '';

            await navigator.clipboard.writeText(plainText);
            toast('Article copié dans le presse-papiers !', 'success');
        } catch(e) {
            toast('Erreur lors de la copie : ' + e.message, 'error');
        }
    };

    window.confirmDeleteArticle = async function() {
        const articleId = state.currentArticleId;
        if (!articleId) return;
        if (!confirm('Voulez-vous vraiment supprimer cet article ?')) return;

        try {
            await window.DB.deleteArticleFromDb(articleId);
            const idx = state.history.findIndex(h => h.id === articleId);
            if (idx >= 0) { state.history.splice(idx, 1); save(); }
            toast('Article supprimé', 'success');
            closeArticle();
            renderHistory();
            renderFullHistory();
        } catch(e) {
            toast('Erreur: ' + e.message, 'error');
        }
    };

    window.viewArticle = async function(articleId) {
        state.currentArticleId = articleId;
        await openArticle();
    };

    // ===== HISTORIQUE =====
    async function loadLocalHistory() {
        try {
            const articles = await window.DB.getAllArticlesFromDb();
            const ids = new Set(state.history.map(h => h.id));
            for (const a of articles) {
                if (!ids.has(a.id)) {
                    state.history.push({
                        id: a.id, title: a.title, url: a.url,
                        source: a.site_source || '', date: a.date
                    });
                }
            }
            state.history.sort((a, b) => new Date(b.date) - new Date(a.date));
            save();
            renderHistory();
        } catch(e) {
            console.error('loadLocalHistory failed:', e);
        }
    }

    function renderHistory() {
        const list = document.getElementById('historyList');
        const recent = state.history.slice(0, 5);
        if (!recent.length) {
            list.innerHTML = '<div class="empty"><i class="fas fa-inbox"></i><p>Aucun article</p></div>';
            return;
        }
        list.innerHTML = recent.map(item => `
            <div class="history-item" onclick="viewArticle('${item.id}')">
                <div class="icon pdf"><i class="fas fa-file-pdf"></i></div>
                <div class="info">
                    <div class="title">${escapeHtml(item.title)}</div>
                    <div class="meta">${item.source || ''} · ${formatDate(item.date)}</div>
                </div>
                <span class="badge done">OK</span>
            </div>
        `).join('');
    }

    function renderFullHistory() {
        const list = document.getElementById('fullHistoryList');
        if (!state.history.length) {
            list.innerHTML = '<div class="empty"><i class="fas fa-inbox"></i><p>Aucun article</p></div>';
            return;
        }
        list.innerHTML = state.history.map(item => `
            <div class="history-item" onclick="viewArticle('${item.id}')">
                <div class="icon pdf"><i class="fas fa-file-pdf"></i></div>
                <div class="info">
                    <div class="title">${escapeHtml(item.title)}</div>
                    <div class="meta">${item.source || ''} · ${formatDate(item.date)}</div>
                </div>
                <span class="badge done">OK</span>
            </div>
        `).join('');
    }

    // ===== PARAMÈTRES =====
    function updateSettingsUI() {
        updateProviderUI();
        updateCookieStatusUI();
        updateCafeynStatusUI();
        document.getElementById('cacheCount').textContent = state.history.length;
        
        const toggle = document.getElementById('directScrapingToggle');
        if (toggle) toggle.checked = (state.directScrapingEnabled !== false);
        updateBpcStatusUI();
    }

    function updateBpcStatusUI() {
        const dot = document.getElementById('bpcRulesDot');
        const text = document.getElementById('bpcRulesText');
        if (!dot || !text) return;
        if (state.bpcRulesUpdated) {
            dot.className = 'dot ok';
            let dateStr = '';
            if (state.bpcLastUpdated) {
                try {
                    dateStr = ' (' + new Date(state.bpcLastUpdated).toLocaleDateString() + ')';
                } catch(e) {}
            }
            text.textContent = 'Règles distantes actives' + dateStr;
        } else {
            dot.className = 'dot none';
            text.textContent = 'Règles locales actives';
        }
    }

    window.toggleDirectScraping = function(enabled) {
        state.directScrapingEnabled = enabled;
        save();
    };


    window.updateBpcRules = async function() {
        const btn = document.getElementById('updateBpcBtn');
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Mise à jour...';
        toast('Mise à jour des règles BPC...', '');

        try {
            const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
            
            if (typeof window.Capacitor !== 'undefined' && BnfLogin && typeof BnfLogin.downloadAndExtractBpcRules === 'function') {
                const res = await BnfLogin.downloadAndExtractBpcRules();
                if (!res || !res.success) {
                    throw new Error(res?.error || 'Erreur lors du téléchargement ou de l\'extraction');
                }
                
                // Sauvegarde dans localStorage
                localStorage.setItem('bpc_sites_js', res.sites_js);
                localStorage.setItem('bpc_script_js', res.script_js);
                localStorage.setItem('bpc_script_fr_js', res.script_fr_js);
            } else {
                throw new Error("La mise à jour des règles BPC nécessite d'être sur l'application mobile.");
            }

            state.bpcRulesUpdated = true;
            state.bpcLastUpdated = new Date().toISOString();
            save();

            // Re-initialisation du scraper
            if (window.Scraper && typeof window.Scraper.initBpc === 'function') {
                await window.Scraper.initBpc();
            }

            updateBpcStatusUI();
            toast('Règles BPC mises à jour !', 'success');
        } catch(e) {
            console.error('[BPC] Update failed:', e);
            toast('Mise à jour échouée: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-sync"></i> Mettre à jour les règles';
        }
    };

    window.reconnectBnf = async function() {
        if (!state.bnfUsername || !state.bnfPassword) { showOnboarding(); return; }
        toast('Reconnexion en cours...', '');
        try {
            const result = await nativeLogin(state.bnfUsername, state.bnfPassword);
            if (result.success && result.cookies) {
                state.bnfCookies = result.cookies;
                state.bnfCookiesHeader = result.cookieHeader || '';
                state.bnfCookiesExpiry = Date.now() + (8 * 60 * 60 * 1000);
                save();
                updateCookieStatusUI();
                toast('Session BnF renouvelée', 'success');
            } else {
                toast(result.error || 'Échec', 'error');
            }
        } catch(e) {
            toast('Erreur: ' + e.message, 'error');
        }
    };

    window.disconnectBnf = function() {
        state.bnfCookies = null;
        state.bnfCookiesHeader = null;
        state.bnfCookiesExpiry = null;
        state.bnfUsername = '';
        state.bnfPassword = '';
        state.onboardingSkipped = false;
        save();

        // Effacer les identifiants du stockage sécurisé natif
        if (typeof window.Capacitor !== 'undefined' && window.Capacitor.Plugins?.BnfLogin) {
            window.Capacitor.Plugins.BnfLogin.clearCredentials().catch(e =>
                console.warn('[CREDS] clearCredentials failed:', e)
            );
        }

        updateCookieStatusUI();
        toast('Session BnF supprimée', '');
        showOnboarding();
    };

    // ===== GESTION DES FOURNISSEURS ORDONNÉS =====
    const PROVIDER_LABELS = {
        bnf: 'BnF Europresse',
        cafeyn: 'Cafeyn',
        pressreader: 'PressReader',
        bpc: 'Bypass Paywall (direct)'
    };

    window.renderProviderOrderList = function() {
        const container = document.getElementById('providerOrderList');
        if (!container) return;
        let html = '';
        state.providerOrder.forEach((key, i) => {
            const enabled = state.providerEnabled[key] !== false;
            const isFirst = i === 0;
            const isLast = i === state.providerOrder.length - 1;
            html += `
                <div class="provider-order-item${enabled ? '' : ' disabled'}">
                    <button class="order-btn toggle-btn" onclick="toggleProvider('${key}')" title="${enabled ? 'Désactiver' : 'Activer'}">
                        <i class="${enabled ? 'fas fa-check-square' : 'far fa-square'}"></i>
                    </button>
                    <span class="provider-name">${PROVIDER_LABELS[key] || key}</span>
                    <div class="order-arrows">
                        <button class="order-btn arrow-btn" onclick="moveProviderUp('${key}')" ${isFirst ? 'disabled' : ''}>
                            <i class="fas fa-chevron-up"></i>
                        </button>
                        <button class="order-btn arrow-btn" onclick="moveProviderDown('${key}')" ${isLast ? 'disabled' : ''}>
                            <i class="fas fa-chevron-down"></i>
                        </button>
                    </div>
                    <button class="order-btn config-btn" onclick="showProviderConfig('${key}')" title="Configurer">
                        <i class="fas fa-cog"></i>
                    </button>
                </div>`;
        });
        container.innerHTML = html;
    };

    window.moveProviderUp = function(key) {
        const idx = state.providerOrder.indexOf(key);
        if (idx <= 0) return;
        [state.providerOrder[idx-1], state.providerOrder[idx]] = [state.providerOrder[idx], state.providerOrder[idx-1]];
        save();
        renderProviderOrderList();
        updateProviderUI();
    };

    window.moveProviderDown = function(key) {
        const idx = state.providerOrder.indexOf(key);
        if (idx === -1 || idx >= state.providerOrder.length - 1) return;
        [state.providerOrder[idx], state.providerOrder[idx+1]] = [state.providerOrder[idx+1], state.providerOrder[idx]];
        save();
        renderProviderOrderList();
        updateProviderUI();
    };

    window.toggleProvider = function(key) {
        if (state.providerEnabled[key] === undefined) state.providerEnabled[key] = true;
        state.providerEnabled[key] = !state.providerEnabled[key];
        save();
        renderProviderOrderList();
        updateProviderUI();
    };

    window.showProviderConfig = function(key) {
        // Cacher tous les panels
        ['bnf', 'cafeyn', 'pressreader', 'bpc'].forEach(k => {
            const el = document.getElementById(k + 'ProviderConfig');
            if (el) el.style.display = 'none';
        });
        // Afficher celui demandé
        const el = document.getElementById(key + 'ProviderConfig');
        if (el) el.style.display = 'block';
        // Scroll
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    function updateProviderUI() {
        renderProviderOrderList();
        // Afficher/masquer les panels de config selon l'état des providers
        ['bnf', 'cafeyn', 'pressreader', 'bpc'].forEach(k => {
            const el = document.getElementById(k + 'ProviderConfig');
            if (el && state.providerEnabled[k] !== false) {
                el.style.display = 'block';
            } else if (el) {
                el.style.display = 'none';
            }
        });
    }

    // ===== CAFEYN =====
    window.reconnectCafeyn = async function() {
        if (!state.cafeynUsername || !state.cafeynPassword) {
            toast('Enregistrez d\'abord vos identifiants ci-dessous', 'error');
            document.getElementById('cafeynUsernameInput')?.focus();
            return;
        }
        toast('Connexion Cafeyn via WebView...', '');
        try {
            const result = await nativeCafeynLogin(state.cafeynUsername, state.cafeynPassword);
            if (result.success && result.jwt) {
                await window.Cafeyn.saveToken(result.jwt);
                state.cafeynCookies = result.cookies || null;
                state.cafeynCookiesHeader = result.cookieHeader || null;
                save();
                updateCafeynStatusUI();
                toast('Session Cafeyn établie !', 'success');
            } else {
                toast(result.error || 'Échec de connexion Cafeyn', 'error');
            }
        } catch(e) {
            toast('Erreur: ' + e.message, 'error');
        }
    };

    window.saveCafeynCredentials = function() {
        const u = document.getElementById('cafeynUsernameInput').value.trim();
        const p = document.getElementById('cafeynPasswordInput').value;
        if (!u || !p) {
            toast('Veuillez remplir l\'identifiant et le mot de passe', 'error');
            return;
        }
        state.cafeynUsername = u;
        state.cafeynPassword = p;
        save();
        updateCafeynStatusUI();
        toast('Identifiants Cafeyn enregistrés !', 'success');
        reconnectCafeyn();
    };

    async function nativeCafeynLogin(username, password) {
        const plugin = window.Capacitor?.Plugins?.CafeynLogin;
        if (!plugin || typeof plugin.login !== 'function') {
            throw new Error("Plugin Cafeyn non disponible. Utilisez l'application mobile.");
        }
        const result = await plugin.login({ username, password });
        return result;
    }

    window.saveCafeynToken = async function() {
        const input = document.getElementById('cafeynTokenInput');
        const token = input.value.trim();
        if (!token) {
            toast('Entrez un token JWT', 'error');
            return;
        }
        if (!token.startsWith('eyJ')) {
            toast('Token invalide (doit commencer par eyJ...)', 'error');
            return;
        }
        await window.Cafeyn.saveToken(token);
        input.value = '';
        updateCafeynStatusUI();
        toast('Token Cafeyn sauvegardé !', 'success');
    };

    window.clearCafeynToken = async function() {
        await window.Cafeyn.clearToken();
        updateCafeynStatusUI();
        toast('Token Cafeyn effacé', '');
    };

    function updateCafeynStatusUI() {
        const dot = document.getElementById('cafeynDot');
        const text = document.getElementById('cafeynText');
        const display = document.getElementById('cafeynUserDisplay');
        
        const uInput = document.getElementById('cafeynUsernameInput');
        const pInput = document.getElementById('cafeynPasswordInput');
        if (uInput && state.cafeynUsername && !uInput.value) uInput.value = state.cafeynUsername;
        if (pInput && state.cafeynPassword && !pInput.value) pInput.value = state.cafeynPassword;

        if (window.Cafeyn.isTokenValid()) {
            dot.className = 'dot ok';
            const exp = new Date(window.Cafeyn.state.tokenExpiry);
            text.textContent = `Session valide (expire ${exp.toLocaleDateString('fr-FR')})`;
            if (display) display.textContent = '👤 ' + (state.cafeynUsername || 'Cafeyn');
        } else if (window.Cafeyn.state.token) {
            dot.className = 'dot expired';
            text.textContent = 'Token expiré';
            if (display) display.textContent = '';
        } else {
            dot.className = 'dot none';
            text.textContent = 'Non connecté';
            if (display) display.textContent = '';
        }
    }

    window.clearCache = async function() {
        if (!confirm('Supprimer tous les articles sauvegardés ?')) return;
        try { await window.DB.clearAllArticlesFromDb(); } catch(e) {}
        state.history = [];
        save();
        renderHistory();
        renderFullHistory();
        updateSettingsUI();
        toast('Cache vidé', '');
    };

    // ===== CONTENU PARTAGÉ =====
    let lastProcessedIntentText = null;
    let lastProcessedIntentTime = 0;

    window.handleSharedContent = function(text) {
        if (!text) return;
        const now = Date.now();
        if (text === lastProcessedIntentText && (now - lastProcessedIntentTime) < 4000) return;
        lastProcessedIntentText = text;
        lastProcessedIntentTime = now;

        console.log('[SHARE] Processing:', text);
        state.sharedText = text;

        switchScreen('homeScreen');
        const urlInput = document.getElementById('urlInput');
        if (urlInput) {
            urlInput.value = text;
            startScraping();
        }
    };

    document.getElementById('useSharedBtn').addEventListener('click', () => {
        if (state.sharedText) {
            document.getElementById('urlInput').value = state.sharedText;
            document.getElementById('sharedBanner').classList.remove('visible');
            document.getElementById('urlInput').focus();
        }
    });

    // ===== HELPERS UTILITAIRES =====
    function toast(msg, type) {
        type = type || '';
        const el = document.getElementById('toast');
        document.getElementById('toastText').textContent = msg;
        el.className = 'toast ' + type + ' show';
        clearTimeout(window._toastTimer);
        window._toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
    }

    function escapeHtml(s) {
        if (!s) return '';
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDate(d) {
        if (!d) return '';
        const date = new Date(d);
        const now = new Date();
        const diff = (now - date) / 1000;
        if (diff < 60) return 'À l\'instant';
        if (diff < 3600) return Math.floor(diff / 60) + ' min';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h';
        return date.toLocaleDateString('fr-FR');
    }

    window.openExternal = function(url) {
        window.open(url, '_blank');
    };

    // ===== INTÉGRATION ANDROID / CAPACITOR =====
    if (typeof window.Capacitor !== 'undefined') {
        console.log('[INIT] Capacitor detected');

        if (window.Capacitor.Plugins?.IntentForwarder) {
            window.Capacitor.Plugins.IntentForwarder.addListener('intentReceived', (result) => {
                if (result?.data) handleSharedContent(result.data);
            });
            window.Capacitor.Plugins.IntentForwarder.getLastIntent().then((result) => {
                if (result?.data) handleSharedContent(result.data);
            }).catch(() => {});
        }

        window.addEventListener('sharedText', (e) => { if (e.url) handleSharedContent(e.url); });
        window.addEventListener('sharedUrl', (e) => { if (e.url) handleSharedContent(e.url); });

        document.addEventListener('openArticle', (e) => {
            if (e.detail) {
                state.currentArticleId = e.detail;
                openArticleById(e.detail);
            }
        });

        if (window.Capacitor.Plugins?.App) {
            window.Capacitor.Plugins.App.addListener('appStateChange', (stateInfo) => {
                if (stateInfo.isActive && window.Capacitor.Plugins?.IntentForwarder) {
                    window.Capacitor.Plugins.IntentForwarder.getLastIntent().then((result) => {
                        if (result?.data) handleSharedContent(result.data);
                    }).catch(() => {});
                }
            });
        }
    }

})();
