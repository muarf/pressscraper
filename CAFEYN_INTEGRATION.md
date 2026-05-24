# Intégration Cafeyn dans PressScraper

## Architecture API Cafeyn

```
SaaS (Vue.js)                          PressScraper (Android)
     │                                       │
     │  Algolia (moteur de recherche)         │  api.cafeyn.co
     │     └─ encapsulé par l'API Cafeyn      │     ├─ POST /b2c/stores/{id}/all/search
     │                                        │     ├─ POST /b2c/stores/{id}/articles/search
     │  api.cafeyn.co                         │     ├─ GET  /b2c/articles/{slug}
     │     ├─ b2c/ → données catalogue         │     ├─ GET  /b2c/issues/{id}
     │     ├─ ticket/ → manifestes issues      │     ├─ GET  /b2c/publications/{id}
     │     └─ offers/ → abonnements            │     └─ POST /ticket/reader/{pub}/{issue}
     │                                        │
     │  Auth: JWT Bearer (cookie               │  Auth: JWT Bearer
     │  `Cafeyn_authtoken_V2`, httpOnly:false)  │  Stocké dans EncryptedSharedPreferences
```

## Flux d'accès utilisateur

```
Navigateur Web                          App Android
     │                                       │
     ├─ OPAC GPSEA (login carte médiathèque)
     ├─ CAS SSO → proxy → redirection
     ├─ cafeyn.co → cookie JWT posé
     └─ DevTools → copie du cookie JWT ───→ champ input dans Paramètres
                                             │
                                             ├─ POST /b2c/stores/1/all/search?query=mot-clé
                                             ├─ GET  /b2c/articles/{slug}
                                             ├─ conversion JSON → HTML → PDF
                                             └─ sauvegarde IndexedDB
```

## Endpoints API

### Authentification
Header requis sur chaque requête :
```
Authorization: Bearer <JWT>
Origin: https://www.cafeyn.co
User-Agent: Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36
```

### Recherche
```http
POST /b2c/stores/{storeId}/all/search?from=0&size=30
Content-Type: application/json

{
  "query": "mot-clé",
  "country": "fr",
  "lang": "fr"
}
```
Réponse : `{ issues: [...], articles: { collection: [...], totalCount: N } }`

```http
POST /b2c/stores/{storeId}/articles/search?from=0&size=30
Content-Type: application/json

{
  "query": "mot-clé",
  "country": "fr",
  "lang": "fr",
  "dateMin": "2025-01-01",        // optionnel
  "publications": [123, 456]      // optionnel, filtre par publication
}
```
Réponse : `{ collection: [...], totalCount: N }`

Store ID = 1 pour la France.

### Lecture article
```http
GET /b2c/articles/{slug}
```
Slug = `<hash>/<publication-title>/<date>/<titre>` (extrait des URLs `/fr/article/...`)

Réponse : JSON avec `elements[]` typés (paragraph, title, image, quote, heading, subtitle, caption, introduction, byline...).

### Métadonnées issue
```http
GET /b2c/issues/{issueId}
```
Réponse : métadonnées + publication + articles TOC.

### Manifeste issue (articles détaillés + tuiles pages)
```http
POST /ticket/reader/{publicationId}/{issueId}
→ { ticket: "..." }

GET /ticket/{ticket}/material
→ { articles: { [compositeId]: { title, formattedUrl, page, ... } },
    pages: [{ transforms, tiles }], ... }
```

### Catalogue publications
```http
GET /b2c/stores/1/publications/digital
→ liste des ~60 publications digitales

GET /b2c/publications/{id}
→ publication + lastIssue
```

## Structure de l'article Cafeyn

```json
{
  "id": 123,
  "title": "Titre article",
  "publicationName": "Le Figaro",
  "isoReleaseDate": "2026-05-06T...",
  "wordCount": 361,
  "readingTime": 1,
  "formattedUrl": "hash/le-figaro-2/2026-05-06/titre-slug",
  "elements": [
    { "type": "introduction", "value": "Chapeau..." },
    { "type": "paragraph",    "value": "Texte..." },
    { "type": "title",        "value": "Sous-titre" },
    { "type": "image",        "url": "https://..." },
    { "type": "caption",      "value": "Légende" },
    { "type": "quote",        "value": "Citation" },
    { "type": "byline",       "value": "Auteur" }
  ]
}
```

## Problème TLS fingerprinting

L'ELB AWS devant `api.cafeyn.co` bloque les handshakes TLS qui ne correspondent pas à Chrome.

**Solution :** Utiliser le WebView Android (vrai TLS Chrome/WebView système) comme proxy HTTP :
1. Créer une WebView invisible (`about:blank`)
2. Y injecter du JS qui fait `fetch()` vers l'API
3. Récupérer la réponse via `evaluateJavascript()`

Alternative : tenter `BnfLogin.httpRequest()` d'abord (fonctionne peut-être depuis Android).

## Plan d'implémentation

### Phase 1 — Input token + scraping article (immédiat)

**Fichiers :**

| Fichier | Action |
|---|---|
| `www/js/cafeyn.js` | CRÉER — module Cafeyn complet (API, conversion, helpers) |
| `www/index.html` | MODIFIER — ajouter input token + bouton sauvegarder dans les settings |
| `www/css/style.css` | MODIFIER — styles du nouveau champ |
| `www/js/app.js` | MODIFIER — state, load/save token, binding UI, binding scraping |
| `www/js/scraper.js` | MODIFIER — interception des URLs cafeyn.co dans `scrapeArticle()` |

**Flux nouveau :**

1. User colle JWT dans Paramètres → sauvegardé dans `EncryptedSharedPreferences`
2. User partage/colle URL cafeyn.co (`/fr/article/hash/pub/date/titre`)
3. `scraper.js` détecte `cafeyn.co` → extrait le slug → appelle `Cafeyn.fetchArticle(slug)`
4. `Cafeyn.articleToHtml(json)` convertit les `elements[]` typés en HTML
5. HTML passé au pipeline PDF existant (via `BnfLogin.printHtmlToPdf()`)
6. Article sauvegardé dans IndexedDB, notification affichée

### Phase 2 — Recherche par mot-clé

- User tape des mots-clés dans l'input → appel à `Cafeyn.search(query)` au lieu d'Europresse
- Résultats affichés dans une liste cliquable
- Sélection → fetch article → PDF

### Phase 3 — Auto-capture du token (webview GPSEA)

- Reproduire le pattern de `BnfLoginPlugin.login()` :
  1. WebView → GPSEA OPAC → user login
  2. CAS SSO → redirect Cafeyn
  3. Injection JS pour lire `Cafeyn_authtoken_V2`
  4. Sauvegarde automatique

## Références

- `cafeyn_temp/cafeyn_cli.py` — client Python de référence (conversion JSON→Markdown, gestion TLS)
- `android/.../BnfLoginPlugin.java` — pattern existant pour login WebView + stockage credentials
- `www/js/scraper.js` — pipeline scraping à étendre
- `www/js/app.js` — UI + state management
