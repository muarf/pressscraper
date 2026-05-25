(function(global) {
    'use strict';

    const GPSEAConnector = {
        id: 'gpsea',
        name: 'GPSEA (Sud Est Avignon)',
        description: 'Connexion via le portail GPSEA pour Cafeyn',

        nativePlugin: 'CafeynLogin',

        configFields: [
            { key: 'cafeynUsername', label: 'Identifiant GPSEA', type: 'text', required: false },
            { key: 'cafeynPassword', label: 'Mot de passe GPSEA', type: 'password', required: false },
            { key: 'cafeynJwt', label: 'Token JWT Cafeyn (optionnel si identifiants GPSEA)', type: 'text', required: false }
        ],

        isReady(state) {
            if (window.Cafeyn && window.Cafeyn.isTokenValid()) return true;
            return !!(state.cafeynJwt);
        },

        isExpired() {
            if (window.Cafeyn && window.Cafeyn.isTokenValid()) return false;
            return true;
        },

        async getAuthHeaders() {
            if (window.Cafeyn && window.Cafeyn.isTokenValid()) {
                return { 'Authorization': 'Bearer ' + window.Cafeyn.state.token };
            }
            return null;
        },

        async login(username, password) {
            const plugin = window.Capacitor?.Plugins?.CafeynLogin;
            if (!plugin) throw new Error('Plugin CafeynLogin non disponible');
            const result = await plugin.login({ username, password });
            if (!result.success) throw new Error(result.error || 'Échec de connexion GPSEA');
            if (result.jwt) {
                if (window.Cafeyn) await window.Cafeyn.saveToken(result.jwt);
                if (window.CafeynService) window.CafeynService.saveToken(result.jwt);
            }
            return result;
        },

        async setToken(token) {
            if (!token || !token.startsWith('eyJ')) {
                throw new Error('Token JWT invalide');
            }
            if (window.Cafeyn) await window.Cafeyn.saveToken(token);
            if (window.CafeynService) window.CafeynService.saveToken(token);
            return { success: true, jwt: token };
        },

        async refresh(state) {
            if (state.cafeynJwt) {
                if (window.Cafeyn) await window.Cafeyn.saveToken(state.cafeynJwt);
                if (window.CafeynService) window.CafeynService.saveToken(state.cafeynJwt);
                return { cafeynJwt: state.cafeynJwt };
            }
            if (state.cafeynUsername && state.cafeynPassword) {
                return await this.login(state.cafeynUsername, state.cafeynPassword);
            }
            throw new Error('Aucun moyen de rafraîchir la session Cafeyn');
        }
    };

    global.GPSEAConnector = GPSEAConnector;

})(window);
