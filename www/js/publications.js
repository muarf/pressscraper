(function(global) {
    'use strict';

    const DOMAIN_MAPPINGS = {
        'lemonde.fr': ['monde'],
        'lefigaro.fr': ['figaro'],
        'liberation.fr': ['liberation', 'libération'],
        'la-croix.com': ['croix'],
        'lepoint.fr': ['point'],
        'leparisien.fr': ['parisien'],
        'lesoir.be': ['soir'],
        'marianne.net': ['marianne'],
        'courrierinternational.com': ['courrier'],
        'letemps.ch': ['temps'],
        'lexpress.fr': ['express', "l'express"]
    };

    function getKeywordsForUrl(url) {
        if (!url || !url.startsWith('http')) return null;
        try {
            const hostname = new URL(url).hostname.toLowerCase();
            for (const domain in DOMAIN_MAPPINGS) {
                if (hostname === domain || hostname.endsWith('.' + domain)) {
                    return DOMAIN_MAPPINGS[domain];
                }
            }
        } catch (e) {}
        return null;
    }

    global.PublicationMapping = {
        mappings: DOMAIN_MAPPINGS,
        getKeywordsForUrl
    };
})(window);
