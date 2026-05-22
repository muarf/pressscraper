# Presse Scraper (Mobile)

Application mobile autonome et interface hybride (Capacitor/Android) pour le projet **Presse Scraper**. 
Elle permet d'utiliser le partage natif Android pour scraper des articles depuis diverses applications de presse en s'appuyant sur un backend (read-scraper-api) et le protocole *Cookie-Relay* via la BnF.

## Fonctionnement

- **Interface Hybride** : Application basée sur Capacitor (HTML/CSS/JS).
- **Plugins Natifs** :
  - `BnfLoginPlugin` : Connexion transparente en tâche de fond pour acquérir les cookies de session.
  - `IntentForwarderPlugin` : Interception des partages natifs (URLs d'articles).
  - `BackgroundPollPlugin` : Polling en arrière-plan de l'état du scraping, même lorsque l'application est suspendue.

Pour plus de détails techniques, veuillez consulter le fichier `FONCTIONNEMENT.md`.

## Build Android

Le projet contient un workflow GitHub Actions pour compiler automatiquement l'APK à chaque push.
En local, vous pouvez générer l'APK via :

```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
```
