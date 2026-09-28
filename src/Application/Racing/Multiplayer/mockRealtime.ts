// a stand in for the supabase realtime client, for multiplayer tests that
// must not touch the live project (its message quota is shared). windows of
// the same browser talk over a BroadcastChannel per lobby, presence works
// like supabase's (join, leave, a state reply to newcomers), and every
// message is counted in window.__mpStats the way supabase bills them: once
// when sent and once per client it reaches.
//
// turned on with ?raceDebug=1&mpmock=1

type Listener = {
    type: string;
    event: string;
    callback: (message: { payload?: unknown }) => void;
};
type Wire =
    | { t: 'broadcast'; from: string; event: string; payload: unknown }
    | { t: 'join' | 'state'; from: string; key: string; meta: unknown }
    | { t: 'hello' | 'leave'; from: string; key?: string };

export type MpStats = {
    sent: { broadcast: number; presence: number };
    received: { broadcast: number; presence: number };
    byEvent: Record<string, number>;
    startedAt: number;
};

const stats = (): MpStats => {
    const w = window as unknown as { __mpStats?: MpStats };
    if (!w.__mpStats) {
        w.__mpStats = {
            sent: { broadcast: 0, presence: 0 },
            received: { broadcast: 0, presence: 0 },
            byEvent: {},
            startedAt: Date.now(),
        };
    }
    return w.__mpStats;
};

export const mockRealtimeEnabled = () => {
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get('raceDebug') === '1' && params.get('mpmock') === '1';
    } catch {
        return false;
    }
};

const clientId = Math.random().toString(36).slice(2, 10);

class MockChannel {
    topic: string;
    presenceKey: string;
    private listeners: Listener[] = [];
    private wire: BroadcastChannel | null = null;
    private state: Record<string, unknown[]> = {};
    private own: unknown = null;
    private statusCallback: ((status: string) => void) | null = null;

    constructor(
        name: string,
        options?: { config?: { presence?: { key?: string } } }
    ) {
        this.topic = `realtime:${name}`;
        this.presenceKey = options?.config?.presence?.key || clientId;
    }

    on(
        type: string,
        filter: { event: string },
        callback: Listener['callback']
    ) {
        this.listeners.push({ type, event: filter.event, callback });
        return this;
    }

    subscribe(callback?: (status: string) => void) {
        this.statusCallback = callback || null;
        this.wire = new BroadcastChannel(`mprt:${this.topic}`);
        this.wire.onmessage = (event) => this.receive(event.data as Wire);
        // ask who's here, like supabase's presence_state on join
        this.post({ t: 'hello', from: clientId });
        window.setTimeout(() => this.statusCallback?.('SUBSCRIBED'), 30);
        return this;
    }

    private post(message: Wire) {
        this.wire?.postMessage(message);
    }

    private emit(type: string, event: string, payload?: unknown) {
        this.listeners
            .filter(
                (listener) => listener.type === type && listener.event === event
            )
            .forEach((listener) => listener.callback({ payload }));
    }

    private receive(message: Wire) {
        if (message.from === clientId) return;
        const s = stats();
        if (message.t === 'broadcast') {
            s.received.broadcast++;
            this.emit('broadcast', message.event, message.payload);
            return;
        }
        if (message.t === 'hello') {
            if (this.own) {
                s.sent.presence++;
                this.post({
                    t: 'state',
                    from: clientId,
                    key: this.presenceKey,
                    meta: this.own,
                });
            }
            return;
        }
        s.received.presence++;
        if (message.t === 'leave') {
            if (message.key) delete this.state[message.key];
        } else if (message.t === 'join' || message.t === 'state') {
            this.state[message.key] = [message.meta];
        }
        this.emit('presence', 'sync');
    }

    async track(meta: unknown) {
        this.own = meta;
        this.state[this.presenceKey] = [meta];
        stats().sent.presence++;
        this.post({ t: 'join', from: clientId, key: this.presenceKey, meta });
        this.emit('presence', 'sync');
        return 'ok';
    }

    async untrack() {
        if (!this.own) return 'ok';
        this.own = null;
        delete this.state[this.presenceKey];
        stats().sent.presence++;
        this.post({ t: 'leave', from: clientId, key: this.presenceKey });
        return 'ok';
    }

    presenceState() {
        return this.state;
    }

    async send(message: { type: string; event: string; payload?: unknown }) {
        if (message.type !== 'broadcast') return 'ok';
        const s = stats();
        s.sent.broadcast++;
        s.byEvent[message.event] = (s.byEvent[message.event] || 0) + 1;
        this.post({
            t: 'broadcast',
            from: clientId,
            event: message.event,
            payload: message.payload,
        });
        return 'ok';
    }

    async unsubscribe() {
        await this.untrack();
        this.wire?.close();
        this.wire = null;
        this.statusCallback?.('CLOSED');
        this.statusCallback = null;
        return 'ok';
    }
}

// only the parts of the supabase client the multiplayer service uses
export const createMockRealtime = () => {
    const channels: MockChannel[] = [];
    window.addEventListener('pagehide', () =>
        channels.forEach((channel) => void channel.untrack())
    );
    return {
        channel(
            name: string,
            options?: { config?: { presence?: { key?: string } } }
        ) {
            const channel = new MockChannel(name, options);
            channels.push(channel);
            return channel;
        },
        getChannels() {
            return channels.slice();
        },
        async removeChannel(channel: MockChannel) {
            await channel.unsubscribe();
            const index = channels.indexOf(channel);
            if (index >= 0) channels.splice(index, 1);
            return 'ok';
        },
    };
};
