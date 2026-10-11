import { carOptions, carOptionsById } from '../../carOptions';
import {
    encodeLook,
    isStockSetup,
    loadLook,
    loadTune,
    sameLook,
    STOCK_LOOK,
    tuneCode,
} from '../Garage/garage';

// a driver's profile: the badge, name, number and bio the board shows, the
// car they show off and how their cars are set up. edited on this device and
// saved with the device's own key (supabase/racing.sql racing_save_player).
// everything read back from the database goes through the sanitizers here

// a car id to its look code (garage.ts encodeLook) and tune code (tuneCode),
// '' when that part is factory
export type GarageCodes = Record<string, { look: string; tune: string }>;

export type PlayerBadge = {
    id: string;
    name: string;
    avatar: Avatar;
    color: string;
    number: number | null;
};

export type PlayerProfile = PlayerBadge & {
    bio: string;
    car: string | null;
    garage: GarageCodes;
    createdAt: string;
};

// what the profile tab edits. the name is the driver name, kept as it was
export type ProfileDraft = {
    avatar: Avatar;
    color: string;
    number: number | null;
    bio: string;
    // the car shown off, null for the one driven now
    car: string | null;
};

export type ProfilePayload = {
    name: string;
    avatar: Avatar;
    color: string;
    number: number | null;
    bio: string;
    car: string | null;
    garage: GarageCodes;
};

export type Identity = { id: string; key: string };

// glyphs (PlayerBadge.tsx draws them), and the name's initials or the number
export const AVATARS = [
    'helmet',
    'wheel',
    'flag',
    'bolt',
    'flame',
    'crown',
    'star',
    'wing',
    'turbo',
    'piston',
    'shield',
    'ghost',
    'peak',
    'initials',
    'number',
] as const;
export type Avatar = (typeof AVATARS)[number];

export const COLORS = [
    '#e8b04a',
    '#f76b15',
    '#e5484d',
    '#d6409f',
    '#8e4ec6',
    '#3e63dd',
    '#0090ff',
    '#12a594',
    '#46a758',
    '#bdee63',
    '#e8e2d0',
    '#6f6e77',
];

export const MAX_BIO = 140;

export const DEFAULT_DRAFT: ProfileDraft = {
    avatar: 'helmet',
    color: COLORS[0],
    number: null,
    bio: '',
    car: null,
};

const IDENTITY_KEY = 'yassinverse:player:v1';
const DRAFT_KEY = 'yassinverse:profile:v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9_-]{32,128}$/;
// control characters and the invisible ones that flip or hide text, which
// the database refuses (racing_clean_text)
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

export const cleanText = (value: unknown, max: number) =>
    Array.from(String(value ?? '').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim())
        .slice(0, max)
        .join('')
        .trim();

export const sanitizeColor = (value: unknown) =>
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_DRAFT.color;

export const sanitizeAvatar = (value: unknown): Avatar =>
    AVATARS.includes(value as Avatar) ? (value as Avatar) : 'helmet';

export const sanitizeNumber = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= 99 ? number : null;
};

export const sanitizeCar = (value: unknown) =>
    typeof value === 'string' && carOptionsById[value] ? value : null;

export const sanitizeGarage = (value: unknown): GarageCodes => {
    const garage: GarageCodes = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return garage;
    Object.entries(value as Record<string, unknown>).forEach(([carId, entry]) => {
        if (!carOptionsById[carId] || !entry || typeof entry !== 'object') return;
        const { look, tune } = entry as { look?: unknown; tune?: unknown };
        garage[carId] = {
            look: typeof look === 'string' && /^[0-9a-z.-]{0,80}$/.test(look) ? look : '',
            tune: typeof tune === 'string' && /^[0-9a-z]{0,24}$/.test(tune) ? tune : '',
        };
    });
    return garage;
};

export const sanitizeDraft = (raw: unknown): ProfileDraft => {
    const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ProfileDraft, unknown>>;
    return {
        avatar: sanitizeAvatar(source.avatar),
        color: sanitizeColor(source.color),
        number: sanitizeNumber(source.number),
        bio: cleanText(source.bio, MAX_BIO),
        car: sanitizeCar(source.car),
    };
};

// a racing_players row as the board embeds it (id, name, avatar, color, number)
export const sanitizeBadge = (row: unknown): PlayerBadge | null => {
    const source = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    if (typeof source.id !== 'string' || !UUID.test(source.id)) return null;
    return {
        id: source.id,
        name: cleanText(source.name, 16) || 'Driver',
        avatar: sanitizeAvatar(source.avatar),
        color: sanitizeColor(source.color),
        number: sanitizeNumber(source.number),
    };
};

export const sanitizePlayer = (row: unknown): PlayerProfile | null => {
    const badge = sanitizeBadge(row);
    if (!badge) return null;
    const source = row as Record<string, unknown>;
    return {
        ...badge,
        bio: cleanText(source.bio, MAX_BIO),
        car: sanitizeCar(source.car),
        garage: sanitizeGarage(source.garage),
        createdAt: typeof source.created_at === 'string' ? source.created_at : '',
    };
};

export const isPlayerId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export const initialsOf = (name: string) => {
    const words = cleanText(name, 16).split(' ').filter(Boolean);
    const letters =
        words.length > 1
            ? Array.from(words[0])[0] + Array.from(words[1])[0]
            : Array.from(words[0] || 'D').slice(0, 2).join('');
    return letters.toUpperCase();
};

const storage = () => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

export const readIdentity = (): Identity | null => {
    try {
        const parsed = JSON.parse(storage()?.getItem(IDENTITY_KEY) || 'null');
        if (parsed && UUID.test(parsed.id) && KEY.test(parsed.key)) return { id: parsed.id, key: parsed.key };
    } catch {
        // made again when it's needed
    }
    return null;
};

const randomBytes = (count: number) => {
    const bytes = new Uint8Array(count);
    crypto.getRandomValues(bytes);
    return bytes;
};

// randomUUID is only there on https, getRandomValues everywhere
const newId = () => {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const newKey = () =>
    btoa(String.fromCharCode(...randomBytes(32)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

// this device's player, made the first time it's needed. without storage
// there's no lasting player, so none
export const ensureIdentity = (): Identity | null => {
    const known = readIdentity();
    if (known) return known;
    const store = storage();
    if (!store || typeof crypto === 'undefined' || !crypto.getRandomValues) return null;
    try {
        store.setItem(IDENTITY_KEY, JSON.stringify({ id: newId(), key: newKey() }));
    } catch {
        return null;
    }
    return readIdentity();
};

export const forgetIdentity = () => {
    try {
        storage()?.removeItem(IDENTITY_KEY);
    } catch {
        // nothing stored then
    }
};

export const readDraft = (): ProfileDraft => {
    try {
        return sanitizeDraft(JSON.parse(storage()?.getItem(DRAFT_KEY) || 'null'));
    } catch {
        return { ...DEFAULT_DRAFT };
    }
};

export const writeDraft = (draft: ProfileDraft) => {
    try {
        storage()?.setItem(DRAFT_KEY, JSON.stringify(sanitizeDraft(draft)));
    } catch {
        // kept for this visit only
    }
};

// the cars set up on this device, and the one shown off even when factory
export const deviceGarage = (featured: string | null): GarageCodes => {
    const garage: GarageCodes = {};
    carOptions.forEach(({ id }) => {
        const look = loadLook(id);
        const tune = loadTune(id);
        const entry = {
            look: sameLook(look, STOCK_LOOK) ? '' : encodeLook(look),
            tune: isStockSetup(tune, look) ? '' : tuneCode(tune, look),
        };
        if (entry.look || entry.tune || id === featured) garage[id] = entry;
    });
    return garage;
};

// what goes to the database: the draft, the driver name, the car shown off
// (the one driven now unless one was picked) and this device's garage
export const profilePayload = (name: string, draft: ProfileDraft, drivenCar: string): ProfilePayload => {
    const car = draft.car || sanitizeCar(drivenCar);
    return {
        name: cleanText(name, 16) || 'Driver',
        avatar: draft.avatar,
        color: draft.color,
        number: draft.number,
        bio: cleanText(draft.bio, MAX_BIO),
        car,
        garage: deviceGarage(car),
    };
};

export const sanitizePayload = (raw: unknown): ProfilePayload => {
    const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return {
        name: cleanText(source.name, 16) || 'Driver',
        ...sanitizeDraft(source),
        garage: sanitizeGarage(source.garage),
    };
};
