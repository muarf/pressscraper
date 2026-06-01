# Plan d'implémentation : Scraping en arrière-plan avec notification

## Objectif

Quand l'utilisateur partage un lien vers PressScraper, l'app se met en arrière-plan, scrape l'article silencieusement, puis envoie une notification quand l'article est prêt (sans que l'utilisateur ait à rouvrir l'app).

## Fonctionnement actuel

1. `MainActivity.handleIntent()` reçoit `ACTION_SEND` → notifie JS via `triggerWindowJSEvent('sharedText', ...)`
2. `app.js` écoute l'événement `sharedText` → appelle `handleSharedContent()` → `startScraping()` immédiatement
3. Le scraping s'exécute dans le WebView principal (JS). Si l'utilisateur quitte l'app, Android peut **tuer le WebView** → scraping interrompu

## Solution retenue : Headless WebView dans un ForegroundService

Un service Android prioritaire (`ForegroundService`) héberge un **WebView invisible** (headless) qui exécute tout le pipeline de scraping JS existant.

---

## Plan d'implémentation

### Étape 1 : Créer `ScrapeForegroundService.java`

**Fichier :** `android/app/src/main/java/io/qzz/pressecraper/ScrapeForegroundService.java`

Nouveau service Android :

- Étend `Service` (pas un `IntentService` — on veut qu'il persiste)
- Reçoit l'URL à scraper via l'Intent de démarrage (`intent.getStringExtra("url")`)
- Crée une **notification persistante** ("Presse Scraper - Téléchargement en cours...") — obligatoire pour un ForegroundService
- Crée un **WebView headless** (invisible, pas de layout) :

```java
WebView webView = new WebView(this);
webView.getSettings().setJavaScriptEnabled(true);
webView.getSettings().setDomStorageEnabled(true);
webView.getSettings().setDatabaseEnabled(true);
// IMPORTANT : pointer sur le même dossier de base de données que l'activité principale
// pour partager localStorage + IndexedDB + cookies
webView.getSettings().setDatabasePath(getDatabasePath("webview").getPath());
```

- Injecte les **données de session** dès que la page est chargée :
  - Cookies BnF (via `CookieManager.getInstance().setCookie(...)`)
  - JWT Cafeyn (via `evaluateJavascript()` pour le stocker dans `localStorage`)
  - Règles BPC
- Injecte l'URL partagée puis déclenche `handleSharedContent(url)` via `evaluateJavascript()`
- Écoute les appels `notifyListeners()` qui viennent du JS (via un Capacitor plugin bridge) pour savoir quand le scraping est terminé
- Affiche la notification finale ("Article téléchargé !") et s'arrête

**Points clés :**

- La méthode `onStartCommand()` retourne `START_NOT_STICKY` (ne pas redémarrer si tué)
- La notification persistante utilise le canal `"presse_scraper"` déjà existant dans `BnfLoginPlugin.java`
- Gestion du timeout : si le scraping dépasse 120s, notification d'échec et arrêt

### Étape 2 : Créer `HeadlessScrapePlugin.java`

**Fichier :** `android/app/src/main/java/io/qzz/pressecraper/HeadlessScrapePlugin.java`

Nouveau plugin Capacitor qui sert de **pont de communication JS ↔ ForegroundService** :

```java
@CapacitorPlugin(name = "HeadlessScrape")
public class HeadlessScrapePlugin extends Plugin {
    @PluginMethod
    public void reportStatus(PluginCall call) {
        // Appelé par le JS pour signaler la progression
        String status = call.getString("status"); // "scraping", "pdf", "done", "error"
        String message = call.getString("message");
        // Met à jour la notification persistante
    }

    @PluginMethod
    public void reportComplete(PluginCall call) {
        // Appelé par le JS quand le scraping est terminé
        String articleId = call.getString("articleId");
        String title = call.getString("title");
        // Affiche notification finale
        // Arrête le service
        getContext().stopService(new Intent(getContext(), ScrapeForegroundService.class));
    }

    @PluginMethod
    public void startScrape(PluginCall call) {
        // Appelé depuis JS (ou depuis MainActivity) pour lancer un scraping en arrière-plan
        String url = call.getString("url");
        Intent intent = new Intent(getContext(), ScrapeForegroundService.class);
        intent.putExtra("url", url);
        getContext().startForegroundService(intent);
        call.resolve();
    }
}
```

### Étape 3 : Modifier `MainActivity.java`

**Fichier :** `android/app/src/main/java/io/qzz/pressecraper/MainActivity.java`

Dans `handleIntent()`, pour `ACTION_SEND`, au lieu de seulement notifier le JS, **démarrer le ForegroundService** ET notifier le JS :

```java
if (Intent.ACTION_SEND.equals(action) && type != null) {
    if ("text/plain".equals(type) || "text/html".equals(type)) {
        String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
        String sharedTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        if (sharedText != null) {
            Log.i(TAG, "SEND text (background): " + sharedText);
            // Démarrer le service en arrière-plan
            Intent serviceIntent = new Intent(this, ScrapeForegroundService.class);
            serviceIntent.putExtra("url", sharedText);
            startForegroundService(serviceIntent);
            // Continuer à notifier le JS aussi (pour l'UI si l'app est ouverte)
            notifyJs("sharedText", sharedText);
        }
    }
}
```

**Attention :** `startForegroundService()` nécessite que le service appelle `startForeground()` dans les 5 secondes sous Android 14+.

### Étape 4 : Déclarer le service dans `AndroidManifest.xml`

**Fichier :** `android/app/src/main/AndroidManifest.xml`

Ajouter dans `<application>` :

```xml
<service
    android:name=".ScrapeForegroundService"
    android:exported="false"
    android:foregroundServiceType="dataSync" />
```

Ajouter la permission si nécessaire (déjà présente pour Android 13+) :

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
```

### Étape 5 : Enregistrer `HeadlessScrapePlugin` dans `MainActivity.java`

```java
@Override
protected void onCreate(Bundle savedInstanceState) {
    registerPlugin(BnfLoginPlugin.class);
    registerPlugin(CafeynLoginPlugin.class);
    registerPlugin(IntentForwarderPlugin.class);
    registerPlugin(BackgroundPollPlugin.class);
    registerPlugin(HeadlessScrapePlugin.class);  // NOUVEAU
    super.onCreate(savedInstanceState);
    handleIntent(getIntent());
}
```

### Étape 6 : Copie source du plugin

**Fichier :** `src/plugins/headless-scrape/android/src/main/java/io/qzz/pressecraper/HeadlessScrapePlugin.java`

Même contenu qu'à l'étape 2, pour la convention du projet (copie source dans `src/plugins/`).

### Étape 7 : Modifier `capacitor.config.json`

**Fichier :** `capacitor.config.json`

Ajouter le nouveau plugin :

```json
{
    "plugins": {
        "BnfLogin": { "package": "io.qzz.pressecraper.BnfLoginPlugin" },
        "CafeynLogin": { "package": "io.qzz.pressecraper.CafeynLoginPlugin" },
        "HeadlessScrape": { "package": "io.qzz.pressecraper.HeadlessScrapePlugin" }
    }
}
```

### Étape 8 : Modifier `app.js`

**Fichier :** `www/js/app.js`

- `handleSharedContent()` : si l'app est en arrière-plan, on n'a pas besoin de `switchScreen('homeScreen')`. Ajouter un drapeau `window._headlessMode` qui désactive les mises à jour UI
- Le scraping via `startScraping()` doit être résilient sans UI (ne pas planter si les éléments DOM n'existent pas)
- Après un scraping réussi, appeler `HeadlessScrape.reportComplete({articleId, title})` pour notifier le service natif
- Optionnel : rapporter la progression `HeadlessScrape.reportStatus({status, message})`

### Étape 9 : Gestion des cookies / état

**Problème :** Le WebView headless doit avoir accès aux mêmes cookies et sessions que le WebView principal.

**Solution :**
- **Cookies :** Android `CookieManager` est partagé globalement dans le processus — les cookies sont automatiquement disponibles
- **localStorage :** Chaque WebView a son propre `localStorage` isolé par défaut → **SOLUTION :** avant de déclencher le scraping, injecter les données de session via `evaluateJavascript()` depuis le service :
```java
webView.evaluateJavascript(
    "localStorage.setItem('presse_scraper_v3', '" + escapedState + "');", null);
```
- **IndexedDB :** Le dossier de base de données du WebView doit être partagé → utiliser `getDatabasePath()` qui pointe vers le même dossier
- **Credentials :** Lire depuis `EncryptedSharedPreferences` et injecter dans le WebView

### Étape 10 : Gestion des conflits (optionnel)

- Si l'utilisateur partage plusieurs articles rapidement, le service doit les mettre en file d'attente ou les traiter séquentiellement
- Si l'app est en premier plan quand le partage arrive, on peut choisir de ne **pas** lancer le service (utiliser le flux normal) ou de le lancer quand même et mettre à jour l'UI en parallèle

---

## Résumé des fichiers à modifier/créer

| Fichier | Action |
|---------|--------|
| `android/.../ScrapeForegroundService.java` | **NOUVEAU** — ForegroundService + headless WebView |
| `android/.../HeadlessScrapePlugin.java` | **NOUVEAU** — Pont Capacitor JS ↔ Service |
| `src/plugins/.../HeadlessScrapePlugin.java` | **NOUVEAU** — Copie source du plugin |
| `android/.../MainActivity.java` | **MODIFIER** — Démarrer le service sur `ACTION_SEND` |
| `android/.../AndroidManifest.xml` | **MODIFIER** — Déclarer le service + permissions |
| `capacitor.config.json` | **MODIFIER** — Enregistrer HeadlessScrape plugin |
| `www/js/app.js` | **MODIFIER** — Mode headless, reporter completion |
| `android/.../BnfLoginPlugin.java` | **MODIFIER** — Vérifier que `showNotification` fonctionne sans activité |

---

## Diagramme de flux

```
[User shares URL → Android]
         │
         ▼
MainActivity.handleIntent(ACTION_SEND)
         │
         ├──► notifyJs("sharedText", url)  → JS (UI) si app ouverte
         │
         └──► startForegroundService(intent)
                    │
                    ▼
         ScrapeForegroundService.onCreate()
                    │
                    ├──► startForeground(NOTIF)  // "Téléchargement..."
                    │
                    └──► Headless WebView
                              │
                              ├──► load la web app (index.html)
                              ├──► injecte session (cookies, localStorage)
                              ├──► injecte URL + handleSharedContent(url)
                              │
                              ├──► Orchestrator.scrapeArticle(url)
                              │       ├── BPC
                              │       ├── PressReader
                              │       ├── Cafeyn
                              │       └── BnF Europresse
                              │
                              ├──► PDF generation
                              ├──► IndexedDB save
                              │
                              └──► HeadlessScrape.reportComplete({articleId, title})
                                        │
                                        ▼
                              ScrapeForegroundService
                                        │
                                        ├──► showNotification("Article téléchargé !")
                                        └──► stopForeground() + stopSelf()
```

---

## Points d'attention

1. **Partage des données entre WebViews :**
   - Les **cookies HTTP** sont globaux (CookieManager) → OK
   - Le **localStorage** est isolé par WebView → injection JS nécessaire
   - **IndexedDB** nécessite un chemin de base de données partagé
   - Les **EncryptedSharedPreferences** sont globales → OK pour les credentials

2. **Permissions Android :**
   - `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC` nécessaires (Android 14+)
   - La notification persistante du service doit être compatible avec `POST_NOTIFICATIONS` (Android 13+)

3. **Timeout :** Si le scrape dépasse 2 minutes, le service affiche une notification d'échec et s'arrête

4. **WebView headless :** Pas besoin d'ajouter le WebView à un layout. Il peut exister sans vue parente.

5. **Capacitor `triggerWindowJSEvent` :** Ce mécanisme (`getBridge().triggerWindowJSEvent()`) fonctionne uniquement sur le WebView de l'activité principale. Dans le service, on utilisera `evaluateJavascript()` directement.
