self.onmessage = function(e) {
    try {
        const sitesData = e.data.sitesData;
        const chromeStub = { runtime: { getManifest: () => ({ key: 'dummy' }) } };
        const evalSites = new Function('chrome', 'browser', sitesData + '; return defaultSites;');
        const bpcSites = evalSites(chromeStub, chromeStub);
        self.postMessage({ success: true, sites: bpcSites });
    } catch(err) {
        self.postMessage({ success: false, error: err.message });
    }
};
