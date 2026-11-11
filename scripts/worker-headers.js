const productionHeaders = require('../site.json').headers;

module.exports = (pathname, rules = productionHeaders) => {
    let source;
    if (pathname === '/basis/ktx2-worker.js') source = '/basis/ktx2-worker.js';
    else if (pathname.startsWith('/draco/')) source = '/draco/(.*)';
    else if (pathname.startsWith('/handheld/')) source = '/handheld/(.*)';
    else return {};

    const rule = rules.find((entry) => entry.source === source);
    if (!rule) throw new Error(`Missing worker response policy: ${source}`);
    return Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
};
