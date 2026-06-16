(function(global) {
    'use strict';

    var SITE_CONFIG = {

        paywallSelector: 'div[id*="paywall"], section[class*="paywall"], div[class*="paywall"], #poool-widget, meta[name="premium"][content="true"], div.post-subscribe, div.post__content--faded',

        contentSelectorOverrides: {
            'atlantico.fr': '.paywalled-content'
        },

        bnfProxySites: [
            {
                domains: ['mediapart.fr', 'www.mediapart.fr'],
                proxyHost: 'www-mediapart-fr.bnf.idm.oclc.org',
                name: 'Mediapart',
                contentSelector: '.paywall-restricted-content, .news__body__center__article, .content-article, .article__content, [data-module="article-body"], .article-body',
                paywallSelector: '#paywall, .paywall, .register-wall, .subscribe'
            },
            {
                domains: ['arretsurimages.net', 'www.arretsurimages.net'],
                proxyHost: 'www-arretsurimages-net.bnf.idm.oclc.org',
                name: 'Arrêt sur Images',
                contentSelector: '.page-content, .article-content, .entry-content, .post-content, article .content, [class*="article-body"]',
                paywallSelector: '.paywall-block.paywall-callToAction, .paywall, #paywall, .subscribe-wall'
            }
        ]

    };

    global.SITE_CONFIG = SITE_CONFIG;

})(typeof window !== 'undefined' ? window : global);
