# Test Manuel du Fix Mediapart sur Redroid

## Étapes à suivre pour tester le fix

### 1. Prérequis
- ✅ Redroid connecté (`adb connect 127.0.0.1:5555`)
- ✅ APK fixé: `pressscraper-fixed.apk` déjà construit
- ✅ Credentials BnF: `maun.aug@gmail.com` / `154175Ae$1312`

### 2. Installation de l'APK fixé

```bash
# 1. Installer l'APK fixé
adb install -r pressscraper-fixed.apk

# 2. Forcer l'arrêt de l'application
adb shell am force-stop io.qzz.pressecraper

# 3. Lancer l'application
adb shell am start -n io.qzz.pressecraper/.MainActivity
```

### 3. Configuration BnF

1. Ouvrir l'application Archive Presse
2. Aller dans Paramètres
3. Configurer les identifiants BnF:
   - Username: `maun.aug@gmail.com`
   - Password: `154175Ae$1312`
4. Tester la connexion → devrait affiché "Connecté"

### 4. Test du scraping Mediapart

#### Méthode 1: Via l'interface
1. Retourner à l'écran d'accueil
2. Coller l'URL d'un article Mediapart paywall:
   ```
   https://www.mediapart.fr/journal/france/260525/un-article-sur-mediapart
   ```
3. Cliquer "Sauvegarder"
4. Observer le résultat

#### Méthode 2: Via intent (recommandé)
```bash
# Envoyer l'URL via intent de partage
adb shell am start -a android.intent.action.SEND \
  -t text/plain \
  -n io.qzz.pressecraper/.MainActivity \
  --es android.intent.extra.TEXT "https://www.mediapart.fr/journal/france/260525/un-article-sur-mediapart"
```

### 5. Vérification des résultats

#### Logs à surveiller:
```bash
# Vérifier les logs en temps réel
adb logcat -v time | grep -E "ScrapeService|BnF Proxy|Paywall|Succès|Échec|textLength|hasPaywall"

# Ou voir les logs existants
adb logcat -d | grep -E "BnF Proxy|Paywall|Succès|Échec"
```

#### Signes de succès:
- ✅ "Succès !" ou "Article téléchargé" dans les logs
- ✅ L'article s'affiche dans la visionneuse
- ✅ Pas de message "Paywall encore actif"
- ✅ Contenu HTML complet (> 800 caractères)

#### Signes d'échec:
- ❌ "Paywall encore actif sur Mediapart"
- ❌ HTML trop court (< 800 caractères)
- ❌ Message d'erreur de scraping

### 6. Vérification spécifique du fix

Les logs devraient montrer:
```
[BnF Proxy] DEBUG paywallEl: false textLength: 1500+ contentEl: true
[BnF Proxy] Succès !
```

**AVANT le fix:**
- paywallEl: true (car `.paywall` n'était pas détecté)
- textLength: 566 (teaser seulement)

**APRÈS le fix:**
- paywallEl: false (car `.paywall` est maintenant détecté)
- textLength: 1500+ (contenu complet)

### 7. Comparaison avec l'ancien APK

Pour confirmer que le fix fonctionne:
1. Tester avec l'ancien APK (`pressscraper.apk`) → devrait marcher
2. Tester avec le nouveau APK (`pressscraper-fixed.apk`) → devrait aussi marcher
3. Les deux devraient donner le même résultat

### 8. Dépannage

Si le fix ne marche pas:

#### Vérifier le code fixé:
```bash
# Vérifier que le fix est dans le code
grep -n "paywallSelector.*\.paywall" www/js/services/bnf-proxy-service.js
# Devrait retourner: '.paywall, #paywall, [class*="paywall"]:not(.paywall-restricted-content)'
```

#### Vérifier les cookies BnF:
```bash
# Vérifier si les cookies sont présents
adb shell am start -n io.qzz.pressecraper/.MainActivity
# Dans l'app, vérifier la dot verte "Session BnF"
```

#### Vérifier les permissions:
```bash
adb shell pm list permissions | grep pressecraper
```

### 9. Résultat attendu

Le fix devrait permettre à beta.16 de:
- ✅ Détecter correctement le paywall Mediapart
- ✅ Extraire le contenu complet (> 800 caractères)
- ✅ Afficher l'article dans la visionneuse
- ✅ Générer un PDF si demandé

**Le fix restaure la compatibilité avec l'ancien APK tout en conservant toutes les améliorations de beta.16.**