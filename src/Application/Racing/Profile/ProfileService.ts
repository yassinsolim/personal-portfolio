import type { SupabaseClient } from '@supabase/supabase-js';
import {
    ensureIdentity,
    forgetIdentity,
    newDeviceKey,
    readIdentity,
    sanitizePlayer,
    writeIdentity,
    type PlayerProfile,
    type ProfilePayload,
} from './profile';

// saving this device's profile and reading anyone's, through the board's
// database (supabase/racing.sql)
export type SaveStatus = 'saving' | 'saved' | 'local' | 'limited' | 'error' | 'removed' | 'taken';

export type PasswordStatus = 'set' | 'short' | 'limited' | 'error';

export type SignInResult =
    | { status: 'in'; player: PlayerProfile }
    | { status: 'wrong' | 'limited' | 'offline' | 'storage' | 'error' };

const PLAYER_COLUMNS = 'id,name,avatar,color,number,bio,car,garage,created_at';
// a profile read is good for a minute. the board's badges come with its rows
const CACHE_MS = 60_000;
// what was last saved, so a visit that changed nothing sends nothing
const SENT_KEY = 'yassinverse:profile:sent:v1';
const RETRY_MS = 20_000;
const LIMITED_RETRY_MS = 60_000;

const readSent = () => {
    try {
        return window.localStorage.getItem(SENT_KEY) || '';
    } catch {
        return '';
    }
};

const writeSent = (value: string) => {
    try {
        if (value) window.localStorage.setItem(SENT_KEY, value);
        else window.localStorage.removeItem(SENT_KEY);
    } catch {
        // sent again next visit
    }
};

export default class ProfileService {
    client: () => Promise<SupabaseClient | null>;
    onStatus: (status: SaveStatus) => void;
    cache = new Map<string, { at: number; player: PlayerProfile | null }>();
    // the newest edit not sent yet, and the save that's out
    pending: ProfilePayload | null = null;
    saving: Promise<void> | null = null;
    retryTimer = 0;
    // signing in or out: saves wait, and what was queued for the player
    // before is dropped once the device has another
    switching = false;
    // the switch running, so the next waits for it
    switchQueue: Promise<unknown> = Promise.resolve();

    constructor(client: () => Promise<SupabaseClient | null>, onStatus: (status: SaveStatus) => void) {
        this.client = client;
        this.onStatus = onStatus;
    }

    // one save at a time, and the newest edit after it
    save(payload: ProfilePayload) {
        this.pending = payload;
        window.clearTimeout(this.retryTimer);
        void this.flush();
    }

    async flush() {
        if (this.saving || this.switching || !this.pending) return;
        const payload = this.pending;
        this.pending = null;
        const sending = this.send(payload);
        this.saving = sending.then(() => undefined);
        const status = await sending;
        this.saving = null;
        if (this.pending) {
            void this.flush();
            return;
        }
        this.onStatus(status);
        if (status === 'error' || status === 'limited') {
            this.retryTimer = window.setTimeout(
                () => this.save(payload),
                status === 'limited' ? LIMITED_RETRY_MS : RETRY_MS
            );
        }
    }

    // nothing queued or out, before the device's player changes
    async settle() {
        window.clearTimeout(this.retryTimer);
        this.pending = null;
        await this.saving;
    }

    // a change of player with saves held. switched says it happened, so
    // what was queued meanwhile was the old player's
    async switchPlayer<T>(change: () => Promise<T>, switched: (result: T) => boolean) {
        const run = this.switchQueue.then(async () => {
            this.switching = true;
            await this.settle();
            try {
                const result = await change();
                if (switched(result)) this.pending = null;
                return result;
            } finally {
                this.switching = false;
                void this.flush();
            }
        });
        this.switchQueue = run.catch(() => undefined);
        return run;
    }

    async send(payload: ProfilePayload): Promise<SaveStatus> {
        const identity = ensureIdentity();
        const supabase = await this.client();
        if (!identity || !supabase) return 'local';
        const sent = `${identity.id}:${JSON.stringify(payload)}`;
        if (sent === readSent()) return 'saved';
        this.onStatus('saving');
        try {
            const { error } = await supabase.rpc('racing_save_player', {
                p_id: identity.id,
                p_key: identity.key,
                p_profile: payload,
            });
            if (error) {
                // the stored key isn't the one the player was made with: a
                // new player next time
                if (error.code === '42501') forgetIdentity();
                if (error.code === '23505') return 'taken';
                return error.code === '53400' ? 'limited' : 'error';
            }
        } catch {
            return 'error';
        }
        writeSent(sent);
        this.cache.delete(identity.id);
        return 'saved';
    }

    // the profile off the database, this device's laps keep their names. a
    // new player is made the next time one is needed
    async remove(): Promise<SaveStatus> {
        await this.settle();
        const identity = readIdentity();
        const supabase = await this.client();
        if (identity && supabase) {
            try {
                const { error } = await supabase.rpc('racing_delete_player', {
                    p_id: identity.id,
                    p_key: identity.key,
                });
                // 42501 is a player that was never saved
                if (error && error.code !== '42501') return 'error';
            } catch {
                return 'error';
            }
            this.cache.delete(identity.id);
        }
        forgetIdentity();
        writeSent('');
        return 'removed';
    }

    // whether nobody else races under a name. true when the board can't
    // say, the save does then
    async nameFree(name: string) {
        const supabase = await this.client();
        if (!supabase || !name.trim()) return true;
        try {
            const { data, error } = await supabase.rpc(
                'racing_name_free',
                { p_name: name.trim(), p_id: readIdentity()?.id ?? null },
                { get: true }
            );
            return error ? true : data !== false;
        } catch {
            return true;
        }
    }

    // whether this device's player has a password to sign in elsewhere
    // with. null when there's no saved player or no board
    async account(): Promise<{ password: boolean } | null> {
        const identity = readIdentity();
        const supabase = await this.client();
        if (!identity || !supabase) return null;
        try {
            const { data, error } = await supabase.rpc(
                'racing_account',
                { p_id: identity.id, p_key: identity.key },
                { get: true }
            );
            if (error || !data || typeof data !== 'object') return null;
            return { password: (data as { password?: unknown }).password === true };
        } catch {
            return null;
        }
    }

    async setPassword(password: string): Promise<PasswordStatus> {
        const identity = readIdentity();
        const supabase = await this.client();
        if (!identity || !supabase) return 'error';
        try {
            const { error } = await supabase.rpc('racing_set_password', {
                p_id: identity.id,
                p_key: identity.key,
                p_password: password,
            });
            if (!error) return 'set';
            if (error.code === '22023') return 'short';
            return error.code === '53400' ? 'limited' : 'error';
        } catch {
            return 'error';
        }
    }

    // this device signs in to a player with its name and password, with a key
    // of its own. bring moves the device's player before (and its laps) over
    async signIn(name: string, password: string, bring: boolean): Promise<SignInResult> {
        const supabase = await this.client();
        if (!supabase) return { status: 'offline' };
        return this.switchPlayer(
            async (): Promise<SignInResult> => {
                const key = newDeviceKey();
                const from = bring ? readIdentity() : null;
                try {
                    const { data, error } = await supabase.rpc('racing_sign_in', {
                        p_name: name.trim(),
                        p_password: password,
                        p_key: key,
                        p_from_id: from?.id ?? null,
                        p_from_key: from?.key ?? null,
                    });
                    if (error) return { status: error.code === '53400' ? 'limited' : 'error' };
                    const result = (data || {}) as { signed_in?: unknown; player?: unknown };
                    const player = result.signed_in === true ? sanitizePlayer(result.player) : null;
                    if (!player) return { status: 'wrong' };
                    // a browser that won't keep the key can't stay signed in
                    if (!writeIdentity({ id: player.id, key })) return { status: 'storage' };
                    writeSent('');
                    this.cache.delete(player.id);
                    return { status: 'in', player };
                } catch {
                    return { status: 'error' };
                }
            },
            (result) => result.status === 'in'
        );
    }

    // this device leaves its player, which stays as it is for the others. a
    // new one is made the next time one is needed
    async signOut(): Promise<'out' | 'error'> {
        const identity = readIdentity();
        const supabase = await this.client();
        if (!identity || !supabase) return 'error';
        return this.switchPlayer(
            async () => {
                try {
                    const { error } = await supabase.rpc('racing_sign_out', {
                        p_id: identity.id,
                        p_key: identity.key,
                    });
                    if (error && error.code !== '42501') return 'error' as const;
                } catch {
                    return 'error' as const;
                }
                this.cache.delete(identity.id);
                forgetIdentity();
                writeSent('');
                return 'out' as const;
            },
            (result) => result === 'out'
        );
    }

    async getPlayer(id: string) {
        const cached = this.cache.get(id);
        if (cached && Date.now() - cached.at < CACHE_MS) return cached.player;
        const supabase = await this.client();
        if (!supabase) return null;
        try {
            const { data, error } = await supabase
                .from('racing_players')
                .select(PLAYER_COLUMNS)
                .eq('id', id)
                .maybeSingle();
            if (error) return cached?.player || null;
            const player = sanitizePlayer(data);
            this.cache.set(id, { at: Date.now(), player });
            while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value as string);
            return player;
        } catch {
            return cached?.player || null;
        }
    }
}
