// third party 3d models, for the race menu credits. CREDITS.md has the same
// list with more detail; keep the two in step

export type ModelLicense = {
    label: string;
    url: string;
    shareAlike: boolean;
};

export type ModelCredit = {
    // what the site calls it
    usedFor: string;
    title: string;
    author: string;
    authorUrl: string;
    // null when the original download couldn't be traced
    sourceUrl: string | null;
    license: ModelLicense | null;
    changes: string;
};

const CC_BY = {
    label: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
    shareAlike: false,
};
const CC_BY_NC = {
    label: 'CC BY-NC 4.0',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
    shareAlike: false,
};
const CC_BY_NC_SA = {
    label: 'CC BY-NC-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    shareAlike: true,
};

// what the build does to every car (scripts/optimize-models.mjs,
// scripts/build-ktx2-cars.mjs) and what the garage does at runtime
const WEB = 'textures resized to 1024 px and converted to WebP, geometry welded and Draco compressed';
const LITE = 'a low detail version (simplified geometry, 512 px textures)';
const KTX2_MERGED = 'a KTX2 texture version with merged meshes';
const KTX2 = 'a KTX2 texture version';
const GARAGE = 'the paint and wheels can be changed in the garage';

const DDIAZ = {
    author: 'Ddiaz Design',
    authorUrl: 'https://sketchfab.com/ddiaz-design',
};
const BLACK_SNOW = {
    author: 'Black Snow',
    authorUrl: 'https://sketchfab.com/BlackSnow02',
};

export const MODEL_CREDITS: ModelCredit[] = [
    {
        usedFor: 'Mercedes-AMG One',
        title: 'Mercedes AMG Project ONE',
        author: 'hashikemu',
        authorUrl: 'https://sketchfab.com/hashikemu',
        sourceUrl:
            'https://sketchfab.com/3d-models/mercedes-amg-project-one-287716b5aeb24b0b934452526827eb52',
        license: CC_BY_NC,
        changes: `${WEB}; ${LITE}; ${KTX2}; ${GARAGE}`,
    },
    {
        usedFor: 'BMW E92 M3',
        title: 'BMW M3 e92 [stance]',
        ...BLACK_SNOW,
        sourceUrl:
            'https://sketchfab.com/3d-models/bmw-m3-e92-stance-c35a14d811b042d792a6da69381f7f80',
        license: CC_BY,
        changes: `${WEB}; ${LITE}; ${KTX2_MERGED}; ${GARAGE}`,
    },
    {
        usedFor: 'Mercedes-AMG C63 507',
        title: '2014 Mercedes-Benz C63 AMG Edition 507',
        ...DDIAZ,
        sourceUrl:
            'https://sketchfab.com/3d-models/2014-mercedes-benz-c63-amg-edition-507-f3b3da1832294845be7b05a21b5ad8fd',
        license: CC_BY_NC_SA,
        changes: `${WEB}; ${LITE}; ${KTX2_MERGED}; ${GARAGE}`,
    },
    {
        usedFor: 'Mercedes-AMG C63s Coupe',
        title: '2019 Mercedes-Benz C63 S AMG Coupe',
        ...DDIAZ,
        sourceUrl:
            'https://sketchfab.com/3d-models/2019-mercedes-benz-c63-s-amg-coupe-07f1e84892384aa08891b1f4cf266dd0',
        license: CC_BY_NC_SA,
        changes: `${WEB}; ${LITE}; ${KTX2_MERGED}; ${GARAGE}`,
    },
    {
        usedFor: 'BMW F82 M4',
        title: 'BMW M4 f82',
        ...BLACK_SNOW,
        sourceUrl:
            'https://sketchfab.com/3d-models/bmw-m4-f82-8e87379f40fd40dcac0a751e22c1a188',
        license: CC_BY,
        changes: `${WEB}; ${LITE}; ${KTX2_MERGED}; ${GARAGE}`,
    },
    {
        usedFor: 'BMW F90 M5 Competition',
        title: '2021 BMW M5 Competition',
        ...DDIAZ,
        sourceUrl:
            'https://sketchfab.com/3d-models/2021-bmw-m5-competition-29a4c13761cb40e6a050871bd40a0963',
        license: CC_BY_NC_SA,
        changes: `${WEB}; ${LITE}; ${KTX2_MERGED}; ${GARAGE}`,
    },
    {
        usedFor: 'BMW M8 Competition Coupe',
        title: '2020 BMW M8 Competition Coupé',
        ...DDIAZ,
        sourceUrl:
            'https://sketchfab.com/3d-models/2020-bmw-m8-competition-coupe-f68a25584899494391c8f2ae28c03b2f',
        license: CC_BY_NC_SA,
        changes: `${WEB}; ${LITE}; ${KTX2_MERGED}; ${GARAGE}`,
    },
    {
        usedFor: 'Mercedes-AMG GT63s Edition One',
        title: 'Mercedes-Benz AMG GT63 S',
        author: 'unknown',
        authorUrl: '',
        sourceUrl: null,
        license: null,
        changes: `brake discs simplified, ${WEB}; ${LITE}; ${KTX2_MERGED}; ${GARAGE}`,
    },
    {
        usedFor: 'Toyota Crown Platinum',
        title: 'toyota crown 2025',
        author: 'sultan',
        authorUrl: 'https://sketchfab.com/s122',
        sourceUrl:
            'https://sketchfab.com/3d-models/toyota-crown-2025-9f48fc0a66e44a69a09fda2f864e5944',
        license: CC_BY,
        changes: `geometry welded and Draco compressed (it has no textures); a low detail version with simplified geometry; ${GARAGE}`,
    },
    {
        usedFor: 'Flipper Zero on the desk',
        title: 'Flipper Zero',
        author: 'Pavel Zhovner',
        authorUrl: 'https://sketchfab.com/zhovner',
        sourceUrl:
            'https://sketchfab.com/3d-models/flipper-zero-1f246cff5f03472283f4e52fb0c84684',
        license: CC_BY,
        changes: 'geometry simplified and Draco compressed',
    },
];
