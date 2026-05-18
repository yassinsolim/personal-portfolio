const target = process.argv[2] || 'https://yassin.app';
const baseUrl = new URL(target);

const requiredHeaders = [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
    'x-frame-options',
];

const requiredMeta = [
    ['title', /<title>[^<]+<\/title>/i],
    ['description', /<meta\s+name=["']description["']\s+content=["'][^"']+["']/i],
    ['canonical', /<link\s+rel=["']canonical["']\s+href=["']https:\/\/yassin\.app\/["']/i],
    ['og:type', /<meta\s+property=["']og:type["']\s+content=["']website["']/i],
    ['og:url', /<meta\s+property=["']og:url["']\s+content=["']https:\/\/yassin\.app\/["']/i],
    ['og:title', /<meta\s+property=["']og:title["']\s+content=["'][^"']+["']/i],
    ['og:description', /<meta\s+property=["']og:description["']\s+content=["'][^"']+["']/i],
    ['og:image', /<meta\s+property=["']og:image["']\s+content=["']https:\/\/[^"']+["']/i],
    ['twitter:card', /<meta\s+(?:name|property)=["']twitter:card["']\s+content=["']summary_large_image["']/i],
    ['twitter:title', /<meta\s+(?:name|property)=["']twitter:title["']\s+content=["'][^"']+["']/i],
    ['twitter:description', /<meta\s+(?:name|property)=["']twitter:description["']\s+content=["'][^"']+["']/i],
    ['twitter:image', /<meta\s+(?:name|property)=["']twitter:image["']\s+content=["']https:\/\/[^"']+["']/i],
];

const riskyBundlePatterns = [
    'signInWithSolana',
    'signInWithEthereum',
    '@supabase',
    'supabase.auth',
    'persistSession',
    'RealtimeClient',
    'WebSocket',
    'new Function',
    'eval(',
    'document.write',
    'atob(',
    'btoa(',
];

let failures = 0;
let warnings = 0;

const fail = (message) => {
    failures += 1;
    console.error(`FAIL ${message}`);
};

const warn = (message) => {
    warnings += 1;
    console.warn(`WARN ${message}`);
};

const ok = (message) => {
    console.log(`OK   ${message}`);
};

const fetchText = async (url) => {
    const response = await fetch(url, { redirect: 'follow' });
    const text = await response.text();
    return { response, text };
};

const resolveUrl = (value) => new URL(value, baseUrl).toString();

const headerResponse = await fetch(baseUrl, {
    method: 'GET',
    redirect: 'follow',
});
const html = await headerResponse.text();

console.log(`Checked URL: ${headerResponse.url}`);
console.log('\nResponse headers:');
for (const [key, value] of headerResponse.headers.entries()) {
    console.log(`${key}: ${value}`);
}
console.log('');

for (const header of requiredHeaders) {
    const value = headerResponse.headers.get(header);
    if (!value) {
        fail(`Missing required header: ${header}`);
    } else {
        ok(`Header present: ${header}`);
    }
}

const csp = headerResponse.headers.get('content-security-policy') || '';
if (csp) {
    const broadSourcePattern = /(?:^|[\s;])(?:http:|https:|ws:|wss:)(?=$|[\s;])/i;
    if (broadSourcePattern.test(csp)) {
        fail('CSP contains a broad protocol source such as http:, https:, ws:, or wss:');
    } else {
        ok('CSP avoids broad protocol source allowances');
    }
    for (const directive of ['default-src', 'object-src', 'script-src', 'connect-src', 'frame-ancestors']) {
        if (!new RegExp(`(?:^|;)\\s*${directive}\\b`).test(csp)) {
            fail(`CSP missing directive: ${directive}`);
        }
    }
}

if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
    fail('HTML still contains a meta CSP; use response headers only');
} else {
    ok('No duplicate meta CSP in HTML');
}

for (const [name, pattern] of requiredMeta) {
    if (!pattern.test(html)) {
        fail(`Missing or invalid metadata: ${name}`);
    } else {
        ok(`Metadata present: ${name}`);
    }
}

if (/<meta\s+(?:name|http-equiv)=["']robots["'][^>]*noindex/i.test(html)) {
    fail('Homepage contains noindex metadata');
} else {
    ok('No noindex metadata found');
}

const externalScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((src) => {
        const scriptUrl = new URL(src, baseUrl);
        return scriptUrl.origin !== baseUrl.origin;
    });
if (externalScripts.length) {
    fail(`Unexpected external scripts: ${externalScripts.join(', ')}`);
} else {
    ok('No unexpected external scripts');
}

const iframes = [...html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
const unexpectedIframes = iframes.filter((src) => new URL(src, baseUrl).origin !== 'https://os.yassin.app');
if (unexpectedIframes.length) {
    fail(`Unexpected iframe sources: ${unexpectedIframes.join(', ')}`);
} else {
    ok('No unexpected static iframes');
}

const targetBlankLinks = [...html.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)].map((match) => match[0]);
for (const link of targetBlankLinks) {
    if (!/\brel=["'][^"']*\bnoopener\b[^"']*\bnoreferrer\b[^"']*["']/i.test(link)) {
        fail(`target="_blank" link missing noopener noreferrer: ${link}`);
    }
}

const imageMatch =
    html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
    html.match(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i);
if (imageMatch) {
    const imageUrl = imageMatch[1];
    const imageResponse = await fetch(imageUrl, { redirect: 'follow' });
    const imageType = imageResponse.headers.get('content-type') || '';
    if (!imageResponse.ok) {
        fail(`Social image did not return 200: ${imageUrl} (${imageResponse.status})`);
    } else if (!/^image\/(png|jpeg)/i.test(imageType)) {
        fail(`Social image has unexpected content-type: ${imageType}`);
    } else {
        ok(`Social image is reachable: ${imageUrl}`);
    }
}

const robotsUrl = resolveUrl('/robots.txt');
const sitemapUrl = resolveUrl('/sitemap.xml');
const [robots, sitemap] = await Promise.allSettled([
    fetchText(robotsUrl),
    fetchText(sitemapUrl),
]);
if (robots.status === 'fulfilled' && robots.value.response.ok && /Allow:\s*\//i.test(robots.value.text)) {
    ok('robots.txt allows normal crawling');
} else {
    fail('robots.txt missing or not crawler-friendly');
}
if (sitemap.status === 'fulfilled' && sitemap.value.response.ok && /https:\/\/yassin\.app\//i.test(sitemap.value.text)) {
    ok('sitemap.xml contains canonical homepage URL');
} else {
    fail('sitemap.xml missing or invalid');
}

const localScriptMatches = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js[^"']*)["'][^>]*>/gi)]
    .map((match) => match[1])
    .filter((src) => new URL(src, baseUrl).origin === baseUrl.origin);
const mainScript = localScriptMatches.find((src) => /bundle\./.test(src)) || localScriptMatches[0];
if (mainScript) {
    const bundleUrl = resolveUrl(mainScript);
    const { response, text } = await fetchText(bundleUrl);
    if (!response.ok) {
        fail(`Could not download main JS bundle: ${bundleUrl}`);
    } else {
        ok(`Downloaded main JS bundle: ${bundleUrl}`);
        for (const pattern of riskyBundlePatterns) {
            const count = text.split(pattern).length - 1;
            if (count > 0) {
                if (['@supabase', 'signInWithSolana', 'signInWithEthereum', 'supabase.auth', 'RealtimeClient'].includes(pattern)) {
                    fail(`Main JS bundle contains risky auth/realtime marker "${pattern}" (${count})`);
                } else {
                    warn(`Main JS bundle contains "${pattern}" (${count})`);
                }
            }
        }
    }
} else {
    warn('No local JS bundle found in homepage HTML');
}

console.log(`\nSecurity check complete: ${failures} failure(s), ${warnings} warning(s).`);
if (failures > 0) {
    process.exit(1);
}
