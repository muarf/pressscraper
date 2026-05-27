# Plan de tests automatisés (redroid)

## Prérequis
- Redroid connecté (`adb connect 127.0.0.1:5555`)
- App buildée + installée
- WebSocket CDP connecté pour logs JS
- Credentials BnF injectés dans le state localStorage

---

## 1. Tests par fournisseur

Désactiver tous les autres providers dans la config avant chaque test.

| Provider | Sites test | Prérequis |
|----------|-----------|-----------|
| **BPC** | `leparisien.fr`, `charliehebdo.fr` | Règles BPC téléchargées |
| **Europresse** | `lemonde.fr`, `liberation.fr`, `courrierinternational.com` | Session BnF valide |
| **PressReader** | `lefigaro.fr`, `lepoint.fr` | Compte PMB (Toulouse) valide |
| **Cafeyn** | `lepoint.fr`, `challenges.fr` | Session GPSEA valide |
| **BnF Proxy** | `mediapart.fr`, `arretsurimages.net` | Session BnF valide |

### 1.1 BPC
- [ ] BPC init : 593 sites chargés, Worker OK
- [ ] Fetch direct avec Googlebot UA → HTTP 200
- [ ] ContentScript s'exécute dans l'iframe
- [ ] Contenu extrait (titre, body, auteur, date)
- [ ] Pas de notification d'échec avant la fin du scraping
- [ ] Fallback vers Europresse si BPC échoue (402)

### 1.2 Europresse (BnF)
- [ ] Session BnF valide (cookies + CSRF token)
- [ ] Pré-check serveur : GET `/Search/Reading` → `__RequestVerificationToken` présent
- [ ] Recherche par titre + description trouve l'article
- [ ] Similarité > 30%
- [ ] Contenu extrait correctement (HTML propre, pas de scripts)
- [ ] PDF généré sans erreur
- [ ] Article sauvegardé en IndexedDB

### 1.3 PressReader
- [ ] Connexion PressReader via PMB Toulouse
- [ ] Extraction articleId depuis l'URL
- [ ] Recherche par titre si pas d'articleId
- [ ] Similarité > 30%
- [ ] Contenu extrait (titre, body, auteur, publication, date)

### 1.4 Cafeyn
- [ ] Session GPSEA valide (cookies)
- [ ] Recherche trouve l'article
- [ ] Contenu extrait

### 1.5 BnF Proxy
- [ ] `supportsUrl()` retourne true pour mediapart.fr et arretsurimages.net
- [ ] Injection automatique dans l'orchestrateur (log `[ORCH] bnf-proxy injecté`)
- [ ] Fetch via EZProxy BnF → HTTP 200
- [ ] Contenu extrait (gestion API pour ASI, licence pour Mediapart)
- [ ] Si session BnF expirée → remontée de l'erreur à l'orchestrateur

---

## 2. Tests UI / Interaction

### 2.1 Écran d'accueil
- [ ] Logo + titre "Archive Presse" affichés
- [ ] Input URL présent et fonctionnel
- [ ] Bouton "Sauvegarder" déclenche le scraping
- [ ] Bouton "Paramètres" → écran paramètres

### 2.2 Paramètres
- [ ] Tous les providers listés avec toggle (sauf bnf-proxy, invisible)
- [ ] Réordonnancement des providers (monter/descendre)
- [ ] Champs credentials BnF (username/password)
- [ ] Champs credentials Cafeyn (username/password)
- [ ] Section "Débogage" : logs visibles
- [ ] Section "Débogage" : bouton copier les logs
- [ ] Version de l'app affichée
- [ ] Vérification mise à jour bêta fonctionnelle
- [ ] Changement de thème (dark/light) persisté
- [ ] Taille de police modifiable et persistée

### 2.3 Visionneuse d'article
- [ ] Article affiché après scraping réussi
- [ ] Titre, source, auteur, date affichés
- [ ] Images présentes
- [ ] Bouton "Ouvrir le PDF" (si PDF généré)
- [ ] Bouton "Partager"
- [ ] Bouton "Retour" → historique
- [ ] Bouton "Ouvrir dans le navigateur"

### 2.4 Toast / notifications in-app
- [ ] Toast "✅ Article sauvegardé localement !" après succès
- [ ] Toast d'erreur si échec
- [ ] Toast disparaît après 4s

---

## 3. Tests intents (partage)

### 3.1 ACTION_SEND
- [ ] `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "URL"`
- [ ] Le service NE démarre PAS (fix beta.13)
- [ ] `handleSharedContent` appelé → `startScraping()` dans l'UI
- [ ] `_scrapingInProgress` empêche le double appel
- [ ] Une seule notification de résultat

### 3.2 ACTION_VIEW
- [ ] `adb shell am start -a android.intent.action.VIEW -d "URL"`
- [ ] Le service démarre
- [ ] Scraping en arrière-plan
- [ ] Notification de résultat

### 3.3 ACTION_PROCESS_TEXT
- [ ] `adb shell am start -a android.intent.action.PROCESS_TEXT --es android.intent.extra.PROCESS_TEXT "URL"`
- [ ] Le service démarre
- [ ] `RESULT_OK` + extra renvoyé

---

## 4. Tests session BnF

### 4.1 Connexion
- [ ] Login BnF avec identifiants valides → cookies stockés
- [ ] Login avec identifiants invalides → message d'erreur
- [ ] Cookies persistés dans EncryptedSharedPreferences

### 4.2 Auto-reconnect
- [ ] Session expirée localement (timer 2h passé) → refresh automatique avant scraping
- [ ] Session expirée serveur (pré-check `[ORCH] BnF session expired`) → refresh
- [ ] Refresh réussi → scraping continue
- [ ] Refresh échoué → message d'erreur clair

### 4.3 Timer
- [ ] Timer初始 à 2h après login
- [ ] Dot vert ←→ rouge selon validité
- [ ] Affichage date/heure d'expiration

---

## 5. Tests stockage

### 5.1 IndexedDB
- [ ] Article sauvegardé après scraping réussi
- [ ] Tous les champs présents (id, url, title, html, pdf_path, dates, etc.)
- [ ] Historique limité à 100 entrées

### 5.2 Historique
- [ ] Nouvel article en première position
- [ ] Titre, source, date affichés
- [ ] Clic → ouvre l'article
- [ ] Bouton supprimer → retiré de l'historique + IndexedDB
- [ ] Bouton "Tout effacer"

### 5.3 PDF
- [ ] Généré après scraping réussi
- [ ] Stocké dans le cache
- [ ] Ouvrable via `openPdfFile`
- [ ] Nom de fichier = `articleId.pdf`

---

## 6. Tests migration localStorage

- [ ] Ancien format (provider unique) → migré vers providerOrder
- [ ] Ordre bnf-first → migré vers bpc-first
- [ ] bnf-proxy dans providerOrder → retiré (migration v3)
- [ ] Données non reconnues ignorées (pas de crash)
- [ ] Credentials NON stockés dans localStorage (sécurité)

---

## 7. Tests mise à jour (updater)

- [ ] API GitHub : première prerelease = dernière version
- [ ] Tri semver correct (beta.X > beta.Y)
- [ ] Cache 24h respecté
- [ ] Force-check bypass le cache
- [ ] Tag déjà installé (`update_installed_tag`) → pas de nouvelle invitation
- [ ] Nouveau tag détecté → notification "Bêta disponible"
- [ ] Clic "Télécharger" → download APK
- [ ] Installation APK → `markBetaInstalled()` appelé
- [ ] Version affichée dans Paramètres

---

## 8. Tests cas d'erreur

- [ ] URL invalide → message d'erreur
- [ ] Pas de connexion réseau → message d'erreur
- [ ] Tous les providers désactivés → "Aucun fournisseur activé"
- [ ] BPC 402 (paywall) → passage au provider suivant (pas d'erreur)
- [ ] Similarité insuffisante sur TOUS les providers → erreur finale
- [ ] Timeout scraping (120s) → erreur "Délai dépassé"
- [ ] Timeout service (130s) → notification "❌ Temps écoulé"
- [ ] Session BnF expirée + refresh échoué → message clair

---

## 9. Tests PDF

- [ ] Génération après scraping Europresse
- [ ] Style appliqué (Georgia, Helvetica, marges)
- [ ] Images incluses
- [ ] Métadonnées (titre, auteur, source) présentes
- [ ] PDF ouvrable depuis la visionneuse

---

## 10. Tests notification système

### 10.1 Mode foreground (UI)
- [ ] Succès : `showNotification("📰 Article téléchargé", title, articleId)`
- [ ] Échec : pas de notification système (juste toast + UI)
- [ ] Clic notification → ouvre l'article dans l'app

### 10.2 Mode headless (service)
- [ ] Succès : notification avec titre + contenu
- [ ] Échec : notification "❌ Échec du téléchargement"
- [ ] Timeout : notification "❌ Temps écoulé"
- [ ] Clic notification → ouvre l'app

### 10.3 Anti-doublon
- [ ] `_scrapingInProgress` : pas de double scrape dans le même WebView
- [ ] `isRunning` : pas de double service
- [ ] Pas de notification d'échec suivie d'une notification de succès

---

## 11. Tests performance

- [ ] Scraping complet < 60s (tous providers)
- [ ] Europresse seul < 20s
- [ ] BPC seul < 15s
- [ ] Génération PDF < 10s
- [ ] Service ne dépasse pas le timeout 130s

---

## 12. Tests régression

- [ ] Build APK sur GitHub Actions réussit
- [ ] APK signé sans erreur
- [ ] `versionName` = "1.1.2" (build.gradle)
- [ ] Assets www/ synchronisés (npx cap sync)
- [ ] BPC Worker : `bpc-worker.js` copié dans les assets
- [ ] Aucune régression sur les fix précédents (timer 2h, pre-check, bnf-proxy injection, etc.)

---

## Commandes de test

### Installation + partage
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am force-stop io.qzz.pressecraper
adb shell am start -a android.intent.action.SEND -t text/plain \
  -n io.qzz.pressecraper/.MainActivity \
  --es android.intent.extra.TEXT "https://www.lemonde.fr/..."
```

### Vérification logs
```bash
adb logcat -d | grep -E "ScrapeService|showNotification|_scraping|HEADLESS|SHARE|ORCH|BPC|Europresse|PressReader|Cafeyn|MIGRATE|TEST"
```

### Connexion CDP
```bash
PID=$(adb shell ps -A | grep pressecraper | awk 'NR==1{print $2}')
adb forward tcp:9223 "localabstract:webview_devtools_remote_$PID"
# Ouvrir http://127.0.0.1:9223 dans le navigateur
```

### Désactiver tous les providers sauf un
```javascript
// Dans la console CDP (ou via evaluate)
var c = JSON.parse(localStorage.getItem('presse_scraper_v3'));
c.providerEnabled = {bpc:true, 'bnf-proxy':false, pressreader:false, cafeyn:false, bnf:false};
localStorage.setItem('presse_scraper_v3', JSON.stringify(c));
location.reload();
```
