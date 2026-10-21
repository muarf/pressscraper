const { findRuleForHost } = require('../bpc-service.js');

describe('BpcService.findRuleForHost', () => {
    const mockSites = {
        'Le Monde': { domain: 'lemonde.fr' },
        'Le Figaro': { group: ['lefigaro.fr', 'lefigaro.com'] },
        'Libération': { domain: 'liberation.fr', group: ['libe.fr'] },
        'Invalid Site': { invalid: 'test' },
        'Empty Group': { group: [] }
    };

    it('should return null when sites object is null or undefined', () => {
        expect(findRuleForHost('lemonde.fr', null)).toBeNull();
        expect(findRuleForHost('lemonde.fr', undefined)).toBeNull();
    });

    it('should return null when no matching rule is found', () => {
        expect(findRuleForHost('unknown.com', mockSites)).toBeNull();
    });

    it('should skip invalid site entries without crashing', () => {
        // "Invalid Site" has no domain or group
        expect(findRuleForHost('unknown.com', mockSites)).toBeNull();
    });

    describe('Domain Matching', () => {
        it('should match exact domain', () => {
            const rule = findRuleForHost('lemonde.fr', mockSites);
            expect(rule).toEqual({
                name: 'Le Monde',
                domain: 'lemonde.fr'
            });
        });

        it('should match subdomain of defined domain', () => {
            const rule = findRuleForHost('www.lemonde.fr', mockSites);
            expect(rule).toEqual({
                name: 'Le Monde',
                domain: 'lemonde.fr'
            });
        });

        it('should not match partial domain strings', () => {
            expect(findRuleForHost('fake-lemonde.fr', mockSites)).toBeNull();
        });
    });

    describe('Group Matching', () => {
        it('should match exact domain within a group', () => {
            const rule = findRuleForHost('lefigaro.fr', mockSites);
            expect(rule).toEqual({
                name: 'Le Figaro',
                group: ['lefigaro.fr', 'lefigaro.com'],
                domain: 'lefigaro.fr'
            });
        });

        it('should match subdomain of a domain within a group', () => {
            const rule = findRuleForHost('premium.lefigaro.com', mockSites);
            expect(rule).toEqual({
                name: 'Le Figaro',
                group: ['lefigaro.fr', 'lefigaro.com'],
                domain: 'lefigaro.com'
            });
        });

        it('should handle sites with both domain and group correctly', () => {
            // Match main domain
            expect(findRuleForHost('liberation.fr', mockSites)).toEqual({
                name: 'Libération',
                domain: 'liberation.fr',
                group: ['libe.fr']
            });

            // Match group domain
            expect(findRuleForHost('www.libe.fr', mockSites)).toEqual({
                name: 'Libération',
                domain: 'libe.fr',
                group: ['libe.fr']
            });
        });
    });
});
