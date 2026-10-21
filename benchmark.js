const parser = {
    parseFromString: (html, type) => {
        return {
            querySelectorAll: () => {
                return [
                    {
                        querySelector: (selector) => {
                            if (selector === '.docList-links') return { textContent: 'Mock Title' };
                            if (selector === 'input[id="doc-name"]') return { value: '123' };
                            if (selector === '.source-name') return { textContent: 'Mock Source' };
                            return null;
                        }
                    }
                ]
            }
        };
    }
};

function calculateSimilarity(a, b) {
    return 50; // maxSim will be 50, so it will not break early
}

const cookieHeader = 'cookie';
const UA = 'ua';
const EUROPRESSE_DOMAIN = 'example.com';
const articleTitle = 'Test';

async function runSequential() {
    let BnfLogin = {
        httpRequest: async () => {
            return new Promise(resolve => setTimeout(() => resolve({ data: '<html></html>' }), 100));
        }
    };

    let bestMatch = null;
    let maxSim = 0;

    const start = Date.now();
    for (let page = 0; page < 2; page++) {
        const listRes = await BnfLogin.httpRequest({
            url: `https://${EUROPRESSE_DOMAIN}/Search/GetPage?pageNo=${page}&docPerPage=50`,
            method: 'GET',
            headers: { 'Cookie': cookieHeader, 'User-Agent': UA }
        });

        if (!listRes.data || !listRes.data.trim()) break;

        const listDoc = parser.parseFromString(listRes.data, 'text/html');
        const items = listDoc.querySelectorAll('.docListItem');
        if (!items || items.length === 0) break;

        items.forEach(item => {
            const titleLink = item.querySelector('.docList-links');
            const docTitle = titleLink ? titleLink.textContent.trim() : '';
            const docId = item.querySelector('input[id="doc-name"]')?.value;
            const sourceName = item.querySelector('.source-name')?.textContent.trim() || '';

            if (docId && docTitle) {
                const sim = calculateSimilarity(articleTitle, docTitle);
                if (sim > maxSim) {
                    maxSim = sim;
                    bestMatch = { id: docId, title: docTitle, source: sourceName };
                }
            }
        });

        if (maxSim >= 80) break;
    }
    const end = Date.now();
    return end - start;
}

async function runConcurrent() {
    let BnfLogin = {
        httpRequest: async () => {
            return new Promise(resolve => setTimeout(() => resolve({ data: '<html></html>' }), 100));
        }
    };

    let bestMatch = null;
    let maxSim = 0;

    const start = Date.now();
    const pagePromises = [];
    for (let page = 0; page < 2; page++) {
        pagePromises.push(BnfLogin.httpRequest({
            url: `https://${EUROPRESSE_DOMAIN}/Search/GetPage?pageNo=${page}&docPerPage=50`,
            method: 'GET',
            headers: { 'Cookie': cookieHeader, 'User-Agent': UA }
        }));
    }

    const pageResults = await Promise.all(pagePromises);

    for (let page = 0; page < 2; page++) {
        const listRes = pageResults[page];

        if (!listRes.data || !listRes.data.trim()) break;

        const listDoc = parser.parseFromString(listRes.data, 'text/html');
        const items = listDoc.querySelectorAll('.docListItem');
        if (!items || items.length === 0) break;

        items.forEach(item => {
            const titleLink = item.querySelector('.docList-links');
            const docTitle = titleLink ? titleLink.textContent.trim() : '';
            const docId = item.querySelector('input[id="doc-name"]')?.value;
            const sourceName = item.querySelector('.source-name')?.textContent.trim() || '';

            if (docId && docTitle) {
                const sim = calculateSimilarity(articleTitle, docTitle);
                if (sim > maxSim) {
                    maxSim = sim;
                    bestMatch = { id: docId, title: docTitle, source: sourceName };
                }
            }
        });

        if (maxSim >= 80) break;
    }
    const end = Date.now();
    return end - start;
}

async function run() {
    let seqSum = 0;
    for (let i=0; i<10; i++) {
        seqSum += await runSequential();
    }
    console.log(`Sequential average: ${seqSum/10}ms`);

    let conSum = 0;
    for (let i=0; i<10; i++) {
        conSum += await runConcurrent();
    }
    console.log(`Concurrent average: ${conSum/10}ms`);
}
run();
