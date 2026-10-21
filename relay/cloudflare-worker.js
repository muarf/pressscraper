/**
 * Cloudflare Worker — Relais anonyme PresseScraper -> Telegram
 * ==============================================================
 * Ce worker gratuit sert de pont sécurisé : il reçoit les signalements d'erreurs
 * et les propositions de règles depuis l'application PresseScraper, et les transmet
 * à votre bot Telegram sans JAMAIS exposer votre BOT_TOKEN aux utilisateurs.
 *
 * Variables d'environnement requises (sur Cloudflare Dashboard > Settings > Variables) :
 *   - TELEGRAM_BOT_TOKEN : Votre token bot (ex: "8867499796:AAFW...")
 *   - TELEGRAM_CHAT_ID   : Votre Chat ID (ex: "1137117016")
 */

export default {
  async fetch(request, env) {
    // Gestion CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    try {
      const data = await request.json();
      const botToken = env.TELEGRAM_BOT_TOKEN;
      const chatId = env.TELEGRAM_CHAT_ID;

      if (!botToken || !chatId) {
        return new Response(JSON.stringify({ error: "Configuration manquante sur le worker" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      let text = "";
      if (data.type === "rule_proposal") {
        text = `🚀 *Nouvelle règle proposée !*\n\n` +
               `🌐 *Domaine :* \`${data.domain || 'Inconnu'}\`\n` +
               `🎯 *Sélecteur :* \`${data.contentSelector || 'N/A'}\`\n` +
               (data.paywallSelector ? `🚫 *Paywall :* \`${data.paywallSelector}\`\n` : '') +
               `🔗 *URL testée :* ${data.testUrl || 'N/A'}\n` +
               `📏 *Longueur extraite :* ${data.extractedLength || 0} caractères\n` +
               `📱 *Version App :* ${data.appVersion || 'N/A'}`;
      } else {
        text = `⚠️ *Signalement d'échec de site*\n\n` +
               `🌐 *Domaine :* \`${data.domain || 'Inconnu'}\`\n` +
               `🔗 *URL :* ${data.url || 'N/A'}\n` +
               `❌ *Erreur :* ${data.reason || "Échec d'extraction"}\n` +
               `🎯 *Sélecteur tenté :* \`${data.selector || 'générique'}\`\n` +
               `📱 *Version App :* ${data.appVersion || 'N/A'}`;
      }

      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: "Markdown",
          disable_web_page_preview: true
        }),
      });

      const tgData = await tgRes.json();
      if (!tgData.ok) {
        return new Response(JSON.stringify({ error: tgData.description }), {
          status: 502,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }
  },
};
