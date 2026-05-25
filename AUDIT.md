# Audit Complet — Presse Scraper

Date : 25 mai 2026  
Version du code : `17e31d1`  
Type : Application Android (Capacitor/Ionic) — scraping d'articles de presse

---

## 1. SÉCURITÉ

| # | Problème | Fichier | Gravité |
|---|----------|---------|---------|
| 1 | Stockage localStorage en clair des credentials Cafeyn (JWT token + username/password) | `www/js/cafeyn.js:38-61` | **CRITIQUE** |
| 2 | `eval()` / `new Function()` sur code externe BPC — risque XSS si serveur compromis | `www/js/scraper.js:309` | **CRITIQUE** |
| 3 | Iframe sandboxé avec scripts activés pour exécuter du code BPC non audité — injection DOM arbitraire | `www/js/scraper.js:1004-1443` | **CRITIQUE** |
| 4 | Aucune Content Security Policy (CSP) dans index.html | `www/index.html` | **HAUTE** |
| 5 | Trafic HTTP clair autorisé (`cleartextTrafficPermitted: true`, `http://*`) | `capacitor.config.json:6-11` | **HAUTE** |
| 6 | Stockage credentials Cafeyn via `SharedPreferences` standard (pas `EncryptedSharedPreferences` malgré le commentaire) | `CafeynLoginPlugin.java:472-478` | **HAUTE** |
| 7 | XSS potentiel via `innerHTML` dans le viewer d'article (contenu scrapé injecté directement) | `www/js/app.js:501` | **HAUTE** |
| 8 | Validation JWT naïve — seule vérification : `startsWith('eyJ')` | `www/js/app.js:936` | **MOYENNE** |
| 9 | Pas de validation des intents partagés (sharedText) — potentiel CSRF | `www/js/app.js:993-1008` | **MOYENNE** |

---

## 2. QUALITÉ DE CODE & MAINTAINABILITÉ

| # | Problème | Fichier | Gravité |
|---|----------|---------|---------|
| 10 | Variable `pairs` déclarée 2× dans le même scope (shadowing) | `CafeynLoginPlugin.java:186,202` | **HAUTE** |
| 11 | Duplication du CSS d'impression (PRINT_CSS défini 3× avec le même contenu) | `scraper.js:80,911,1526` + `pressreader.js:184` | **MOYENNE** |
| 12 | Code BPC intégral (~7000 lignes) inutilisé — sites non FR, logique extension Chrome inopérante | `www/js/bpc/contentScript.js` + `contentScript_fr.js` | **MOYENNE** |
| 13 | Fonctions no-op laissées (`iframeWindow.header_nofix = function(){}`) — masque des erreurs silencieuses | `www/js/scraper.js:1256-1259` | **MOYENNE** |
| 14 | Variables globales non documentées (`window.Scraper`, `window.DB`, `window.Cafeyn`, etc.) | Tous les modules JS | **FAIBLE** |
| 15 | Aucun test automatisé — script `test` = `echo "Error" && exit 1` | `package.json:7` | **MOYENNE** |
| 16 | Pas de typage (JS vanilla), pas de TypeScript | Projet entier | **FAIBLE** |
| 17 | Couplage fort : passage de l'état global complet `state` aux modules | `app.js -> scraper.js` | **MOYENNE** |
| 18 | `JSONArray cookieArray` inutilisé (dead code) | `CafeynLoginPlugin.java:185` | **FAIBLE** |
| 19 | `case 'subtitle':` en double dans le switch cafeyn.js | `www/js/cafeyn.js:206-207` | **FAIBLE** |

---

## 3. STABILITÉ & GESTION D'ERREURS

| # | Problème | Fichier | Gravité |
|---|----------|---------|---------|
| 20 | Boucle `while(true)` sans timeout global dans `startScraping()` — peut bloquer indéfiniment | `www/js/app.js:364` | **HAUTE** |
| 21 | catch silencieux `catch(e) {}` vidant l'erreur (6+ occurrences) | `www/js/app.js:67,135,138,158,275,553` | **MOYENNE** |
| 22 | Absence de gestion réseau hors-ligne — requêtes échouent silencieusement | `www/js/scraper.js` | **HAUTE** |
| 23 | IndexedDB non versionnée — pas de migration possible si le schéma change | `www/js/db.js:16` | **MOYENNE** |
| 24 | Iframe non retirée du DOM en cas d'erreur — fuite mémoire | `www/js/scraper.js:1514` | **FAIBLE** |
| 25 | `JSObject result` créé mais jamais rempli sur certaines branches d'erreur | `CafeynLoginPlugin.java` | **MOYENNE** |

---

## 4. ARCHITECTURE

| # | Problème | Fichier | Gravité |
|---|----------|---------|---------|
| 26 | Plugin `BnfLogin` surchargé : proxy HTTP + credentials + PDF + BPC + notifications — violation SRP | Architecture générale | **HAUTE** |
| 27 | Dépendances circulaires potentielles : cafeyn.js → window.Scraper → window.Cafeyn | Architecture | **MOYENNE** |
| 28 | Ordre de chargement des scripts fragile (dépendances implicites dans index.html) | `www/index.html:228-233` | **FAIBLE** |
| 29 | Pas de couche d'abstraction réseau : mélange de `fetch()`, `BnfLogin.httpRequest()`, `XMLHttpRequest` | Multi-fichiers | **MOYENNE** |
| 30 | Plugin `CafeynLogin` et `BnfLogin` ont des APIs qui se chevauchent (`httpRequest`, `saveCredentials`) | Architecture | **MOYENNE** |

---

## 5. PERFORMANCE

| # | Problème | Fichier | Gravité |
|---|----------|---------|---------|
| 31 | Parsing DOMParser multiple fois sur le même HTML (jusqu'à 3 appels) | `www/js/scraper.js:207,480,781` | **MOYENNE** |
| 32 | `getAllArticlesFromDb()` appelé au démarrage charge tous les articles en mémoire | `www/js/app.js:613` | **MOYENNE** |
| 33 | setInterval à 100ms pendant 2.5s bloquant le thread principal (attente bypass BPC) | `www/js/scraper.js:1453` | **FAIBLE** |
| 34 | `querySelectorAll` répétés sur les mêmes sélecteurs sans cache | `www/js/app.js` | **FAIBLE** |

---

## 6. CONFORMITÉ

| # | Problème | Fichier | Gravité |
|---|----------|---------|---------|
| 35 | Contournement de paywalls via BPC + proxy Europresse — potentiel non-respect des CGU | Projet | **INFORMATION** |
| 36 | Absence de licence open-source | `package.json:14` | **FAIBLE** |
| 37 | Stockage local d'articles protégés sans DRM (copie, PDF, partage autorisés) | Architecture | **INFORMATION** |
| 38 | Limite arbitraire de 100 articles dans l'historique sans avertissement | `www/js/app.js:425` | **FAIBLE** |

---

## RECOMMANDATIONS PRIORITAIRES

1. **CRITIQUE** — Migrer le stockage JWT/credentials Cafeyn de localStorage vers EncryptedSharedPreferences
2. **CRITIQUE** — Remplacer `new Function(sitesData)` par une évaluation contrôlée ou un parseur dédié
3. **HAUTE** — Ajouter une CSP dans index.html (`default-src 'self'...`)
4. **HAUTE** — Ajouter un timeout global à la boucle `while(true)` dans `startScraping()`
5. **HAUTE** — Factoriser le CSS PRINT_CSS dupliqué en un fichier partagé
6. **HAUTE** — Corriger le stockage Cafeyn : remplacer `SharedPreferences` par `EncryptedSharedPreferences`
7. **HAUTE** — Ajouter une détection hors-ligne avec message utilisateur explicite
8. **MOYENNE** — Versionner le schéma IndexedDB et gérer les migrations
9. **MOYENNE** — Supprimer le shadowing de variable `pairs` dans CafeynLoginPlugin.java
10. **MOYENNE** — Nettoyer le dead code (`cookieArray` inutilisé, fonctions no-op, etc.)
