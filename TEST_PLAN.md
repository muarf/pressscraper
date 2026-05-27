# Plan de tests automatisés (redroid)

## Sources exclusives par fournisseur

| Fournisseur | Domaines exclusifs | Raison |
|-------------|-------------------|--------|
| **Europresse** | `lemonde.fr`, `liberation.fr`, `courrierinternational.com`, `lesechos.fr` | Uniquement dans Europresse |
| **PressReader** | `alternatives-economiques-hors-s-rie.fr`, `4x4-magazine.fr`, `20-minutes.fr` | Uniquement dans PressReader |
| **BPC** | `charliehebdo.fr`, `dna.fr`, `lalsace.fr`, `lopinion.fr` | Bypass direct uniquement |
| **Cafeyn** | `20minuteseditionnationale.fr`, `20minutesgrandparis.fr`, `courrierinternational.com` (Cafeyn) | Uniquement dans Cafeyn |
| **BnF Proxy** | `mediapart.fr`, `arretsurimages.net` | Proxy BnF uniquement |

## Prérequis
- Redroid connecté (`adb connect 127.0.0.1:5555`)
- App buildée et installée (`./gradlew assembleDebug && adb install -r ...`)
- App ouverte (`am start -n io.qzz.pressecraper/.MainActivity`)
- WebSocket CDP connecté pour observer les logs JS

## Tests provider par provider

### 1. BPC (bypass direct)
**Domaine test** : `charliehebdo.fr`, `dna.fr`, `lalsace.fr`, `lopinion.fr`
**URL test** : article récent d'un de ces domaines
- [ ] Vérifier que BPC init OK (593 sites)
- [ ] Vérifier que le fetch direct avec Googlebot UA retourne HTTP 200
- [ ] Vérifier que le contentScript extrait le contenu
- [ ] Vérifier qu'aucune notification d'échec n'est envoyée avant la fin

### 2. Europresse (BnF)
**Domaine test** : `lemonde.fr`, `liberation.fr`, `courrierinternational.com`, `lesechos.fr`
**URL test** : article récent d'un de ces domaines
- [ ] Vérifier que la session BnF est valide
- [ ] Vérifier que la recherche Europresse trouve l'article
- [ ] Vérifier que la similarité > 30%
- [ ] Vérifier que le PDF est généré

### 3. PressReader
**Domaine test** : `alternatives-economiques-hors-s-rie.fr`, `4x4-magazine.fr`, `20-minutes.fr`
**URL test** : article récent d'un de ces domaines
- [ ] Vérifier l'extraction de l'articleId
- [ ] Vérifier la recherche par titre
- [ ] Vérifier la similarité > 30%

### 4. Cafeyn
**Domaine test** : `20minuteseditionnationale.fr`, `20minutesgrandparis.fr`
**URL test** : article récent d'un de ces domaines
- [ ] Vérifier que la session Cafeyn est valide
- [ ] Vérifier la recherche

### 5. BnF Proxy (Mediapart / Arrêt sur Images)
**Domaine test** : `mediapart.fr`, `arretsurimages.net`
**URL test** : article récent
- [ ] Vérifier que bnf-proxy est injecté dynamiquement dans l'orchestrateur
- [ ] Vérifier que `supportsUrl()` retourne true
- [ ] Vérifier le fetch via EZProxy

## Tests transverses

### Notifications
- [ ] Erreur : une seule notification d'échec quand TOUS les providers ont échoué
- [ ] Succès : une seule notification de succès
- [ ] Pas de double notification (échec puis succès)

### Concurrence
- [ ] `_scrapingInProgress` empêche le double scrape dans le même WebView
- [ ] Service `isRunning` empêche le double démarrage du service
- [ ] Pas de `ScrapeService` démarré sur `ACTION_SEND` (vérifier `logcat | grep ScrapeService`)

### Session BnF
- [ ] Pré-check serveur fonctionne (vérifier cookie valide)
- [ ] Auto-reconnect si session expirée
- [ ] Timer 2h → dot passe au rouge après 2h

### Mise à jour (updater)
- [ ] API GitHub retourne la dernière prerelease en premier
- [ ] Comparaison semver correcte (beta.X > beta.Y)
- [ ] Notification de mise à jour disponible
- [ ] Téléchargement + installation APK

## Commande de test rapide

```bash
# Installer l'APK
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# Forcer l'arrêt
adb shell am force-stop io.qzz.pressecraper

# Simuler un partage
adb shell am start -a android.intent.action.SEND -t text/plain \
  -n io.qzz.pressecraper/.MainActivity \
  --es android.intent.extra.TEXT "https://www.lemonde.fr/..."

# Vérifier les logs
adb logcat -d | grep -E "ScrapeService|showNotification|_scraping|HEADLESS|SHARE|ORCH|BPC"
```

## Script de test automatisé (CDP)

```python
# Se connecter au WebSocket CDP
# Injecter l'état (credentials, providerOrder)
# Désactiver tous les sauf le provider à tester
# Lancer startScraping()
# Collecter les logs jusqu'à "Succès" ou "Échec"
# Vérifier qu'il n'y a qu'une notification
```
