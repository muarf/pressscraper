#!/usr/bin/env python3
"""
scripts/audit_premium_sites.py
==============================
Outil d'audit automatisé des sites de presse sur Android via ADB.
1. Trouve un article VRAIMENT réservé aux abonnés (Premium / isAccessibleForFree=false).
2. L'envoie à l'application PressScraper via un Intent Android.
3. Surveille l'extraction BPC en temps réel via adb logcat.
4. Analyse le PDF généré pour certifier si l'article complet a été débloqué.
"""

import sys, os, time, re, subprocess, urllib.request
from bs4 import BeautifulSoup

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8'
}

# Sites francophones supportés par BPC non encore configurés dans PressScraper
TARGET_SITES = [
    ("lexpress.fr", "https://www.lexpress.fr", re.compile(r"-[A-Z0-9]{20,}")),
    ("latribune.fr", "https://www.latribune.fr/economie-2/", re.compile(r"/article/[a-z-]+/\d+/")),
    ("nouvelobs.com", "https://www.nouvelobs.com", re.compile(r"\.\w+\d+/.*\.html$")),
    ("telerama.fr", "https://www.telerama.fr", re.compile(r"-\d+\.php$")),
    ("capital.fr", "https://www.capital.fr", re.compile(r"-\d{6,}$")),
    ("parismatch.com", "https://www.parismatch.com", re.compile(r"-\d{6,}$")),
    ("franc-tireur.fr", "https://www.franc-tireur.fr", re.compile(r"^https://www\.franc-tireur\.fr/[a-z0-9-]+$")),
    ("lejdd.fr", "https://www.lejdd.fr", re.compile(r"-\d{6,}$")),
    ("sudouest.fr", "https://www.sudouest.fr", re.compile(r"-\d{7,}\.php$")),
    ("le1hebdo.fr", "https://le1hebdo.fr", re.compile(r"/article/"))
]

def find_premium_url(domain, base_url, pattern):
    """Recherche un article expressément identifié comme payant/réservé aux abonnés."""
    try:
        req = urllib.request.Request(base_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            soup = BeautifulSoup(resp.read(), 'html.parser')
    except Exception as e:
        print(f"  ❌ Impossible d'accéder à {base_url} : {e}")
        return None

    candidates = []
    for a in soup.find_all('a', href=True):
        href = a['href'].strip()
        if href.startswith('/'): href = base_url.rstrip('/') + href
        if domain in href and href not in candidates and pattern.search(href):
            if not re.search(r'(login|connexion|abonnement|services|mentions|newsletter|tag|auteur|rubrique|kiosque)', href, re.I):
                candidates.append(href)

    for url in candidates[:12]:
        try:
            c_req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(c_req, timeout=6) as c_resp:
                html = c_resp.read().decode('utf-8', errors='ignore')

            # Marqueurs Premium stricts
            has_schema_locked = bool(re.search(r'\"isAccessibleForFree\"\s*:\s*(false|\"false\")', html, re.I))
            has_paywall_container = bool(re.search(r'(id=\"paywall\"|class=\"[^\"]*paywall|poool-widget|article__premium--icon|paywall-container|qiota|datawall)', html, re.I))
            has_locked_text = any(t in html.lower() for t in ["réservé aux abonnés", "article réservé", "pour lire la suite", "abonnez-vous pour lire"])

            if has_schema_locked or (has_paywall_container and has_locked_text) or 'qiota' in html:
                return url
        except Exception:
            continue

    return None

def run_adb(cmd):
    return subprocess.run(f"adb {cmd}", shell=True, capture_output=True, text=True)

def get_latest_cached_pdf():
    res = run_adb("shell \"run-as io.qzz.pressecraper sh -c 'ls -t cache/art_*.pdf 2>/dev/null | head -n 1'\"").stdout.strip()
    return f"/data/user/0/io.qzz.pressecraper/{res}" if (res and res.endswith('.pdf')) else None

def test_article_on_device(url):
    """Envoie l'article à PressScraper via intent et analyse le résultat."""
    # Obtenir le dernier PDF avant test
    before_pdf = get_latest_cached_pdf()

    run_adb("shell am force-stop io.qzz.pressecraper")
    run_adb("logcat -c")
    send_cmd = f'shell am start -a android.intent.action.SEND -t text/plain -e android.intent.extra.TEXT "{url}" -n io.qzz.pressecraper/.MainActivity'
    run_adb(send_cmd)

    start_time = time.time()
    pdf_path = None
    bpc_fail = None

    while time.time() - start_time < 22:
        time.sleep(1.5)
        current_pdf = get_latest_cached_pdf()
        if current_pdf and current_pdf != before_pdf:
            pdf_path = current_pdf
            break

        log = run_adb("logcat -d").stdout
        if "Contenu protégé ou insuffisant" in log or "Aucune source n'a pu" in log:
            bpc_fail = "Paywall actif non franchi"
            break
        if "Challenge de sécurité détecté" in log or "dd-client-challenge" in log:
            bpc_fail = "Challenge Anti-bot (Cloudflare/DataDome)"
            break

    if pdf_path:
        tmp_pdf = f"/tmp/audit_{int(time.time())}.pdf"
        run_adb(f"exec-out run-as io.qzz.pressecraper cat {pdf_path} > {tmp_pdf}")
        text_out = subprocess.run(f"pdftotext {tmp_pdf} -", shell=True, capture_output=True, text=True).stdout
        if os.path.exists(tmp_pdf): os.remove(tmp_pdf)

        char_count = len(text_out.strip())
        paragraphs = len([p for p in text_out.split('\n\n') if len(p.strip()) > 80])

        if char_count >= 1000 and paragraphs >= 2:
            return "SUCCESS", f"{char_count} car. ({paragraphs} paragraphes)", url
        else:
            return "PARTIAL", f"Teaser seulement ({char_count} car.)", url
    elif bpc_fail:
        return "BLOCKED", bpc_fail, url
    else:
        return "TIMEOUT", "Timeout (délai dépassé)", url

def main():
    print("=" * 70)
    print(" 📰 AUDIT DES SITES FRANÇAIS BPC — ARTICLES PREMIUM UNIQUEMENT")
    print("=" * 70)

    # Vérifier connexion ADB
    devices = run_adb("devices").stdout
    if "device\n" not in devices:
        print("❌ Aucun téléphone détecté via ADB. Assurez-vous qu'il est connecté et autorisé.")
        sys.exit(1)

    results = []

    for domain, base_url, pattern in TARGET_SITES:
        print(f"\n🔍 Analyse de [{domain}]...")
        url = find_premium_url(domain, base_url, pattern)
        if not url:
            print(f"  ⚪ Aucun article Premium vérifié trouvé.")
            results.append((domain, "⚪ NON TESTÉ", "Pas d'article premium trouvé", "N/A"))
            continue

        print(f"  🎯 Article Premium trouvé : {url}")
        print(f"  📱 Test sur le téléphone...")
        status, details, tested_url = test_article_on_device(url)

        if status == "SUCCESS":
            icon = "🟢 SUCCÈS"
        elif status == "PARTIAL":
            icon = "🟡 PARTIEL"
        elif status == "BLOCKED":
            icon = "🔴 BLOQUÉ"
        else:
            icon = "⚠️ TIMEOUT"

        print(f"  {icon} : {details}")
        results.append((domain, icon, details, tested_url))

    print("\n" + "=" * 70)
    print(" 📊 TABLEAU DE SYNTHÈSE DE L'AUDIT")
    print("=" * 70)
    print(f"{'Domaine':<30} | {'Statut':<12} | {'Détails'}")
    print("-" * 70)
    for dom, st, det, _ in results:
        print(f"{dom:<30} | {st:<12} | {det}")
    print("=" * 70)

if __name__ == '__main__':
    main()
