/**
 * feedback-service.js — Service de signalement d'erreurs et de contribution communautaire
 * =======================================================================================
 * Permet d'envoyer de façon anonyme et transparente :
 *   1. Les signalements de sites en échec (URL, domaine, erreur, sélecteur)
 *   2. Les propositions de nouvelles règles validées par l'utilisateur
 *
 * Fonctionne soit via un micro-relais (sans secret dans l'app pour les utilisateurs),
 * soit directement via Telegram si l'administrateur a configuré ses clés en local.
 */
(function(global) {
    'use strict';

    const STORAGE_KEY_RELAY_URL = 'ps_feedback_relay_url';
    const STORAGE_KEY_ADMIN_TOKEN = 'ps_admin_telegram_token';
    const STORAGE_KEY_ADMIN_CHAT_ID = 'ps_admin_telegram_chat_id';

    // URL par défaut du relais public (peut être mis à jour ou surchargé dans l'app)
    const DEFAULT_RELAY_URL = 'https://pressscraper-relay.muarfanar.workers.dev';

    function getRelayUrl() {
        return localStorage.getItem(STORAGE_KEY_RELAY_URL) || DEFAULT_RELAY_URL;
    }

    function setRelayUrl(url) {
        if (!url) localStorage.removeItem(STORAGE_KEY_RELAY_URL);
        else localStorage.setItem(STORAGE_KEY_RELAY_URL, url.trim());
    }

    function getAdminCredentials() {
        return {
            token: localStorage.getItem(STORAGE_KEY_ADMIN_TOKEN) || '',
            chatId: localStorage.getItem(STORAGE_KEY_ADMIN_CHAT_ID) || ''
        };
    }

    function setAdminCredentials(token, chatId) {
        if (token) localStorage.setItem(STORAGE_KEY_ADMIN_TOKEN, token.trim());
        else localStorage.removeItem(STORAGE_KEY_ADMIN_TOKEN);

        if (chatId) localStorage.setItem(STORAGE_KEY_ADMIN_CHAT_ID, String(chatId).trim());
        else localStorage.removeItem(STORAGE_KEY_ADMIN_CHAT_ID);
    }

    /**
     * Envoi direct à Telegram (utilisé uniquement si les clés admin locales sont présentes)
     */
    async function sendDirectToTelegram(token, chatId, text) {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown',
                disable_web_page_preview: true
            })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.description || 'Erreur Telegram');
        return true;
    }

    /**
     * Envoi via le micro-relais anonyme (recommandé pour les utilisateurs finaux)
     */
    async function sendViaRelay(payload) {
        const relayUrl = getRelayUrl();
        if (!relayUrl) throw new Error('Aucun relais configuré');

        const res = await fetch(relayUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || 'Erreur relais HTTP ' + res.status);
        return true;
    }

    async function getEffectiveAppVersion() {
        try {
            const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
            if (BnfLogin && typeof BnfLogin.getAppVersion === 'function') {
                const res = await BnfLogin.getAppVersion();
                if (res && res.versionName) return res.versionName;
            }
        } catch (_) {}
        return document.getElementById('appVersionText')?.textContent?.trim() || '1.1.14';
    }

    /**
     * Signale un problème d'extraction sur un site
     */
    async function reportSiteError(details) {
        const admin = getAdminCredentials();
        const appVersion = await getEffectiveAppVersion();

        const payload = {
            type: 'site_error',
            domain: details.domain || '',
            url: details.url || '',
            reason: details.reason || 'Échec extraction',
            comment: details.comment || '',
            selector: details.selector || '',
            contentLength: details.contentLength || null,
            trace: details.trace || '',
            htmlSnippet: details.htmlSnippet || '',
            appVersion: appVersion,
            timestamp: new Date().toISOString()
        };

        // Si l'admin a renseigné ses identifiants locaux, envoi direct
        if (admin.token && admin.chatId) {
            let text = `⚠️ *Signalement d'article / site*\n\n` +
                         `🌐 *Domaine :* \`${payload.domain}\`\n` +
                         `🔗 *URL :* ${payload.url}\n` +
                         `❌ *Type :* ${payload.reason}\n` +
                         (payload.comment ? `💬 *Commentaire :* ${payload.comment}\n` : '') +
                         (payload.contentLength ? `📏 *Longueur :* ${payload.contentLength} car.\n` : '') +
                         `🎯 *Sélecteur :* \`${payload.selector || 'générique'}\`\n` +
                         `📱 *Version App :* ${payload.appVersion}`;

            if (payload.trace) {
                const cleanTrace = payload.trace.replace(/[`*_\\]/g, '').slice(0, 600);
                text += `\n\n📋 *Trace :*\n\`\`\`\n${cleanTrace}\n\`\`\``;
            }
            if (payload.htmlSnippet) {
                const cleanHtml = payload.htmlSnippet.replace(/[`*_\\]/g, '').slice(0, 700);
                text += `\n\n📄 *HTML :*\n\`\`\`html\n${cleanHtml}\n\`\`\``;
            }

            return await sendDirectToTelegram(admin.token, admin.chatId, text);
        }

        // Sinon, envoi via le relais
        return await sendViaRelay(payload);
    }

    /**
     * Propose une nouvelle règle de site testée et validée par l'utilisateur
     */
    async function submitRuleProposal(proposal) {
        const admin = getAdminCredentials();
        const appVersion = await getEffectiveAppVersion();

        const payload = {
            type: 'rule_proposal',
            domain: proposal.domain || '',
            contentSelector: proposal.contentSelector || '',
            paywallSelector: proposal.paywallSelector || '',
            testUrl: proposal.testUrl || '',
            extractedLength: proposal.extractedLength || 0,
            appVersion: appVersion,
            timestamp: new Date().toISOString()
        };

        if (admin.token && admin.chatId) {
            const text = `🚀 *Nouvelle règle proposée !*\n\n` +
                         `🌐 *Domaine :* \`${payload.domain}\`\n` +
                         `🎯 *Sélecteur :* \`${payload.contentSelector}\`\n` +
                         (payload.paywallSelector ? `🚫 *Paywall :* \`${payload.paywallSelector}\`\n` : '') +
                         `🔗 *URL testée :* ${payload.testUrl || 'N/A'}\n` +
                         `📏 *Longueur extraite :* ${payload.extractedLength} caractères\n` +
                         `📱 *Version App :* ${payload.appVersion}`;
            return await sendDirectToTelegram(admin.token, admin.chatId, text);
        }

        return await sendViaRelay(payload);
    }

    global.FeedbackService = {
        reportSiteError,
        submitRuleProposal,
        getRelayUrl,
        setRelayUrl,
        getAdminCredentials,
        setAdminCredentials
    };

})(window);
