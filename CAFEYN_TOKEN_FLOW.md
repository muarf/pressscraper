# Flux extraction token Cafeyn

## Méthode 1 : Via le navigateur (recommandé)

1. User se connecte sur https://mediatheques.sudestavenir.fr/auth/login
2. Login → redirection vers cafeyn.co
3. Copier le snippet JS depuis `cafeyn login` dans la console DevTools
4. Le snippet scanne cookies/storage pour trouver le JWT
5. Token copié dans le presse-papier → sauvegardé dans config

## Méthode 2 : Via CLI directe

```bash
cafeyn login --token "eyJ..."
```

## Méthode 3 : Via le portail Syracuce/ARCHINEDE

Le pattern est le même que BnF :
1. WebView → OPAC GPSEA → login
2. CAS SSO → redirection cafeyn.co
3. Injection JS → lecture cookie `Cafeyn_authtoken_V2`
4. Sauvegarde automatique

## Note importante

Les identifiants ne doivent PAS être stockés. Seul le JWT est conservé.
Le JWT expire après ~30 jours → re-login nécessaire.

## Extraction snippet (cafeyn_cli.py)

Le snippet JS scanne dans cet ordre :
1. Cookies → `Cafeyn_authtoken_V2`
2. localStorage / sessionStorage → clés Cafeyn_*
3. Intercept fetch/XHR → Authorization header du prochain appel

Le JWT est format : `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
