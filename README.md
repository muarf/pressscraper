# Presse Scraper (Application Android Autonome)

📰 **Presse Scraper** est une application Android **100 % autonome** permettant de lire des articles de presse sous paywall (Le Monde, Libération, Le Figaro, etc.) en s'appuyant sur votre abonnement à la **Bibliothèque nationale de France (BnF)**.

Le principe est simple : lorsque vous êtes sur un article payant depuis votre navigateur ou l'application d'un journal, utilisez la fonction "Partager" d'Android et sélectionnez **Presse Scraper**. L'application se charge de s'authentifier à la BnF, d'intercepter les cookies de session, de rechercher l'article complet directement sur **Europresse**, d'en extraire le texte épuré (sans surlignages de recherche), et de générer un PDF mis en page localement sur votre téléphone.

---

## 🚀 Fonctionnalités Clés

- **100 % Client-Side / Autonome** : Toutes les requêtes HTTP, l'authentification et l'analyse HTML se font localement sur le téléphone.
- **Contournement Direct (Bypass Paywalls Clean)** : Support du contournement direct pour les articles de presse compatibles (Le Monde, Le Figaro, etc.) sans passer par Europresse, grâce à l'intégration du moteur BPC.
- **Mises à jour des règles BPC en un clic** : Téléchargement et extraction natifs asynchrones (via flux ZIP en mémoire) des dernières règles de contournement BPC officielles directement depuis l'onglet Paramètres.
- **Saut d'onboarding & Utilisation autonome** : Possibilité d'ignorer la configuration Europresse au démarrage. Si aucun compte BnF n'est configuré, l'application fonctionne de manière autonome en mode contournement direct (BPC) uniquement et évite de contacter Europresse.
- **Partage & Copie intégrale** : Possibilité de copier le texte brut complet de l'article dans le presse-papiers ou de le partager directement à d'autres applications sous forme textuelle depuis la barre d'outils de la visionneuse.
- **Interception Intelligente des Partages** : Gère les textes de partage complexes (contenant à la fois le titre et le lien de l'article) pour extraire automatiquement l'URL et le titre d'origine.
- **Bypass WAF (Web Application Firewall)** : En utilisant le titre extrait du partage comme titre de recherche prioritaire, l'application évite d'avoir à scraper le site d'origine et contourne ainsi les blocages de sécurité (erreurs 403 Cloudflare/WAF).
- **Recherche Directe par Mots-clés** : Saisie directe de mots-clés ou d'un titre dans la barre de recherche au lieu d'un lien d'article.
- **Nettoyage Automatique des Highlights** : Supprime automatiquement les balises de surlignage jaune (`<mark>`, classes `.hlterms`) insérées par Europresse.
- **Génération PDF Locale** : Génère et enregistre un PDF propre et mis en page de l'article directement dans le stockage de l'appareil via l'API d'impression Android native.

---

## 📥 Téléchargement

Vous pouvez télécharger la dernière version de l'application (le fichier `.apk` généré) directement depuis la page des **Releases** :

👉 **[Télécharger le dernier APK (Release)](https://github.com/muarf/pressscraper/releases/latest)**

*(Note : Lors de l'installation, Android pourrait vous demander d'autoriser l'installation d'applications issues de sources inconnues).*

---

## 🛠️ Pour les développeurs

L'application est hybride, développée avec **Ionic / Capacitor** (HTML/JS) et enrichie de code natif Android (**Java**) sous forme de plugin.

### Structure du projet
- `www/` : Code source de l'interface Web de l'application (HTML/CSS/JS).
- `android/` : Projet Android natif généré par Capacitor.
  - `android/app/src/main/java/io/qzz/pressecraper/BnfLoginPlugin.java` : Plugin Java gérant les requêtes HTTP (avec maintien manuel des redirections/cookies) et le déclenchement de l'impression PDF native.

### Commandes utiles

1. **Synchroniser les modifications Web vers le projet Android** :
   ```bash
   npx cap copy android
   ```

2. **Compiler et installer la version de débogage sur l'appareil connecté** :
   *(Nécessite JDK 21)*
   ```bash
   JAVA_HOME=/path/to/jdk-21 ./gradlew installDebug
   ```
   *(Commande à lancer depuis le répertoire `android/`)*

3. **Suivre les journaux d'exécution (Logs)** :
   ```bash
   adb logcat --pid=$(adb shell pidof io.qzz.pressecraper)
   ```
