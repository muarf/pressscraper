# Reverse Engineering de l'API PressReader

## Sources
- Extension Chrome: https://github.com/nikhilblal/pressreader-extension
- Documentation interne du SPA
- Tests Python effectués

## 1. Authentification - Obtention du Bearer Token

### Endpoint
```
POST https://www.pressreader.com/authentication/v1/initialize
Content-Type: application/json
```

### Request Body
```json
{
  "tickets": [],
  "language": "fr-FR",
  "url": "https://www.pressreader.com/",
  "urlReferrer": "https://mabm.toulouse-metropole.fr/default/presse.aspx?_lg=fr-FR"
}
```

### Response
```json
{
  "bearerToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tickets": [
    {
      "value": "bfdsOAV4N4s+bncrTI/zrcWoVJYKAQAkCAAAi5IfpA==",
      "session": false
    }
  ],
  "useGeoLocation": 0
}
```

## 2. Configuration

### Endpoint
```
GET https://ingress.pressreader.com/services/config
Authorization: Bearer <token>
```

## 3. State

### Endpoint
```
GET https://ingress.pressreader.com/services/State/GetState
Authorization: Bearer <token>
```

## 4. Navigation Menu

### Endpoint
```
GET https://ingress.pressreader.com/services/navigationMenu/
Authorization: Bearer <token>
```

## 5. Catalog Metadata

### Endpoint
```
GET https://ingress.pressreader.com/se2skyservices/catalogs/metadata
Authorization: Bearer <token>
```

## 6. Recherche (via SPA - pas d'API directe)

La recherche est rendue côté client :
```
https://www.pressreader.com/search?query=<titre>&in=ALL&date=Anytime&type=2&state=2
```

## 7. Flux complet hotspot

1. Ouvvrir https://www.pressreader.com avec Referer = mabm...
2. POST /authentication/v1/initialize → bearerToken
3. GET /services/config → configuration CDN
4. Navigation et lecture via WebView

## 8. Cookies importants

- `PDAuth` - ticket d'auth (stocké en cookie)
- `lng` - langue
- `__cf_bm` - Cloudflare token
- `AProfile` - profil utilisateur

## 9. Flow JavaScript du SPA

```javascript
// Dans le SPA, preloadAuth() est appelé automatiquement
preloadAuth() {
  // Vérifie si signInToken dans URL
  // Charge tickets depuis localStorage/cookies
  // Appelle authentication/v1/initialize
  // Puis charge config via bearer token
}
```

## 10. Limitations

- Token valable ~7 jours
- SPA complexe, pas d'API publique pour les articles
- Nécessite WebView ou reverse engineering des endpoints de contenu

## 11. Tests validés

```python
import requests

headers = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 14)",
    "Referer": "https://mabm.toulouse-metropole.fr/default/presse.aspx?_lg=fr-FR",
    "Content-Type": "application/json"
}

# Auth
r = requests.post("https://www.pressreader.com/authentication/v1/initialize",
    json={"tickets": [], "language": "fr-FR", "url": "https://www.pressreader.com/",
          "urlReferrer": "https://mabm.toulouse-metropole.fr/default/presse.aspx?_lg=fr-FR"},
    headers=headers)
# Status: 200, bearerToken obtenu

token = r.json()['bearerToken']

# Config
r2 = requests.get("https://ingress.pressreader.com/services/config",
    headers={"Authorization": f"Bearer {token}"})
# Status: 200, config obtenue
```

## 12. Extension Chrome - analyse

L'extension `nikhilblal/pressreader-extension` ne fait que:
1. Extraire le titre de la page active
2. Nettoyer le titre (supprimer suffixes | Le Figaro, etc.)
3. Ouvrir la recherche PressReader avec le titre nettoyé

Pas d'extraction de contenu - juste redirection.
