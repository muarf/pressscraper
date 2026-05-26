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

            // Find the latest prerelease with an APK asset
            const beta = releases.find(r =>
                r.prerelease && r.assets && r.assets.some(a => a.name && a.name.endsWith('.apk'))
            );
            if (!beta) return;

            const current = await getCurrentVersion();
            const latestTag = beta.tag_name || '';
            updateState.latestVersion = latestTag;
            updateState.releaseUrl = beta.html_url || '';

            const apkAsset = beta.assets.find(a => a.name && a.name.endsWith('.apk'));
            if (apkAsset) {
                updateState.downloadUrl = apkAsset.browser_download_url;
            }

            // Skip if this exact tag was already installed (avoids re-prompt loop)
            const installedTag = localStorage.getItem('update_installed_tag');
            if (installedTag === latestTag) {
                updateState.available = false;
                localStorage.setItem(CHECK_KEY, String(Date.now()));
                return;
            }

            // Compare major.minor.patch
            const latestParts = latestTag.replace(/^v/, '').split(/[.-]/).map(Number);
            const currentParts = current.name.replace(/^v/, '').split(/[.-]/).map(Number);

            let isNewer = false;
            for (let i = 0; i < 3; i++) {
                const l = latestParts[i] || 0;
                const c = currentParts[i] || 0;
                if (l > c) { isNewer = true; break; }
                if (l < c) break;
            }
            // If major.minor.patch are equal, a prerelease tag is an update
            // (the localStorage installedTag check prevents re-prompt loops)
            if (!isNewer && latestTag.includes('-')) {
                isNewer = true;
            }

            updateState.available = isNewer;
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

    function markBetaInstalled() {
        if (updateState.latestVersion) {
            localStorage.setItem('update_installed_tag', updateState.latestVersion);
        }
    }

    global.Updater = {
        checkForBetaUpdates,
        downloadAndInstall,
        markBetaInstalled,
        state: updateState
    };

})(window);
