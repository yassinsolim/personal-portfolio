// third party 3d models (the cars), for the race menu credits. CREDITS.md has the same
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
    // shown instead of a license, for a model that was shared rather than published
    shared?: string;
    changes: string;
};

const creativeCommons = (code: string, shareAlike = false): ModelLicense => ({
    label: `CC ${code.toUpperCase()} 4.0`,
    url: `https://creativecommons.org/licenses/${code}/4.0/`,
    shareAlike,
});
const CC_BY = creativeCommons('by');
const CC_BY_NC = creativeCommons('by-nc');
const CC_BY_NC_SA = creativeCommons('by-nc-sa', true);

// what the build does to every car (scripts/optimize-models.mjs,
// scripts/build-ktx2-cars.mjs) and what the garage does at runtime
const WEB =
    'textures resized to 1024 px and converted to WebP, geometry welded and Draco compressed';
const LITE = 'a low detail version (simplified geometry, 512 px textures)';
const GARAGE = 'the paint and wheels can be changed in the garage';
const carChanges = (ktx2MergesMeshes: boolean) =>
    `${WEB}; ${LITE}; a KTX2 texture version${
        ktx2MergesMeshes ? ' with merged meshes' : ''
    }; ${GARAGE}`;

type Author = { author: string; authorUrl: string };
const sketchfabAuthor = (author: string, profile: string): Author => ({
    author,
    authorUrl: `https://sketchfab.com/${profile}`,
});
const DDIAZ = sketchfabAuthor('Ddiaz Design', 'ddiaz-design');
const BLACK_SNOW = sketchfabAuthor('Black Snow', 'BlackSnow02');

const sketchfabCar = (
    usedFor: string,
    title: string,
    by: Author,
    slug: string,
    license: ModelLicense,
    changes = carChanges(true),
): ModelCredit => ({
    usedFor,
    title,
    ...by,
    sourceUrl: `https://sketchfab.com/3d-models/${slug}`,
    license,
    changes,
});

export const MODEL_CREDITS: ModelCredit[] = [
    sketchfabCar(
        'Mercedes-AMG One',
        'Mercedes AMG Project ONE',
        sketchfabAuthor('hashikemu', 'hashikemu'),
        'mercedes-amg-project-one-287716b5aeb24b0b934452526827eb52',
        CC_BY_NC,
        carChanges(false),
    ),
    sketchfabCar(
        'BMW E92 M3',
        'BMW M3 e92 [stance]',
        BLACK_SNOW,
        'bmw-m3-e92-stance-c35a14d811b042d792a6da69381f7f80',
        CC_BY,
    ),
    sketchfabCar(
        'Mercedes-AMG C63 507',
        '2014 Mercedes-Benz C63 AMG Edition 507',
        DDIAZ,
        '2014-mercedes-benz-c63-amg-edition-507-f3b3da1832294845be7b05a21b5ad8fd',
        CC_BY_NC_SA,
    ),
    sketchfabCar(
        'Mercedes-AMG C63s Coupe',
        '2019 Mercedes-Benz C63 S AMG Coupe',
        DDIAZ,
        '2019-mercedes-benz-c63-s-amg-coupe-07f1e84892384aa08891b1f4cf266dd0',
        CC_BY_NC_SA,
    ),
    sketchfabCar(
        'BMW F82 M4',
        'BMW M4 f82',
        BLACK_SNOW,
        'bmw-m4-f82-8e87379f40fd40dcac0a751e22c1a188',
        CC_BY,
    ),
    sketchfabCar(
        'BMW F90 M5 Competition',
        '2021 BMW M5 Competition',
        DDIAZ,
        '2021-bmw-m5-competition-29a4c13761cb40e6a050871bd40a0963',
        CC_BY_NC_SA,
    ),
    sketchfabCar(
        'BMW M8 Competition Coupe',
        '2020 BMW M8 Competition Coupé',
        DDIAZ,
        '2020-bmw-m8-competition-coupe-f68a25584899494391c8f2ae28c03b2f',
        CC_BY_NC_SA,
    ),
    {
        usedFor: 'Mercedes-AMG GT63s Edition One',
        title: 'Mercedes-Benz AMG GT63 S',
        author: 'friends of Yassin',
        authorUrl: '',
        sourceUrl: null,
        license: null,
        shared: 'shared with him directly',
        changes: `brake discs simplified, ${carChanges(true)}`,
    },
    sketchfabCar(
        'Toyota Crown Platinum',
        'toyota crown 2025',
        sketchfabAuthor('sultan', 's122'),
        'toyota-crown-2025-9f48fc0a66e44a69a09fda2f864e5944',
        CC_BY,
        `geometry welded and Draco compressed (it has no textures); a low detail version with simplified geometry; ${GARAGE}`,
    ),
];
