(function(global) {
    'use strict';

    /**
     * Registry of all (connector, service) pairs available in Presse Scraper.
     *
     * Each entry defines:
     *   - id:        unique pair identifier (used for ordering, toggling)
     *   - name:      display label in UI
     *   - connector: reference to a Connector module (or null for no auth)
     *   - service:   reference to a Service module
     *
     * Adding a new pair (e.g. "Université de Rennes → Europresse") is as simple
     * as adding a new entry here with the appropriate connector.
     */
    const REGISTRY = [
        {
            id: 'bpc',
            name: 'Bypass Paywall (direct)',
            connector: 'noop',
            service: 'bpc'
        },
        {
            id: 'pressreader',
            name: 'PressReader',
            connector: 'toulouse-metropole',
            service: 'pressreader'
        },
        {
            id: 'cafeyn',
            name: 'Cafeyn',
            connector: 'gpsea',
            service: 'cafeyn'
        },
        {
            id: 'bnf',
            name: 'BnF Europresse',
            connector: 'bnf',
            service: 'europresse'
        },
        {
            id: 'bnf-proxy',
            name: 'BnF Proxy (Mediapart, Arrêt sur Images)',
            connector: 'bnf',
            service: 'bnf-proxy'
        }
    ];

    /**
     * Resolve a connector ID to the actual connector module.
     */
    function resolveConnector(id) {
        if (!id) return null;
        const map = {
            'bnf': global.BnfConnector,
            'gpsea': global.GPSEAConnector,
            'toulouse-metropole': global.ToulouseConnector,
            'noop': global.NoopConnector
        };
        return map[id] || null;
    }

    /**
     * Resolve a service ID to the actual service module.
     */
    function resolveService(id) {
        const map = {
            'europresse': global.EuropresseService,
            'bnf-proxy': global.BnfProxyService,
            'pressreader': global.PressReaderService,
            'cafeyn': global.CafeynService,
            'bpc': global.BpcService
        };
        return map[id] || null;
    }

    /**
     * Returns a flat list of { id, name, connector, service } where
     * connector and service are resolved to module objects.
     */
    function getPairs() {
        return REGISTRY.map(entry => ({
            id: entry.id,
            name: entry.name,
            connector: resolveConnector(entry.connector),
            service: resolveService(entry.service)
        })).filter(p => p.service != null);
    }

    /**
     * Returns a specific pair by ID.
     */
    function getPair(id) {
        const entry = REGISTRY.find(e => e.id === id);
        if (!entry) return null;
        return {
            id: entry.id,
            name: entry.name,
            connector: resolveConnector(entry.connector),
            service: resolveService(entry.service)
        };
    }

    // API Registry exposed globally
    global.Registry = {
        getPairs,
        getPair,
        list: REGISTRY
    };

})(window);
