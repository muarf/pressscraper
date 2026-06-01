(function(global) {
    'use strict';

    const GITHUB_REPO = 'muarf/pressscraper';
    const GITHUB_BETA_API = 'https://api.github.com/repos/' + GITHUB_REPO + '/releases?per_page=10';
    const APK_FILENAME = 'presscraper-*.apk';
    const CHECK_KEY = 'update_last_check';

    let updateState = {
        checking: false,
        available: null,
        latestVersion: '',
        downloadUrl: '',
        releaseUrl: ''
    };

    function parseVersion(versionStr) {
        if (!versionStr) return { major: 0, minor: 0, patch: 0, prerelease: null, prereleaseNum: 0 };
        const clean = versionStr.replace(/^v/, '');
        const match = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)\.(\d+))?$/);
        if (!match) return { major: 0, minor: 0, patch: 0, prerelease: null, prereleaseNum: 0 };
        return {
            major: parseInt(match[1], 10),
            minor: parseInt(match[2], 10),
            patch: parseInt(match[3], 10),
            prerelease: match[4] || null,
            prereleaseNum: match[5] ? parseInt(match[5], 10) : 0
        };
    }

    function isVersionNewer(currentStr, latestStr) {
        const c = parseVersion(currentStr);
        const l = parseVersion(latestStr);

        if (l.major !== c.major) return l.major > c.major;
        if (l.minor !== c.minor) return l.minor > c.minor;
        if (l.patch !== c.patch) return l.patch > c.patch;

        // If one is release and one is prerelease of same version: release is newer
        if (l.prerelease === null && c.prerelease !== null) return true;
        if (l.prerelease !== null && c.prerelease === null) return false;

        // If both are prerelease: compare their prerelease numbers
        if (l.prerelease !== null && c.prerelease !== null) {
            return l.prereleaseNum > c.prereleaseNum;
        }

        return false;
    }

    async function getCurrentVersion() {
        const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
        if (BnfLogin && typeof BnfLogin.getAppVersion === 'function') {
            try {
                const res = await BnfLogin.getAppVersion();
                if (res.versionName) {
                    return { name: res.versionName, code: res.versionCode };
                }
            } catch(e) {
                console.warn('[Updater] getAppVersion failed:', e);
            }
        }
        return { name: '0.0.0', code: 0 };
    }

    async function checkForBetaUpdates(force) {
        if (updateState.checking) return;
        if (!force) {
            const lastCheck = localStorage.getItem(CHECK_KEY);
            if (lastCheck && (Date.now() - parseInt(lastCheck)) < 86400000) {
                return;
            }
        }

        updateState.checking = true;
        try {
            const res = await fetch(GITHUB_BETA_API, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            if (!res.ok) return;
            const releases = await res.json();
            if (!Array.isArray(releases) || releases.length === 0) return;

            // Find the latest release with an APK asset (sorted by semver tag, not API order)
            const sortedReleases = releases
                .filter(r => r.assets && r.assets.some(a => a.name && a.name.endsWith('.apk')))
                .sort((a, b) => {
                    const aParts = (a.tag_name || '').replace(/^v/, '').split(/[.-]/).map(Number);
                    const bParts = (b.tag_name || '').replace(/^v/, '').split(/[.-]/).map(Number);
                    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                        const av = aParts[i] || 0, bv = bParts[i] || 0;
                        if (av !== bv) return bv - av; // descending (newest first)
                    }
                    return 0;
                });
            const latestRelease = sortedReleases[0];
            if (!latestRelease) return;

            const current = await getCurrentVersion();
            const latestTag = latestRelease.tag_name || '';
            updateState.latestVersion = latestTag;
            updateState.releaseUrl = latestRelease.html_url || '';

            const apkAsset = latestRelease.assets.find(a => a.name && a.name.endsWith('.apk'));
            if (apkAsset) {
                updateState.downloadUrl = apkAsset.browser_download_url;
            }

            updateState.available = isVersionNewer(current.name, latestTag);
            localStorage.setItem(CHECK_KEY, String(Date.now()));
        } catch(e) {
            console.warn('[Updater] Beta check failed:', e);
        } finally {
            updateState.checking = false;
        }
    }

    async function downloadAndInstall() {
        if (!updateState.downloadUrl) {
            throw new Error('Aucune URL de téléchargement disponible');
        }

        const BnfLogin = window.Capacitor?.Plugins?.BnfLogin;
        if (!BnfLogin || typeof BnfLogin.downloadApk !== 'function') {
            throw new Error('Fonction de téléchargement non disponible');
        }

        const dlRes = await BnfLogin.downloadApk({ url: updateState.downloadUrl });
        if (!dlRes || dlRes.error) {
            throw new Error(dlRes?.error || 'Échec du téléchargement');
        }

        if (BnfLogin && typeof BnfLogin.installApk === 'function') {
            await BnfLogin.installApk({ path: dlRes.path });
        }
    }

    global.Updater = {
        checkForBetaUpdates,
        downloadAndInstall,
        state: updateState
    };

})(window);
