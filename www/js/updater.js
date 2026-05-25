(function(global) {
    'use strict';

    const GITHUB_REPO = 'votrecompte/pressecraper';
    const GITHUB_API = 'https://api.github.com/repos/' + GITHUB_REPO + '/releases/latest';
    const APK_FILENAME = 'presse-scraper-update.apk';
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

    async function checkForUpdates(force) {
        if (updateState.checking) return;
        if (!force) {
            const lastCheck = localStorage.getItem(CHECK_KEY);
            if (lastCheck && (Date.now() - parseInt(lastCheck)) < 86400000) {
                return;
            }
        }

        updateState.checking = true;
        try {
            const res = await fetch(GITHUB_API, {
                headers: { 'Accept': 'application/vnd.github.v3+json' }
            });
            if (!res.ok) return;
            const data = await res.json();

            const latestTag = data.tag_name || '';
            const current = await getCurrentVersion();

            updateState.latestVersion = latestTag;
            updateState.releaseUrl = data.html_url || '';

            // Find APK asset
            if (data.assets && data.assets.length) {
                const apkAsset = data.assets.find(a => a.name && a.name.endsWith('.apk'));
                if (apkAsset) {
                    updateState.downloadUrl = apkAsset.browser_download_url;
                }
            }

            // Compare versions (tags like v1.2.3)
            const latestStr = latestTag.replace(/^v/, '');
            const currentStr = current.name.replace(/^v/, '');
            const latestParts = latestStr.split('.').map(Number);
            const currentParts = currentStr.split('.').map(Number);

            let isNewer = false;
            for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
                const l = latestParts[i] || 0;
                const c = currentParts[i] || 0;
                if (l > c) { isNewer = true; break; }
                if (l < c) break;
            }

            updateState.available = isNewer;

            localStorage.setItem(CHECK_KEY, String(Date.now()));

        } catch(e) {
            console.warn('[Updater] Check failed:', e);
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
        checkForUpdates,
        downloadAndInstall,
        state: updateState
    };

})(window);
