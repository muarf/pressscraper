# Presse Scraper (Application Android)

📰 **Presse Scraper** est une application Android permettant de lire des articles de presse sous paywall (Le Monde, Libération, Le Figaro, etc.) en s'appuyant sur votre abonnement à la **Bibliothèque nationale de France (BnF)**.

Inspiré d'extensions comme *Ophirofox*, le principe est simple : lorsque vous êtes sur un article payant depuis votre navigateur ou l'application d'un journal, utilisez la fonction "Partager" d'Android et sélectionnez **Presse Scraper**. L'application se charge de se connecter à la plateforme **Europresse** (via vos accès BnF), de retrouver l'article complet, et de vous le fournir.

---

## 📥 Téléchargement

Vous pouvez télécharger la dernière version de l'application (le fichier `.apk` généré automatiquement) directement depuis la page des **Releases** :

👉 **[Télécharger le dernier APK (Release)](https://github.com/muarf/pressscraper/releases/latest)**

*(Note : Lors de l'installation, Android pourrait vous demander d'autoriser l'installation d'applications issues de sources inconnues).*

---

## ⚙️ Prérequis : Serveur Backend

**Important :** Cette application mobile n'est que l'interface. Tout le travail lourd (la recherche intelligente, la navigation automatisée pour contourner les protections et la génération du PDF) est effectué par un serveur central.

Pour que l'application fonctionne, vous devez posséder et configurer ce serveur backend :
👉 **[Dépôt du serveur backend : read-scraper-api](https://github.com/muarf/read-scraper-api)**

*(C'est au sein de l'application mobile que vous renseignerez ensuite l'URL de votre serveur ainsi que vos identifiants BnF).*

---

## 🛠️ Pour les développeurs

L'application est hybride, développée avec **Ionic / Capacitor** (HTML/JS) enrichie avec du code natif Android (Java) pour permettre :
- Une connexion invisible en tâche de fond pour récupérer la session BnF (*Cookie-Relay*).
- L'interception des partages d'URL du système Android.
- Le suivi (polling) de l'avancement de la création du PDF en arrière-plan.

Pour tous les détails techniques sur l'architecture, référez-vous au fichier `FONCTIONNEMENT.md`.
