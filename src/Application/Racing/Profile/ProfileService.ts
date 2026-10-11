import type { SupabaseClient } from '@supabase/supabase-js';
import {
    ensureIdentity,
    forgetIdentity,
    readIdentity,
    sanitizePlayer,
    type PlayerProfile,
    type ProfilePayload,
} from './profile';

// saving this device's profile and reading anyone's, through the board's
// database (supabase/racing.sql)
export type SaveStatus = 'saving' | 'saved' | 'local' | 'limited' | 'error' | 'removed';

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
    // the newest edit not sent yet, and whether a save is out
    pending: ProfilePayload | null = null;
    saving = false;
    retryTimer = 0;

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
        if (this.saving || !this.pending) return;
        const payload = this.pending;
        this.pending = null;
        this.saving = true;
        const status = await this.send(payload);
        this.saving = false;
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
        window.clearTimeout(this.retryTimer);
        this.pending = null;
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
