(function(global) {
    'use strict';

    const BnfConnector = {
        id: 'bnf',
        name: 'Bibliothèque nationale de France',
        description: 'Connexion via EZProxy BnF pour Europresse et sites partenaires',

        nativePlugin: 'BnfLogin',

        configFields: [
            { key: 'bnfUsername', label: 'Identifiant BnF', type: 'text', required: true },
            { key: 'bnfPassword', label: 'Mot de passe BnF', type: 'password', required: true }
        ],

        isReady(state) {
            return !!(state.bnfCookiesHeader || state.bnfUsername);
        },

        isExpired(state) {
            if (!state.bnfCookiesExpiry) return true;
            return Date.now() >= (state.bnfCookiesExpiry - 300000);
        },

        async getAuthHeaders(state) {
            if (state.bnfCookiesHeader) {
                return { 'Cookie': state.bnfCookiesHeader };
            }
            return null;
        },

        async login(username, password) {
            const plugin = window.Capacitor?.Plugins?.BnfLogin;
            if (!plugin) throw new Error('Plugin BnfLogin non disponible');
            const result = await plugin.login({ username, password });
            if (!result.success) throw new Error(result.error || 'Échec de connexion BnF');
            return result;
        },

        async refresh(state) {
            if (!state.bnfUsername || !state.bnfPassword) {
                throw new Error('Identifiants BnF manquants');
            }
            const result = await this.login(state.bnfUsername, state.bnfPassword);
            return {
                bnfCookies: result.cookies,
                bnfCookiesHeader: result.cookieHeader || '',
                bnfCookiesExpiry: Date.now() + (8 * 60 * 60 * 1000)
            };
        }
    };

    global.BnfConnector = BnfConnector;

})(window);
