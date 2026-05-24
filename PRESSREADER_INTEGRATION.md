# Intégration PressReader dans PressScraper

## Architecture PressReader

```
PresseScraper (Android)                  PressReader (pressreader.com)
     │                                        │
     │  Bibliothèque Toulouse Métropole        │
     │  mabm.toulouse-metropole.fr             │
     │     └─ login carte bibliothèque          │
     │         → session valable ~7 jours       │
     │                                        │
     │  Lien direct vers PressReader :          │
     │  https://www.pressreader.com             │
     │  (le referrer de la bibliothèque         │
     │   suffit à activer le hotspot PR)        │
     │                                        │
     │  API interne (ingress.pressreader.com)   │
     │     ├─ POST /authentication/v1/          │
     │     │   initialize → bearerToken JWT     │
     │     ├─ GET  /services/config             │
     │     ├─ GET  /services/State/GetState     │
     │     ├─ GET  /services/navigationMenu/    │
     │     └─ ...                               │
     │                                          │
     │  API publique (api.pressreader.com)      │
     │     ├─ POST /discovery/v1/search         │
     │     │   → nécessite clé API partenaire    │
     │     └─ GET /user/catalog/v1/...          │
     │       → nécessite clé API + accessToken  │
```

## Fonctionnement général

PressReader est un kiosque numérique avec 7 000+ titres de presse mondiale.

**Accès via les bibliothèques :** Modèle "hotspot" — un simple clic depuis le portail
de la bibliothèque active l'accès, **sans login nécessaire**.

### Toulouse Métropole (MaBM)

- Portail : `https://mabm.toulouse-metropole.fr/default/presse.aspx?_lg=fr-FR`
- Cliquer sur "Consultez PressReader" → `https://www.pressreader.com`
- **Aucun abonnement/login requis** — le referrer HTTP depuis le domaine
  `mabm.toulouse-metropole.fr` suffit à activer l'accès hotspot
- Accès valable ~7 jours après activation
- Le portail utilise **Syracuse/ARCHINEDE** (système de gestion de bibliothèque)

## Extension de référence (nikhilblal/pressreader-extension)

L'extension Chrome `pressreader-extension` montre le fonctionnement de base :

1. **Extraction du titre** depuis la page web active (balises `meta[og:title]`, `h1`, `title`)
2. **Nettoyage** : suppression des suffixes `| Le Figaro`, ` - NYTimes`, etc.
3. **Recherche** : ouverture de `https://www.pressreader.com/search?query=<titre-nettoyé>`
4. **Fermeture popup** : suppression de la fenêtre modale récurrente de PressReader

→ L'extension ne fait que **rechercher et ouvrir** PressReader, pas extraire le contenu.

## API Publique (documentée)

### Discovery API — Recherche d'articles

```http
POST https://api.pressreader.com/discovery/v1/search
Ocp-Apim-Subscription-Key: <clé partenaire>

{
  "query": "mot-clé",
  "itemTypes": "article",
  "countries": ["FR"],
  "languages": ["fr"],
  "searchIn": "everywhere",
  "startDate": "2025-01-01",
  "endDate": "2026-05-24"
}
```

Réponse :
```json
{
  "items": [
    {
      "publication": {
        "cid": "0039",
        "title": "Le Figaro",
        "countries": ["FR"],
        "language": "fr",
        "publicationType": "newspaper",
        "url": "..."
      },
      "issue": {
        "date": "2026-05-24",
        "url": "..."
      },
      "article": {
        "id": 123456789,
        "title": "Titre de l'article",
        "subTitle": "...",
        "author": "Jean Dupont",
        "url": "..."
      },
      "summary": "..."
    }
  ],
  "meta": { "totalCount": 42, "offset": 0, "limit": 10 }
}
```

**Limitation :** Nécessite une clé API partenaire (`Ocp-Apim-Subscription-Key`).
Réservée aux institutions (bibliothèques, universités). Pas accessible au grand public.

### Catalog API

```http
GET https://api.pressreader.com/user/catalog/v1/publications?accessToken=<token>
Ocp-Apim-Subscription-Key: <clé partenaire>
x-client-ip: <ip du user>
x-user-culture: fr-FR
```

→ Liste des publications disponibles pour l'utilisateur.

## API Interne du Web App (non documentée)

Le SPA PressReader utilise des endpoints internes via `ingress.pressreader.com` :

### Auth — Obtention du bearer token

```http
POST /authentication/v1/initialize
Content-Type: application/json

{
  "tickets": ["..."],           // tickets stockés en localStorage/cookies
  "language": "fr-FR",
  "url": "https://www.pressreader.com/...",
  "urlReferrer": "https://bnf.idm.oclc.org/..."
}
```
Réponse : `{ bearerToken: "eyJ...", ... }`

### Endpoints internes

| Endpoint | Description |
|---|---|
| `GET /services/config` | Configuration CDN, features |
| `GET /services/State/GetState` | État utilisateur, abonnements |
| `GET /services/navigationMenu/` | Menu de navigation |
| `se2skyservices/catalogs/metadata` | Métadonnées catalogue |

### Recherche sur le site web

```
https://www.pressreader.com/search?query=<titre>&in=ALL&date=Anytime&type=2&state=2
```

La recherche est rendue côté client (JS SPA). Les résultats sont paginés horizontalement
via un scroll, chargés dynamiquement depuis l'API interne.

## Flux d'accès Toulouse Métropole → PressReader

```
1. Ouvrir https://mabm.toulouse-metropole.fr/default/presse.aspx
2. Cliquer sur "Consultez PressReader"
3. Redirection vers https://www.pressreader.com avec referrer = mabm.toulouse-metropole.fr
4. PressReader détecte le referrer bibliothèque → crée une session hotspot ~7 jours
5. Navigation et lecture libres pendant 7 jours
6. Après expiration, retour à l'étape 1 pour ré-activation

→ Aucun identifiant ni abonnement nécessaire.
```

**Mécanisme :** PressReader valide l'accès via le **referrer HTTP**.
Tant que le referrer contient un domaine de bibliothèque partenaire, l'accès est
accordé sans authentification supplémentaire.

Pour l'app Android, il suffit d'ouvrir une **WebView** avec un referrer personnalisé
vers `https://www.pressreader.com`. Le hotspot s'active automatiquement.

## Plan d'intégration

### Phase 1 — Recherche par titre (comme l'extension)

**But :** Rechercher un article sur PressReader via la page web.

**Fonctionnement :**
1. L'utilisateur colle un URL ou des mots-clés
2. L'app extrait/nettoie le titre (logique copiée de `background.js`)
3. L'app ouvre `https://www.pressreader.com/search?query=<titre>` dans une WebView
4. L'utilisateur voit les résultats et peut lire l'article

**Limitation :** C'est juste une redirection vers le site PressReader. Pas de scraping.

### Phase 2 — Scraping via WebView avec session bibliothèque

**But :** Extraire le contenu d'un article PressReader.

**Fonctionnement :**
1. L'utilisateur se connecte à sa bibliothèque dans une WebView intégrée
   (même pattern que `BnfLoginPlugin.login()` mais pour `mabm.toulouse-metropole.fr`)
2. Une fois loggé, naviguer vers PressReader pour activer le hotspot
3. Injecter JS pour capturer le bearer token JWT de la session PressReader
   (`POST /authentication/v1/initialize` → `bearerToken`)
4. Stocker le token pour les requêtes API ultérieures
5. Pour lire un article : naviguer vers l'URL dans une WebView invisible
6. Injecter JS pour extraire le contenu (titre, texte, images)
7. Passer le contenu au pipeline PDF existant

```js
// JS injecté pour capturer le token d'authentification PressReader
(async function() {
    const resp = await fetch('https://ingress.pressreader.com/services/authentication/v1/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tickets: [],
            language: 'fr-FR',
            url: location.href,
            urlReferrer: document.referrer
        })
    });
    const data = await resp.json();
    return data.bearerToken;
})();
```

**Défi :** PressReader est une SPA complexe (CDN, ressources dynamiques).
L'extraction du contenu d'article peut nécessiter d'identifier les bons selecteurs
CSS dans le DOM rendu.

### Phase 3 — Reverse engineering de l'API interne

**But :** Accéder aux articles sans WebView (via l'API REST interne).

**Fonctionnement :**
1. Après login BnF, capturer le bearer token JWT de PressReader
   (injecter JS dans la WebView après redirection vers pressreader.com)
2. Utiliser l'API interne `ingress.pressreader.com/services/...` avec le bearer token
3. Bypasser la limitation des 7 jours en re-loguant automatiquement via BnF

**Endpoints à investiguer (depuis le SPA) :**

```
ingress.pressreader.com/services/State/GetState
ingress.pressreader.com/services/navigationMenu//
ingress.pressreader.com/se2skyservices/catalogs/metadata
```

**Défi :** Le SPA PressReader est complexe (architecture pilotée par CDN,
ressources dynamiques). L'extraction du contenu d'article peut nécessiter
de reverse-engineer les appels API spécifiques.

### Phase 4 — Activation hotspot automatique

**But :** Activer le hotspot PressReader sans interaction utilisateur.

**Fonctionnement :**
1. Ouvrir une WebView pointant sur `https://www.pressreader.com`
2. **Injecter un referrer personnalisé** pointant vers `mabm.toulouse-metropole.fr`
3. PressReader valide le referrer → active le hotspot automatiquement
4. Injecter JS pour appeler `POST /authentication/v1/initialize` et capturer le bearer token
5. Stocker le token dans EncryptedSharedPreferences

**Alternative encore plus simple** (si le referrer seul ne suffit pas) :
1. Ouvrir une WebView vers `https://mabm.toulouse-metropole.fr/default/presse.aspx`
2. Simuler un clic sur le lien "Consultez PressReader" par injection JS
3. Attendre la redirection vers pressreader.com
4. Capturer le token

**Pas de login nécessaire** — contrairement à la BnF/Cafeyn, aucun identifiant à gérer.

## Mapping des fichiers

| Fichier | Action |
|---|---|
| `www/js/pressreader.js` | CRÉER — logique PressReader (extraction titre, nettoyage, recherche, scraping WebView) |
| `www/index.html` | MODIFIER — UI options (optionnel, si on veut un bouton dédié) |
| `www/js/app.js` | MODIFIER — intégration dans le flux scraping |
| `www/js/scraper.js` | MODIFIER — détection URLs pressreader.com, appel au module PressReader |
| `android/.../BnfLoginPlugin.java` | MODIFIER— potentiellement ajouter méthode `pressreaderRequest()` (si besoin) |

## Différences avec l'intégration Cafeyn

| Aspect | Cafeyn | PressReader |
|---|---|---|
| **Auth** | JWT cookie (`Cafeyn_authtoken_V2`) | Bearer token JWT interne après hotspot bibliothèque |
| **API** | `api.cafeyn.co` (documentée par reverse engineering) | `ingress.pressreader.com` (SPA complexe) |
| **Recherche** | `POST /b2c/stores/1/all/search` | `pressreader.com/search?query=...` (page web) |
| **Contenu article** | JSON avec `elements[]` typés → HTML simple | Rendering SPA complexe (PDF + text view) |
| **TLS** | AWS ELB bloque fingerprint non-Chrome | Cloudflare (probablement ok via WebView) |
| **Bibliothèque** | GPSEA (abonnement dédié) | Toulouse Métropole / autre portail |
| **Type de contenu** | Articles textuels avec images | Pages scannées (PDF) + text view |
| **Priorité d'implémentation** | Haute (API propre, endpoints connus) | Basse (SPA lourd, reverse engineering complexe) |

## Recommandation

1. **D'abord Cafeyn** — L'API est propre, les endpoints sont connus, l'intégration est simple avec le plan déjà défini dans `CAFEYN_INTEGRATION.md`

2. **PressReader ensuite** — Commencer par la Phase 1 (recherche par titre + WebView) qui utilise l'infrastructure existante sans reverse engineering complexe

3. **PressReader Phases 2-4** — À faire si la demande existe, en commençant par l'observation du trafic réseau du SPA (via DevTools) pour identifier les endpoints exacts de chargement d'article

## Références

- `https://github.com/nikhilblal/pressreader-extension` — extension Chrome de recherche par titre
- `https://mabm.toulouse-metropole.fr/default/presse.aspx?_lg=fr-FR` — portail presse Toulouse Métropole
- `https://www.pressreader.com/search?query=...` — recherche PressReader
- `https://developers.pressreader.com/` — portail développeur (API publique, clé partenaire requise)
- `https://pressreader.atlassian.net/wiki/spaces/PD/` — documentation partenaire
- `android/.../BnfLoginPlugin.java` — pattern login WebView existant (à adapter pour Syracuse)
- `www/js/scraper.js` — pipeline scraping à étendre
