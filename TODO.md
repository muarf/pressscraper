# TODO — Presse Scraper

## 1. Choix du thème au démarrage
- [ ] Ajouter un slide dans l'onboarding pour choisir le thème : **Sombre**, **Clair** ou **Sable**
- [ ] Appliquer le thème immédiatement
- [ ] Stocker le choix dans `state.theme`

## 2. BPC — ne pas l'embarquer dans le code, l'utilisateur clique pour l'installer
- [ ] Retirer BPC du code source (ne pas l'héberger → risque de strike)
- [ ] Ajouter un bouton/slide cliquable pendant l'onboarding pour que l'utilisateur télécharge BPC
- [ ] Fonctionnement similaire au bouton "Mettre à jour les règles BPC" déjà présent dans les paramètres : l'utilisateur clique, ça va chercher BPC et l'installe

## 3. Référent PressReader — pré-remplir + validation utilisateur
- [ ] Pré-remplir le champ référent réseau avec celui de la **BPM de Toulouse Métropole**
- [ ] L'utilisateur peut modifier et doit **valider** le référent avant utilisation
- [ ] Stocker le référent validé dans la config

## 4. Messages d'erreur plus clairs — détection article fraîchement publié
- [ ] Si l'article vient d'être publié (< 24h) et n'est pas trouvé, afficher un message expliquant que l'article est trop récent et peut ne pas encore être indexé
- [ ] Suggérer de réessayer plus tard
- [ ] Rédiger un message narratif plutôt qu'une erreur technique brute

## 5. Métadonnées article — traçabilité complète ✅
- [x] **Journal / publication** (`publication`) — dispo pour tous les providers
- [x] **Date et heure** (`publishedDate`) — dispo pour tous les providers
- [x] **Auteur(s)** (`author`) — dispo pour Cafeyn/PressReader/Europresse, optionnel pour BPC (selon le site)
- [x] **Service utilisé** (`serviceUsed`) — BPC, PressReader, Cafeyn, BnF Europresse
- [x] Stockées en base + affichées dans le viewer (barre au-dessus du contenu)
- [x] Affichées dans l'historique
- **NB** : pour l'instant l'extraction est faite ad-hoc dans scraper.js. Le refactoring connecteur/service (section 7) rendra ça plus propre.

## 6. Releases et auto-update depuis GitHub
✅ Workflow GitHub Actions : `.github/workflows/release.yml`
✅ Plugin natif : `getAppVersion`, `downloadApk`, `installApk` dans `BnfLoginPlugin.java`
✅ Check JS : `www/js/updater.js` (vérifie sur l'API GitHub, compare les versions)
✅ UI : toast de notification + bouton "Vérifier les mises à jour" dans les paramètres

### Pour faire une release
```bash
# 1. Mettre à jour versionCode et versionName dans android/app/build.gradle
# 2. Commiter avec le tag
git tag v1.0.1
git push origin v1.0.1
# 3. GitHub Actions build l'APK et crée la release automatiquement
```

### Prérequis GitHub
- Ajouter les secrets dans Settings → Secrets and variables → Actions :
  - `SIGNING_KEY` : keystore en base64 (`base64 -w0 mon.keystore`)
  - `KEY_ALIAS` : alias du keystore
  - `KEY_STORE_PASSWORD` : mot de passe du keystore
  - `KEY_PASSWORD` : mot de passe de la clé
- Mettre à jour `GITHUB_REPO` dans `www/js/updater.js` avec votre compte/repo

## 7. Architecture modulaire — connecteurs multiples par service (vision future, ne pas implémenter maintenant)
Cadre à garder en tête pour la suite :

- Il y a **4 services cibles** : Europresse, PressReader, Cafeyn, BPC
- Pour les 3 premiers, il peut y avoir **plusieurs façons de s'y connecter** (médiathèques, institutions...)
  - Ex. Europresse : BnF, Médiathèque de Rennes, etc.
  - Ex. PressReader : Toulouse Métropole, Lyon, etc.
  - Ex. Cafeyn : GPSEA, autre médiathèque, etc.
- Actuellement on a **1 connecteur par service** (BnF → Europresse, Toulouse → PressReader, GPSEA → Cafeyn)
- **Objectif futur** : pouvoir ajouter un nouveau connecteur (ex. « Médiathèque de Rennes → Europresse ») en déposant un petit fichier qui décrit comment se connecter depuis cet accès, sans toucher au reste
- Le moteur de scraping doit rester agnostique : il itère sur les connecteurs disponibles sans connaître leur implémentation
