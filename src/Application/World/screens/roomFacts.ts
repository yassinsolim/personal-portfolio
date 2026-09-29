// what m2 and m3 say about yassin. taken from yassinOS's portfolio app
// (components/apps/Portfolio/data.ts in the yassinOS repo): keep it short,
// true, and in step with that file

export const NOW = {
    role: 'AI GPU Software Libraries intern at AMD',
    since: 'Software Engineer Intern since May 2026, Calgary',
    items: [
        'Shipping MIOpen convolution solvers, kernel-selection databases and hipDNN heuristics',
        "Co-leading software for Waybionic's robotic surgical arm",
        'Building AetherVSR and MacMST on the side',
    ],
    school: 'Software Engineering at UCalgary, graduating April 2028',
};

export type Project = {
    name: string;
    summary: string;
    // its workspace folder in yassinOS, under /Users/Public
    folder?: string;
};

// one line each in the terminal's ls (about 38 characters), the details
// are in the Portfolio app
export const PROJECTS: Project[] = [
    {
        name: 'AetherVSR',
        summary: 'real-time AI video upscaler',
        folder: 'AetherVSR',
    },
    {
        name: 'MacMST',
        summary: 'DisplayPort MST research on Apple M5',
        folder: 'MacMST',
    },
    {
        name: 'soundalike',
        summary: 'finds songs by how they sound',
        folder: 'soundalike',
    },
    {
        name: 'NavOSS',
        summary: 'account-free navigation for Calgary',
        folder: 'NavOSS',
    },
    {
        name: 'Bowstack',
        summary: 'claim PDFs to Mitchell Connect drafts',
        folder: 'Bowstack',
    },
    { name: 'Nordschleife Racer', summary: 'the racing game in this room' },
    {
        name: 'WebStrafe',
        summary: 'browser surf sandbox, CS:GO movement',
        folder: 'WebStrafe',
    },
    { name: 'yassinOS', summary: 'the desktop OS on the main screen' },
    {
        name: 'Waybionic',
        summary: 'software for a robotic surgical arm',
        folder: 'Waybionic',
    },
    {
        name: 'PathGuard',
        summary: 'crosswalk safety prototype',
        folder: 'PathGuard',
    },
];

export const OLDER_PROJECTS = [
    'InterviewCoach',
    'DisasterManagementGUI',
    'CalgaryConnect',
    'Weather-Stock-Data',
    'Spotify-Statistics',
];

// the pc under the desk and the monitors in this room
export const RIG = {
    cpu: 'Intel i9-14900KF',
    gpu: 'Gigabyte RTX 5080',
    memory: '48 GB DDR5-6800',
    case: 'Phanteks NV5',
    displays: 'three 27 inch 1440p OLEDs',
};

export const CREDITS: [string, string][] = [
    ['Yassin Soliman', 'development, 2025 to 2026'],
    ['Henry Heffernan', 'original 3D portfolio (2022)'],
    ['Dustin Brett', 'daedalOS, the base of yassinOS'],
    ['three.js', '3D rendering'],
    ['React', 'interface'],
    ['Ddiaz Design, Black Snow, hashikemu, sultan', 'car models (Sketchfab)'],
    ['Pavel Zhovner', 'Flipper Zero model (Sketchfab)'],
    ['OpenStreetMap contributors', 'Nordschleife track data (ODbL)'],
];

// a yassinOS process id (contexts/process/directory.ts there) and what to
// open in it
export type OpenTarget = { app: string; url?: string; label: string };

export const HOME = '/Users/Public';

export const APPS: Record<string, OpenTarget> = {
    portfolio: { app: 'Portfolio', label: 'Portfolio' },
    projects: { app: 'FileExplorer', url: HOME, label: 'File Explorer' },
    files: { app: 'FileExplorer', url: HOME, label: 'File Explorer' },
    terminal: { app: 'Terminal', label: 'Terminal' },
    resume: {
        app: 'PDF',
        url: `${HOME}/Desktop/Resume.pdf`,
        label: 'Resume.pdf',
    },
    browser: { app: 'Browser', label: 'Browser' },
    paint: { app: 'Paint', label: 'Paint' },
    pinball: { app: 'SpaceCadet', label: 'Space Cadet' },
    webamp: { app: 'Webamp', label: 'Webamp' },
    vim: { app: 'Vim', label: 'Vim' },
};

// m2's buttons, in order
export const LINKS: { key: string; label: string }[] = [
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'projects', label: 'Projects' },
    { key: 'terminal', label: 'Terminal' },
    { key: 'resume', label: 'Resume' },
];

// window titles of yassinOS's apps, for its process ids
export const APP_TITLES: Record<string, string> = {
    BoxedWine: 'BoxedWine',
    Browser: 'Browser',
    ClassiCube: 'ClassiCube',
    DXBall: 'DX-Ball',
    DevTools: 'DevTools',
    Emulator: 'Emulator',
    FileExplorer: 'File Explorer',
    IRC: 'IRC',
    JSDOS: 'js-dos',
    Marked: 'Marked',
    Messenger: 'Messenger',
    MonacoEditor: 'Monaco Editor',
    OpenType: 'OpenType',
    PDF: 'PDF',
    Paint: 'Paint',
    Photos: 'Photos',
    Portfolio: 'Portfolio',
    Quake3: 'Quake III Arena',
    Ruffle: 'Ruffle',
    SpaceCadet: 'Space Cadet',
    StableDiffusion: 'Stable Diffusion',
    Terminal: 'Terminal',
    Tic80: 'TIC-80',
    TinyMCE: 'TinyMCE',
    V86: 'Virtual x86',
    VideoPlayer: 'Video Player',
    Vim: 'Vim',
    Webamp: 'Webamp',
};

export const COMMANDS: [string, string][] = [
    ['help', 'this list'],
    ['ls', 'my projects'],
    ['open <name>', 'an app or project, on the main screen'],
    ['neofetch', 'your machine next to mine'],
    ['graphics', 'how your browser draws this room'],
    ['race', 'take the car around the Nordschleife'],
    ['credits', 'who made this room possible'],
    ['clear', 'clear the screen'],
    ['exit', 'leave the terminal'],
];

export const TRACK = {
    name: 'Nordschleife',
    place: 'Nürburgring, 20.8 km',
};

// the lap's centreline (static/models/Tracks/Nordschleife/nordschleife.json,
// x and z) cut to 103 points 15 m apart at most, scaled into 0 to 999. drawn
// until the race sends its own outline, and the same shape as that one
export const TRACK_OUTLINE =
    '365,790,349,781,330,761,312,786,291,798,281,797,252,785,219,786,194,761,189,750,161,744,154,726,105,690,69,644,68,627,77,602,81,572,73,522,43,454,0,425,4,414,45,395,106,340,121,308,122,285,136,270,132,254,159,230,204,179,207,167,200,143,170,132,160,123,161,114,192,94,204,66,215,57,234,59,259,76,268,88,278,79,288,76,319,75,344,80,353,68,358,46,390,33,437,22,473,0,480,3,483,13,484,70,490,85,503,98,545,118,614,122,642,129,693,158,715,153,757,123,803,115,809,119,808,128,767,160,766,168,773,169,790,150,836,137,851,126,863,110,863,91,879,73,922,87,938,103,959,109,977,133,967,170,977,179,995,186,999,215,991,223,958,222,951,225,929,266,930,311,924,321,897,333,880,352,864,381,836,400,774,417,744,402,717,419,714,427,724,438,762,453,769,462,775,483,768,499,463,687,423,733,389,782,375,784';
