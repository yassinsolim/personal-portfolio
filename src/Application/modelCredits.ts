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
const REGROUPED = 'wheel and caliper parts regrouped per corner and merged by material';
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
    sketchfabCar(
        'Lamborghini Huracán LP 610-4',
        '2015 Lamborghini Huracan LP610-4',
        DDIAZ,
        '2015-lamborghini-huracan-lp610-4-6857c07260714cbbbb3b4b1d7087604f',
        CC_BY_NC_SA,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'Lamborghini Aventador S',
        '2017 Lamborghini Aventador S LP 740-4',
        DDIAZ,
        '2017-lamborghini-aventador-s-lp-740-4-c2ca558099b040ff970012300e100b75',
        CC_BY_NC_SA,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'Ferrari LaFerrari',
        '2014 Ferrari LaFerrari',
        DDIAZ,
        '2014-ferrari-laferrari-8b46fa49718647de846387ef4c1e95b3',
        CC_BY,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'McLaren P1',
        'Mclaren P1 | www.vecarz.com',
        sketchfabAuthor('vecarz', 'heynic'),
        'mclaren-p1-wwwvecarzcom-adae2edc721e4ce7b31c1d06a581e30a',
        CC_BY,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'Porsche 918 Spyder',
        '2015 Porsche 918 Spyder',
        DDIAZ,
        '2015-porsche-918-spyder-f6d03ef13bf243c8b632ca7bacd8c0f3',
        CC_BY_NC_SA,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'Bugatti Chiron Super Sport',
        '2022 Bugatti Chiron Super Sport',
        DDIAZ,
        '2022-bugatti-chiron-super-sport-6a7520f6853f433eb200ed10fef96f94',
        CC_BY_NC_SA,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'Koenigsegg Jesko Attack',
        '2020 Koenigsegg Jesko',
        DDIAZ,
        '2020-koenigsegg-jesko-c657f51fb0db43e38fea172dfa385287',
        CC_BY,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'Pagani Huayra',
        'Pagani Huayra [Free]',
        BLACK_SNOW,
        'pagani-huayra-free-c2d61a9f53a54a229547bb76e4b71e25',
        CC_BY,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'McLaren Senna',
        '2019 McLaren Senna',
        DDIAZ,
        '2019-mclaren-senna-6924eb7b4dde44b19d87c8c31edc74b4',
        CC_BY,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'Ferrari SF90 Stradale',
        '2020 Ferrari SF90 Stradale',
        DDIAZ,
        '2020-ferrari-sf90-stradale-b98147fea0da42d29a2e41a4aba0fc20',
        CC_BY_NC_SA,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'Aston Martin Valkyrie',
        '2021 | Aston Martin Valkyrie',
        sketchfabAuthor('kevin (ケビン)', 'sohyalebret'),
        '2021-aston-martin-valkyrie-0ad5999a62be459c8f883ea0b58cf876',
        CC_BY,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
    sketchfabCar(
        'Toyota Supra MK4',
        'Toyota Supra (A80) 1993',
        sketchfabAuthor('Lexyc16', 'Lexyc16'),
        'toyota-supra-a80-1993-dd897d7823784bc5893c183c1328e8cb',
        CC_BY_NC,
        `${REGROUPED}; ${carChanges(true)}`,
    ),
];
