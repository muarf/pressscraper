(function(global) {
    'use strict';

    const DEFAULT_REFERER = 'https://mabm.toulouse-metropole.fr/default/presse.aspx?_lg=fr-FR';

    const ToulouseConnector = {
        id: 'toulouse-metropole',
        name: 'Toulouse Métropole',
        description: 'Accès PressReader via le hotspot de la médiathèque Toulouse Métropole',

        configFields: [
            { key: 'pressReaderReferer', label: 'URL référent bibliothèque', type: 'url', required: true }
        ],

        getReferer(state) {
            return state.pressReaderReferer || DEFAULT_REFERER;
        },

        isReady(state) {
            return !!(state.pressReaderReferer);
        },

        isExpired() {
            return false;
        },

        async getAuthHeaders(state) {
            return { 'Referer': this.getReferer(state) };
        },

        async refresh(state) {
            return { pressReaderReferer: this.getReferer(state) };
        }
    };

    global.ToulouseConnector = ToulouseConnector;

})(window);
