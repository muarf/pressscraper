# Extraction du JWT Cafeyn

## Pourquoi le JWT est nécessaire

L'API Cafeyn (`api.cafeyn.co`) nécessite un token JWT Bearer pour accéder aux articles.
Ce token est obtenu après login sur le portail GPSEA.

## Méthode 1 : Via DevTools (navigateur)

1. Aller sur https://mediatheques.sudestavenir.fr/auth/login
2. Se connecter avec son identifiant et mot de passe
3. Après login → redirection vers cafeyn.co
4. Ouvrir DevTools (F12) → Console
5. Exécuter :

```javascript
// Lire le cookie JWT
document.cookie.split(';').find(c => c.includes('Cafeyn_authtoken_V2')).split('=')[1]
```

Ou via Storage → localStorage clés `Cafeyn_*`

## Méthode 2 : Via snippet JS (cafeyn_cli.py)

```bash
cd pressscraper/cafeyn_temp
python3 cafeyn_cli.py login
```

Ou copier le JWT manuellement :

```javascript
// Dans la console du navigateur une fois connecté :
await fetch('https://api.cafeyn.co/b2c/articles/hash/pub/date/slug', {
  headers: { 'Authorization': 'Bearer ' + document.cookie.match(/Cafeyn_authtoken_V2=([^;]+)/)?.[1] }
})
```

## Méthode 3 : Via WebView Android (futur)

Auto-capture du token après login GPSEA (Phase 3 du plan).

## Format du JWT

Le JWT commence par `eyJ` et est long (~500+ caractères).
Exemple : `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...`

## Sauvegarde dans l'app

1. Ouvrir l'app → Paramètres
2. Coller le JWT dans le champ "Token JWT Cafeyn"
3. Cliquer "Sauvegarder le token"
4. Le token est stocké dans localStorage (expire après ~30 jours)

## Attention

- Le JWT expire après ~30 jours
- Ne jamais stocker username/password, seul le JWT
- Login via API POST ne fonctionne pas (CAS/Syracuse JS)
