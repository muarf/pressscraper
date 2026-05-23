# TODO List détaillée : Améliorations de Presse Scraper

Ce document détaille la liste des tâches (TODO list) pour implémenter les propositions d'améliorations au niveau de la structure du code, de la sécurité des identifiants et du rendu visuel de l'application.

---

## 📂 1. Modularisation et Restructuration du Code (Lisibilité & Maintenance)

Actuellement, tout le CSS et le JavaScript sont intégrés dans le fichier `index.html` de plus de 1300 lignes. L'objectif est de séparer proprement les responsabilités.

- [ ] **1.1. Séparation du style CSS**
  - Créer le fichier `www/css/style.css` et y extraire toutes les règles CSS du bloc `<style>` d'index.html.
  - Importer ce fichier dans le HTML avec `<link rel="stylesheet" href="css/style.css">`.
- [ ] **1.2. Séparation de la base de données (IndexedDB)**
  - Créer `www/js/db.js`.
  - Y déplacer les fonctions `openDatabase`, `getArticleFromDb`, `saveArticleToDb`, `deleteArticleFromDb`, `getAllArticlesFromDb` et `clearAllArticlesFromDb`.
- [ ] **1.3. Séparation de la logique de Scraping**
  - Créer `www/js/scraper.js`.
  - Y déplacer les fonctions `scrapeArticleClientSide`, `processTitleToQuery`, `calculateDateFilter`, `calculateSimilarity` et `removeHighlightTags`.
- [ ] **1.4. Centralisation de la logique UI et Initialisation**
  - Créer `www/js/app.js` pour gérer l'état global (`state`), l'affichage des écrans, les gestionnaires d'événements des boutons (`onboardLogin`, `startScraping`, etc.) et la navigation.
- [ ] **1.5. Nettoyage d'index.html**
  - Supprimer les blocs `<style>` et `<script>` internes pour ne conserver que la structure HTML brute avec les liens vers les fichiers JS/CSS externes.

---

## 🗑️ 2. Gestion de la Duplication d'index.html (Maintenance)

Éviter de maintenir deux fichiers `index.html` identiques à la racine et dans `www/`.

- [ ] **2.1. Suppression de la duplication**
  - Supprimer le fichier de la racine (`index.html`) et utiliser uniquement `www/index.html`.
  - *Alternative* : Configurer un script simple de copie dans `package.json` (ex: `"copy-assets": "cp index.html www/index.html"`) s'il est préférable de garder le fichier source à la racine.

---

## 🔒 3. Sécurisation des Identifiants (Sécurité & Confidentialité)

Actuellement, les identifiants BnF de l'utilisateur sont stockés en clair dans le `localStorage` de la WebView d'Android.

- [ ] **3.1. Implémenter le stockage sécurisé côté Java**
  - Modifier le plugin natif `BnfLoginPlugin.java` pour y ajouter des méthodes de sauvegarde et lecture chiffrées en s'appuyant sur l'API Android native `EncryptedSharedPreferences` ou sur le **Keystore Android**.
  - Exposer deux méthodes natives : `saveCredentials({ username, password })` et `getCredentials()`.
- [ ] **3.2. Remplacer le localStorage côté JavaScript**
  - Mettre à jour `www/js/app.js` pour appeler ces méthodes natives Capacitor au démarrage de l'application et lors de la connexion, à la place des appels à `localStorage.getItem` et `localStorage.setItem` pour le mot de passe et l'identifiant.

---

## 🖨️ 4. Optimisation de la Mise en Page des PDF Générés (Rendu)

Permettre d'obtenir des fichiers PDF parfaitement mis en page, lisibles et sans coupures inesthétiques.

- [ ] **4.1. Créer une feuille de style d'impression**
  - Créer `www/css/print.css` avec des styles spécifiques pour l'impression (`@media print`) :
    - Définir des marges de page propres (`@page { margin: 15mm 20mm; }`).
    - Empêcher la coupure des paragraphes ou des images au milieu d'une page (`page-break-inside: avoid;`).
    - Masquer tout élément UI résiduel (boutons, barres de progression) qui n'aurait pas à figurer sur le document papier.
- [ ] **4.2. Injecter le CSS d'impression dans le flux PDF**
  - Avant de passer le code HTML final au plugin natif `BnfLoginPlugin.printHtmlToPdf`, concaténer le style CSS d'impression dans le document HTML pour que la WebView d'impression Android l'applique automatiquement.

---

## 📱 5. Gestion Dynamique et Cohérente du User-Agent (Anti-bot Bypass)

Éviter l'identification du bot par Europresse ou d'autres services en utilisant un User-Agent fixe.

- [ ] **5.1. Extraction du User-Agent système**
  - Modifier le plugin natif `BnfLoginPlugin.java` pour récupérer automatiquement le User-Agent réel de la WebView de l'appareil (via `WebSettings.getDefaultUserAgent(context)`).
- [ ] **5.2. Injection automatique dans les requêtes**
  - Utiliser ce User-Agent système dans toutes les requêtes réseau émises par `BnfLogin.httpRequest(...)` au lieu d'une chaîne statique dans le JavaScript.
