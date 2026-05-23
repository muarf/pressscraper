# Cahier des charges et Guide d'implémentation : Scraping Client-Side (Option B) sur Android

Ce document est destiné à l'agent d'IA en charge du développement de l'application Android. Il contient l'ensemble du contexte, des diagnostics techniques et de la feuille de route pour implémenter un scraping 100% client-side (local) ou assisté, permettant de contourner les blocages WAF et de liaisons d'IP (IP-Binding).

---

## 1. Contexte et Problématique du Scraper Actuel (Serveur)

Le système actuel tourne sur un serveur Python (Selenium headless + requêtes HTTP directes). Il rencontre deux blocages insolubles côté serveur :

1. **Blocage WAF (Web Application Firewall)** : Les sites de presse comme *Marianne* ou *Libération* utilisent des pare-feu applicatifs stricts (AWS WAF, Cloudflare) qui détectent et bloquent immédiatement les requêtes provenant d'IPs de serveurs cloud. Le bypass via proxy de traduction (comme Google Translate) est instable et ne renvoie que l'accroche publique (chapeau + premier paragraphe) en raison du paywall.
2. **Authentification BnF & IP-Binding** : Pour accéder aux versions complètes gratuites via Europresse (compte BnF), le serveur doit utiliser une session authentifiée. Les cookies de session générés sur un appareil (ex: téléphone de l'utilisateur) sont associés à son adresse IP. Si ces cookies sont envoyés au serveur, le serveur BnF (EZProxy) détecte la différence d'IP, invalide la session et redirige vers un portail de connexion SAML2 (Shibboleth) impossible à gérer de manière fiable sans moteur d'exécution JavaScript.

---

## 2. La Solution : Scraping Client-Side (Option B)

Puisque l'utilisateur possède déjà une session active sur son téléphone, l'application Android peut se charger de tout le flux d'extraction de manière native, en utilisant l'adresse IP et la connexion de l'utilisateur.

Deux architectures sont envisageables :
* **Option B1 (Hybride)** : Le téléphone extrait le HTML de l'article via Europresse/BnF et l'envoie au serveur par POST. Le serveur s'occupe de compiler le PDF premium et de l'ajouter à la base de données partagée.
* **Option B2 (100% Client-Side - Serverless)** : Le téléphone fait tout (connexion, recherche, extraction du texte, génération du PDF stylisé, et stockage local dans une base SQLite Android). **Aucun serveur n'est nécessaire.**

---

## 3. Guide Technique pour l'implémentation Android (Option B2 - 100% Client-Side)

### Étape 1 : Gestion de la session BnF / Europresse (WebView)
L'application doit embarquer un composant `WebView` Android pour gérer la connexion.
* **Configuration de la WebView** :
  ```java
  WebView webView = findViewById(R.id.webview);
  WebSettings settings = webView.getSettings();
  settings.setJavaScriptEnabled(true);
  settings.setDomStorageEnabled(true);
  
  // Activer la persistance des cookies
  CookieManager cookieManager = CookieManager.getInstance();
  cookieManager.setAcceptCookie(true);
  cookieManager.setAcceptThirdPartyCookies(webView, true);
  ```
* **Flux d'authentification** : 
  1. Charger l'URL d'accès : `https://nouveau-europresse-com.bnf.idm.oclc.org/`
  2. La WebView affichera naturellement la mire de connexion BnF CAS. L'utilisateur saisit ses identifiants une seule fois.
  3. Les cookies de session seront stockés localement par Android.

### Étape 2 : Extraction automatisée de l'article (Recherche & Récupération)
Pour extraire un article à partir d'un titre ou d'une URL de presse (ex: un lien Libération ou Le Monde partagé vers l'app) :
1. **Reconstruction du titre** : Si l'utilisateur partage une URL, reconstruire le titre à partir du *slug* de fin (ex: `coup-de-chaud-sur-la-france` -> `coup chaud sur la france`).
2. **Recherche sur Europresse** : 
   * Naviguer la WebView (masquée ou en arrière-plan) vers la page de recherche : `https://nouveau-europresse-com.bnf.idm.oclc.org/Search/Reading`
   * Injecter du code JavaScript pour remplir le champ recherche, régler les filtres et soumettre :
     ```javascript
     webView.evaluateJavascript(
         "document.querySelector('input[name=\"Keywords\"]').value = 'TEXT= " + query + "';" +
         "document.getElementById('DateFilter_DateRange').value = '9';" + // Toutes les archives
         "document.querySelector('form').submit();", 
         null
     );
     ```
3. **Extraction du DOM de l'article** :
   * Une fois les résultats chargés, identifier l'article le plus pertinent, naviguer vers son lien et injecter un script JS pour extraire le contenu utile (le titre, l'auteur, la date et le corps de l'article dans la classe `.docOcurrContainer`).
   * Récupérer ce texte structuré dans le code Java/Kotlin via un callback :
     ```java
     webView.evaluateJavascript(
         "(function() { " +
         "  var title = document.querySelector('.titreArticleVisu')?.innerText || '';" +
         "  var body = document.querySelector('.docOcurrContainer')?.innerHTML || '';" +
         "  return JSON.stringify({title: title, body: body});" +
         "})();",
         value -> {
             // Traiter le JSON reçu contenant le contenu complet
         }
     );
     ```

### Étape 3 : Génération du PDF stylisé (Natif Android)
Une fois le HTML de l'article récupéré, l'application peut générer un PDF au design premium directement sur le téléphone.

1. **Création d'un gabarit HTML local** avec des styles CSS soignés (polices modernes, couleurs de la marque du journal, structure claire).
2. **Impression silencieuse du HTML en PDF** en utilisant le service d'impression natif d'Android :
   ```java
   // Charger l'HTML formaté dans une WebView temporaire
   WebView printWebView = new WebView(context);
   printWebView.loadDataWithBaseURL("file:///android_asset/", premiumHtml, "text/html", "UTF-8", null);
   
   printWebView.setWebViewClient(new WebViewClient() {
       @Override
       public void onPageFinished(WebView view, String url) {
           // Lancer l'impression vers un fichier PDF
           PrintManager printManager = (PrintManager) context.getSystemService(Context.PRINT_SERVICE);
           PrintDocumentAdapter printAdapter = printWebView.createPrintDocumentAdapter("Article");
           
           // Configurer la destination vers un fichier local PDF
           File pdfFile = new File(context.getExternalFilesDir(null), filename + ".pdf");
           // Utiliser un adaptateur d'écriture de fichier PDF (ex: via PdfDocument Android)
       }
   });
   ```

### Étape 4 : Stockage local (SQLite / Room)
* Utiliser **Room database** (la bibliothèque ORM recommandée sur Android) pour gérer une table `articles` identique à celle du serveur :
  * `id` (Clé primaire)
  * `url` (TEXT)
  * `title` (TEXT)
  * `html_content` (TEXT)
  * `pdf_path` (TEXT - chemin du fichier stocké dans le stockage interne de l'application)
  * `site_source` (TEXT)
  * `scraped_at` (TIMESTAMP)
* Ajouter un écran de bibliothèque native dans l'application Android pour lister, rechercher en texte intégral (FTS5 SQLite est disponible nativement sur Android) et ouvrir les PDFs locaux à l'aide d'un lecteur PDF intégré.

---

## 4. Recommandation générale de développement

> [!TIP]
> **Privilégier l'Option B2 (100% Client-Side)** : C'est l'option la plus propre. Elle élimine complètement le besoin de maintenir un serveur web, une base de données cloud et des proxies en ligne. L'application devient totalement autonome, ultra-rapide, et respecte la vie privée de l'utilisateur (les cookies et identifiants BnF ne quittent jamais le téléphone).
