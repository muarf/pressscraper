# Presse Scraper (Application Android Autonome)

📰 **Presse Scraper** est une application Android **100 % autonome** permettant de lire des articles de presse sous paywall (sans publicité ni pistage) en combinant 4 méthodes de récupération et d'authentification locales.

---

## 🔍 Les 4 méthodes de récupération (Bypass)

L'application tente de déverrouiller l'article partagé en interrogeant successivement les sources activées (l'ordre de priorité est entièrement personnalisable dans vos paramètres) :

### 1. Bypass Direct (BPC - Bypass Paywalls Clean)
* **Comment ça marche** : L'app télécharge la page web originale de l'article en modifiant son User-Agent (ex: imitation de Googlebot) et en exécutant les scripts officiels de [Bypass Paywalls Clean](https://gitflic.ru/project/magnolia1234/bpc_uploads) dans un environnement isolé (Iframe sandboxée) afin de lever le verrou côté client.
* **Configuration requise** : **Aucune**. Les règles peuvent être mises à jour d'un clic dans les paramètres de l'application.

### 2. Recherche PressReader (via Médiathèque Toulouse)
* **Comment ça marche** : L'app se connecte à PressReader via la médiathèque de Toulouse Métropole, puis recherche et extrait l'article complet au format texte.

### 3. Recherche Cafeyn (via Médiathèque)
* **Comment ça marche** : L'app recherche l'article dans le catalogue Cafeyn via des requêtes de recherche intelligentes et multi-couches. Si l'article y est disponible, il est récupéré en format texte épuré avec ses images haute définition.
* **Configuration requise** : Un compte médiathèque compatible Cafeyn, par exemple en s'inscrivant gratuitement et instantanément sur les [Médiathèques de Sud Est Avenir](https://mediatheques.sudestavenir.fr/).
### 4. Recherche BnF Europresse (EZProxy)
* **Comment ça marche** : L'app s'authentifie sur l'EZProxy de la BnF, effectue une recherche avancée sur la base de données Europresse avec le titre de l'article, puis extrait le texte intégral tout en supprimant automatiquement les surlignages de recherche.
* **Configuration requise** : Un abonnement annuel BnF (Pass Lecture/Culture à 24 €, GRATUIT POUR LES RSAstes !).
* **Idéal pour** : L'archive historique complète et tous les articles payants non trouvés par les autres méthodes.

---

## 📖 Utilisation

Le principe est simple : lorsque vous naviguez sur un article payant :
1. Cliquez sur la fonction **Partager** de votre téléphone et sélectionnez **Presse Scraper**.
2. L'application intercepte l'URL partagée, extrait le titre de l'article et lance le moteur de recherche/scraping.
3. L'article est converti en page épurée (HTML propre avec feuille de style d'impression) et peut être exporté en **PDF** mis en page localement sur le téléphone ou copié dans le presse-papiers.

---

## 🚀 Fonctionnalités Clés

* **100 % Client-Side / Autonome** : Toutes les requêtes HTTP, l'authentification et l'analyse HTML se font localement sur le téléphone. Aucun serveur intermédiaire ne stocke vos identifiants ou vos lectures.
* **Moteur de recherche intelligent multi-essais** : 
  - Stratégie d'extraction de noms propres (`Proper Nouns fallback`) pour faire correspondre les titres web (clickbait/SEO) avec les titres de l'édition imprimée de Cafeyn et PressReader.
  - Retours automatiques sur les premières/dernières portions du titre en cas d'absence de résultat.
* **Mises à jour des règles BPC en un clic** : Téléchargement et extraction natifs asynchrones (via flux ZIP en mémoire) des dernières règles de contournement BPC officielles directement depuis l'onglet Paramètres.
* **Utilisation flexible** : Vous pouvez configurer uniquement Cafeyn, PressReader ou Europresse, ou ignorer certaines configurations. L'application s'adaptera automatiquement en interrogeant uniquement les services configurés.
* **Export & Partage** : Copie du texte brut dans le presse-papiers ou génération de PDF propre via l'API d'impression Android native.
* **Nettoyage automatique** : Suppression des balises de surlignage jaune (`<mark>`, classes `.hlterms`) insérées par Europresse.

---

## 📥 Téléchargement

Vous pouvez télécharger la dernière version de l'application (le fichier `.apk` généré) directement depuis la page des **Releases** :

👉 **[Télécharger le dernier APK (Release)](https://github.com/muarf/pressscraper/releases/latest)**

*(Note : Lors de l'installation, Android pourrait vous demander d'autoriser l'installation d'applications issues de sources inconnues).*

---

## 🛠️ Pour les développeurs

L'application est hybride, développée avec **Capacitor** (HTML/CSS/JS) et enrichie de code natif Android (**Java**) sous forme de plugins Capacitor.

### Structure du projet
* `www/` : Code source de l'interface Web de l'application (HTML/CSS/JS).
* `android/` : Projet Android natif généré par Capacitor.
  - `android/app/src/main/java/io/qzz/pressecraper/BnfLoginPlugin.java` : Plugin Java gérant les requêtes HTTP (avec maintien des redirections et des cookies) et le déclenchement de l'impression PDF native.

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
