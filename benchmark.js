const fs = require('fs');
const js = fs.readFileSync('www/js/services/bpc-service.js', 'utf8');

// We need to inject our benchmark into the file to have access to the internals, or just extract them.
// Let's create a mocked version of bpcSites with 1000 items.

let bpcSites = {};
for (let i = 0; i < 1000; i++) {
    bpcSites[`Site${i}`] = { domain: `domain${i}.com` };
}
bpcSites['TargetSite'] = { domain: 'target.com' };

function findSiteConfigOld(hostname) {
    if (!bpcSites) return null;
    for (const key in bpcSites) {
        const site = bpcSites[key];
        if (!site || (!site.domain && !site.group)) continue;
        if (site.domain && (hostname === site.domain || hostname.endsWith('.' + site.domain))) {
            return { name: key, ...site };
        }
        if (site.group && Array.isArray(site.group)) {
            for (const domain of site.group) {
                if (hostname === domain || hostname.endsWith('.' + domain)) {
                    return { name: key, ...site, domain };
                }
            }
        }
    }
    return null;
}

let bpcSitesMap = new Map();
function buildSiteMap() {
    bpcSitesMap.clear();
    for (const key in bpcSites) {
        const site = bpcSites[key];
        if (!site || (!site.domain && !site.group)) continue;
        if (site.domain) {
            bpcSitesMap.set(site.domain, { name: key, ...site });
        }
        if (site.group && Array.isArray(site.group)) {
            for (const domain of site.group) {
                bpcSitesMap.set(domain, { name: key, ...site, domain });
            }
        }
    }
}

function findSiteConfigNew(hostname) {
    if (!bpcSitesMap) return null;

    let parts = hostname.split('.');
    while (parts.length >= 1) {
        let current = parts.join('.');
        if (bpcSitesMap.has(current)) {
            return bpcSitesMap.get(current);
        }
        parts.shift();
    }
    return null;
}

buildSiteMap();

const ITERS = 100000;
console.time("Old");
for (let i = 0; i < ITERS; i++) {
    findSiteConfigOld("sub.target.com");
    findSiteConfigOld("notfound.com");
}
console.timeEnd("Old");

console.time("New");
for (let i = 0; i < ITERS; i++) {
    findSiteConfigNew("sub.target.com");
    findSiteConfigNew("notfound.com");
}
console.timeEnd("New");
