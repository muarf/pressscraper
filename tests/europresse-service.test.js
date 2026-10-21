require('../www/js/services/europresse-service.js');

describe('EuropresseService.processTitleToQuery', () => {
    let processTitleToQuery;

    beforeAll(() => {
        processTitleToQuery = global.EuropresseService.processTitleToQuery;
    });

    test('should return null for empty or null input', () => {
        expect(processTitleToQuery(null)).toBeNull();
        expect(processTitleToQuery('')).toBeNull();
        expect(processTitleToQuery(undefined)).toBeNull();
    });

    test('should return null if only stopwords are present', () => {
        expect(processTitleToQuery('Le et la de du')).toBeNull();
    });

    test('should remove section prefixes', () => {
        expect(processTitleToQuery('En direct - Le président parle')).toBe('président parle');
        expect(processTitleToQuery('Vidéo | Les images du crash')).toBe('images crash');
        expect(processTitleToQuery('Podcast - Écoutez notre émission')).toBe('écoutez émission');
    });

    test('should remove french stopwords and special characters', () => {
        expect(processTitleToQuery('Le chat et la souris dans le jardin')).toBe('chat souris jardin');
    });

    test('should handle extremely long titles', () => {
        const longTitle = 'a '.repeat(1000) + 'motclé';
        expect(processTitleToQuery(longTitle)).toBe('motclé');
    });

    test('should replace special quotes and punctuation', () => {
        expect(processTitleToQuery('L\'"article" de l’année !')).toBe('article année');
        expect(processTitleToQuery('« Bonjour » disait-il')).toBe('bonjour disait');
    });

    test('should replace ligatures correctly', () => {
        expect(processTitleToQuery('Le cœur, la sœur et l\'œuvre')).toBe('coeur soeur oeuvre');
        expect(processTitleToQuery('Lætitia et les curriculum vitæ')).toBe('laetitia curriculum vitae');
    });

    test('should deduplicate words', () => {
        expect(processTitleToQuery('mot mot mot nouveau')).toBe('mot nouveau');
    });

    test('should handle emojis and other non-alphanumeric unicode', () => {
        // Words less than 2 letters or stopwords are ignored, emojis are stripped by `[^\p{L}\d]`
        expect(processTitleToQuery('🚀 Super titre 🔥 avec emojis ✨')).toBe('super titre emojis');
    });
});
