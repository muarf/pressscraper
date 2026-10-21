# Déploiement du Relais Anonyme (Cloudflare Workers)

Ce micro-relais gratuit reçoit les signalements d'échec et les propositions de règles depuis PresseScraper et les transmet à votre Telegram.

## Déploiement en 2 minutes (100% gratuit) :

1. Rendez-vous sur [dash.cloudflare.com](https://dash.cloudflare.com/) (compte gratuit sans carte bancaire).
2. Cliquez sur **Workers & Pages** > **Create application** > **Create Worker**.
3. Donnez-lui un nom (ex: `pressscraper-relay`) et cliquez sur **Deploy**.
4. Cliquez ensuite sur **Edit code** :
   - Effacez le code existant.
   - Collez le contenu de `cloudflare-worker.js`.
   - Cliquez sur **Save and deploy**.
5. Allez dans l'onglet **Settings** > **Variables** :
   - Ajoutez `TELEGRAM_BOT_TOKEN` : `8867499796:AAFWwNTKwnO2ZQJZyn-xa_Hnxqhhuniz-Og` (en cochant "Encrypt").
   - Ajoutez `TELEGRAM_CHAT_ID` : `1137117016` (en cochant "Encrypt").
6. Votre URL de worker (ex: `https://pressscraper-relay.votrenom.workers.dev`) est prête !
   - Vous pouvez coller cette URL dans les Paramètres de l'application ou l'utiliser comme URL par défaut.
