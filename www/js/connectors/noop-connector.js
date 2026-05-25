(function(global) {
    'use strict';

    const NoopConnector = {
        id: 'noop',
        name: 'Aucune authentification',
        description: 'Accès direct sans authentification (Bypass Paywall)',

        configFields: [],

        isReady() {
            return true;
        },

        isExpired() {
            return false;
        },

        async getAuthHeaders() {
            return {};
        }
    };

    global.NoopConnector = NoopConnector;

})(window);
