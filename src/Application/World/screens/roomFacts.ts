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
    // its README (cat), the Portfolio app's entry
    about: string;
    timeline: string;
    highlights: string[];
    tech: string[];
    repo?: string;
    site?: string;
};

// one line each in the terminal's ls (about 38 characters), the details
// are in the Portfolio app
export const PROJECTS: Project[] = [
    {
        name: 'AetherVSR',
        summary: 'real-time AI video upscaler',
        folder: 'AetherVSR',
        about: 'Local GPU video super-resolution with a WebGPU desktop player and a native Metal path in progress.',
        timeline: '2026 - Present',
        highlights: [
            'Real-time neural video upscaler for 720p sources, with an Electron/WebGPU desktop player and an in-progress native macOS player built on Swift, AVFoundation, Core Video, and Metal.',
            "Rewrote the Metal convolution kernels around the GPU's 32 KB threadgroup memory, cutting 720p-to-1440p inference on Apple M5 from 65.9 ms to 3.9 ms p50 (16.8x) with golden-vector parity against the WebGPU path.",
            'Shipped a 6,291-parameter upscaler into a zero-readback WebGPU pipeline at 6.3 ms p50. A 10-minute 720p60 run held 59.6 fps with 0.88% frame loss.',
        ],
        tech: ['TypeScript', 'WebGPU', 'WGSL', 'Metal', 'Swift', 'Electron', 'ONNX Runtime'],
        repo: 'https://github.com/yassinsolim/AetherVSR',
    },
    {
        name: 'MacMST',
        summary: 'DisplayPort MST research on Apple M5',
        folder: 'MacMST',
        about: 'Safety-first research toolchain for native DisplayPort MST on Apple Silicon M5.',
        timeline: '2026',
        highlights: [
            'C++20/Python toolchain researching native DisplayPort multi-stream (MST) on Apple M5: an IOKit/IORegistry probe CLI with JSON reports, plus AUX/MST protocol decoders.',
            "Traced the display driver's kernel-to-firmware path by static analysis and modeled receiver front ends from component datasheets.",
            "Every private AUX/DPCD path sits behind fail-closed safety gates so a bad call can't hang the display coprocessor. 458 deterministic tests run with sanitizer builds.",
        ],
        tech: ['C++20', 'Python', 'IOKit', 'CMake / CTest', 'DisplayPort'],
        repo: 'https://github.com/yassinsolim/MacMST',
    },
    {
        name: 'soundalike',
        summary: 'finds songs by how they sound',
        folder: 'soundalike',
        about: 'Open-source music recommender that matches songs by timbre and vibe rather than tags.',
        timeline: '2026',
        highlights: [
            'Finds songs by how they sound across a 272,853-track catalog, blending learned audio embeddings with a DSP engine measured straight from the waveform.',
            'Trained self-supervised audio embeddings on 106K tracks on a local RTX 5080, lifting frozen genre-probe accuracy from 0.25 to 0.641.',
            'Ships as a web app, an always-on API, a mobile companion, and a Spicetify extension that adds a right-click "Find soundalikes" menu inside Spotify.',
        ],
        tech: ['Python', 'PyTorch', 'CUDA', 'cuDNN', 'NumPy', 'Self-Supervised Learning', 'DSP'],
        repo: 'https://github.com/yassinsolim/soundalike',
        site: 'https://soundalike.yassin.app',
    },
    {
        name: 'NavOSS',
        summary: 'account-free navigation for Calgary',
        folder: 'NavOSS',
        about: 'Privacy-first, account-free navigation for Calgary, currently in iOS technical beta.',
        timeline: '2026',
        highlights: [
            'Built on OpenStreetMap-derived data, MapLibre, and self-hosted Valhalla and Nominatim, with no tracking accounts and on-device storage for saved places.',
            'Expo/React Native iOS client backed by a native Swift navigation core handling map matching, rerouting, spoken guidance, and CarPlay.',
            'Strict TypeScript monorepo with shared Zod contracts, a Fastify API, a 17-variant Calgary route regression matrix, and TestFlight builds from CI.',
        ],
        tech: ['TypeScript', 'Expo', 'React Native', 'Swift', 'CarPlay', 'Fastify', 'MapLibre', 'Valhalla'],
        repo: 'https://github.com/yassinsolim/NavOSS',
        site: 'https://navoss.yassin.app',
    },
    {
        name: 'Bowstack',
        summary: 'claim PDFs to Mitchell Connect drafts',
        folder: 'Bowstack',
        about: 'Chrome extension that turns insurer claim PDFs into Mitchell Connect drafts for collision shops.',
        timeline: '2026',
        highlights: [
            "Turns the insurer's collision-claim PDF a repair shop already received into a review-ready Mitchell Connect draft: contact, vehicle, insurance, and estimate line items.",
            'Extracts PDF text in the browser with PDF.js and sends only compact text through an access-controlled AI service. The model key never ships in the extension.',
            'Fill-only by design: every field is reviewed and Save stays manual. Currently in private beta.',
        ],
        tech: ['TypeScript', 'Chrome Extension (MV3)', 'WXT', 'PDF.js', 'OpenAI API', 'Vitest', 'Playwright'],
        site: 'https://bowstack.ca',
    },
    {
        name: 'Nordschleife Racer',
        summary: 'the racing game in this room',
        about: 'Arcade-sim racing engine with custom physics, multiplayer, and ghost replays.',
        timeline: '2026',
        highlights: [
            'Browser arcade-sim racing engine with custom vehicle physics tuned for the Nordschleife.',
            'Raycast suspension, drift handling, and ghost replays for solo time attack.',
            'Real-time multiplayer over Supabase and a Postgres global leaderboard secured by row-level security.',
        ],
        tech: ['TypeScript', 'Three.js', 'WebGL', 'Supabase', 'WebSockets', 'Vehicle Physics'],
        repo: 'https://github.com/yassinsolim/nordschleife-racer',
    },
    {
        name: 'WebStrafe',
        summary: 'browser surf sandbox, CS:GO movement',
        folder: 'WebStrafe',
        about: 'Browser Three.js surf sandbox chasing CS:GO bhop and surf movement feel.',
        timeline: '2026',
        highlights: [
            'Source-style kinematic movement controller running a unit-tested, fixed 128 Hz simulation with surf, ground, and air handling.',
            'Map manifest system with BVH collision against static triangle meshes, plus a separate render scene for the first-person viewmodel.',
            "Real-time multiplayer over Supabase Realtime, with a host player's client running bots and hit detection, plus an online leaderboard.",
        ],
        tech: ['TypeScript', 'Three.js', 'Vite', 'Supabase Realtime', 'BVH Collision'],
        repo: 'https://github.com/yassinsolim/WebStrafe',
        site: 'https://strafe.yassin.app',
    },
    {
        name: 'yassinOS',
        summary: 'the desktop OS on the main screen',
        about: "Browser desktop OS, built on daedalOS, that runs inside the 3D site's monitor.",
        timeline: 'Dec 2025 - Present',
        highlights: [
            'Personal desktop OS in the browser, built on daedalOS with Next.js, React, and TypeScript, and embedded as the working monitor screen in this room.',
            "Custom Portfolio app, project workspaces on the desktop, and a PDF viewer that renders the resume's real, selectable text with clickable links.",
        ],
        tech: ['Next.js', 'React', 'TypeScript', 'styled-components', 'Docker', 'Vercel'],
        repo: 'https://github.com/yassinsolim/yassinOS',
        site: 'https://os.yassin.app',
    },
    {
        name: 'Waybionic',
        summary: 'software for a robotic surgical arm',
        folder: 'Waybionic',
        about: 'ROS 2 ground station and embedded control for the UCalgary Waybionic robotic surgical arm.',
        timeline: 'Ongoing',
        highlights: [
            'Co-lead software for a 10-engineer team, centered on a ROS 2 (Jazzy) C++/Python ground station with RViz visualization, telemetry, diagnostics, and safety monitoring.',
            "Built an interactive inverse-kinematics demo on MoveIt's IK service. Unreachable targets abort cleanly instead of commanding a partial move.",
            "Wrote the arm's real-time motion control in embedded C/C++ on Arduino: 1 kHz PID with anti-windup, encoder interrupts, and filtered sensor input.",
        ],
        tech: ['ROS 2', 'C++', 'Python', 'MoveIt', 'RViz', 'Docker', 'Arduino'],
        repo: 'https://github.com/Waybionic/waybionic_ground_station',
        site: 'https://waybionic.com',
    },
    {
        name: 'PathGuard',
        summary: 'crosswalk safety prototype',
        folder: 'PathGuard',
        about: 'Crosswalk safety prototype pairing embedded hazard reporting with a live congestion map.',
        timeline: 'Nov 2025 - HackTheChange',
        highlights: [
            'An ESP32-CAM people-counting node, an Arduino UNO R4 WiFi hazard kiosk, and an AWS backend surfacing real-time pedestrian congestion and hazards on a map.',
            'A YOLOv8n + ByteTrack pipeline tracks pedestrians from an MJPEG stream and publishes compact congestion records to an ingest API.',
        ],
        tech: ['Python', 'YOLOv8', 'ESP32-CAM', 'Arduino', 'AWS', 'React', 'TypeScript'],
        repo: 'https://github.com/JAYMA-Hacks/PathGuard',
        site: 'https://path-guard.vercel.app/home',
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
    ['hashikemu, Black Snow, Ddiaz Design, sultan, vecarz, friends of Yassin', 'car models'],
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
    ['ls', 'my projects, or what is in this folder'],
    ['cd <project>', 'step into a project, the main screen follows'],
    ['cat <project>', 'read its README'],
    ['open <name>', 'an app, project or link, on the main screen'],
    ['whoami', 'who I am'],
    ['contact', 'where to find me'],
    ['neofetch', 'your machine next to mine'],
    ['graphics', 'how your browser draws this room'],
    ['race', 'take the car around the Nordschleife'],
    ['credits', 'who made this room possible'],
    ['history', 'what you typed'],
    ['clear', 'clear the screen'],
    ['exit', 'leave the terminal'],
];

// work but aren't listed, for whoever tries them
export const HIDDEN_COMMANDS = ['pwd', 'echo', 'date', 'sudo'];

export const CONTACT = {
    name: 'Yassin Soliman',
    place: 'Calgary, AB',
    email: 'solimanyassin@gmail.com',
    github: 'https://github.com/yassinsolim',
    linkedin: 'https://linkedin.com/in/yassinsoliman',
};

export const TRACK = {
    name: 'Nordschleife',
    place: 'Nürburgring, 20.8 km',
};

// the lap's centreline (static/models/Tracks/Nordschleife/nordschleife.json,
// x and z) cut to 103 points 15 m apart at most, scaled into 0 to 999. drawn
// until the race sends its own outline, and the same shape as that one
export const TRACK_OUTLINE =
    '365,790,349,781,330,761,312,786,291,798,281,797,252,785,219,786,194,761,189,750,161,744,154,726,105,690,69,644,68,627,77,602,81,572,73,522,43,454,0,425,4,414,45,395,106,340,121,308,122,285,136,270,132,254,159,230,204,179,207,167,200,143,170,132,160,123,161,114,192,94,204,66,215,57,234,59,259,76,268,88,278,79,288,76,319,75,344,80,353,68,358,46,390,33,437,22,473,0,480,3,483,13,484,70,490,85,503,98,545,118,614,122,642,129,693,158,715,153,757,123,803,115,809,119,808,128,767,160,766,168,773,169,790,150,836,137,851,126,863,110,863,91,879,73,922,87,938,103,959,109,977,133,967,170,977,179,995,186,999,215,991,223,958,222,951,225,929,266,930,311,924,321,897,333,880,352,864,381,836,400,774,417,744,402,717,419,714,427,724,438,762,453,769,462,775,483,768,499,463,687,423,733,389,782,375,784';
