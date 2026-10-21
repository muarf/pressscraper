/**
 * scraper.js — Scraper facade (delegates to Orchestrator and BpcService)
 */
(function(global) {
    'use strict';

    global.Scraper = {
        lastQuery: null,
        initBpc: async function() {
            if (global.BpcService && typeof global.BpcService.reinit === 'function') {
                await global.BpcService.reinit();
            }
        },
        scrapeArticle: async function(titleOrUrl, fallbackTitle, state, onProgress) {
            if (global.Orchestrator && typeof global.Orchestrator.scrapeArticle === 'function') {
                return await global.Orchestrator.scrapeArticle(titleOrUrl, fallbackTitle, state, onProgress);
            }
            throw new Error("Orchestrateur de scraping non disponible.");
        }
    };
})(typeof window !== 'undefined' ? window : global);
