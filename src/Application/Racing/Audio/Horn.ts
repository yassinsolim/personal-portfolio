// a car horn: two buzzy tones about a third apart, like the pair of disc
// horns behind most grilles. made here, so there's nothing to download
const LOW_HZ = 420;
const HIGH_HZ = 510;

// each car model gets its own note, a bit higher or lower
export const hornPitch = (carId: string) => {
    let hash = 0;
    for (let i = 0; i < carId.length; i++) {
        hash = (hash * 31 + carId.charCodeAt(i)) >>> 0;
    }
    return 0.86 + ((hash % 1000) / 1000) * 0.3;
};

export default class Horn {
    context: BaseAudioContext;
    output: GainNode;
    oscillators: OscillatorNode[];
    level: number;
    on = false;

    constructor(
        context: BaseAudioContext,
        destination: AudioNode,
        pitch = 1,
        level = 0.12
    ) {
        this.context = context;
        this.level = level;
        this.output = context.createGain();
        this.output.gain.value = 0;
        // the disc rings around 2 khz, the very top is soft
        const ring = context.createBiquadFilter();
        ring.type = 'peaking';
        ring.frequency.value = 1900;
        ring.Q.value = 1.4;
        ring.gain.value = 7;
        const top = context.createBiquadFilter();
        top.type = 'lowpass';
        top.frequency.value = 4200;
        ring.connect(top);
        top.connect(this.output);
        this.output.connect(destination);
        this.oscillators = [LOW_HZ, HIGH_HZ].map((hz) => {
            const osc = context.createOscillator();
            osc.type = 'square';
            osc.frequency.value = hz * pitch;
            const mix = context.createGain();
            mix.gain.value = 0.45;
            osc.connect(mix);
            mix.connect(ring);
            osc.start();
            return osc;
        });
    }

    setPitch(pitch: number) {
        const now = this.context.currentTime;
        this.oscillators[0].frequency.setValueAtTime(LOW_HZ * pitch, now);
        this.oscillators[1].frequency.setValueAtTime(HIGH_HZ * pitch, now);
    }

    set(on: boolean) {
        if (on === this.on) return;
        this.on = on;
        const now = this.context.currentTime;
        const gain = this.output.gain;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
        gain.setTargetAtTime(on ? this.level : 0, now, on ? 0.01 : 0.04);
    }

    dispose() {
        this.set(false);
        const { oscillators, output } = this;
        // after the fade out, so it doesn't click
        setTimeout(() => {
            oscillators.forEach((osc) => osc.stop());
            output.disconnect();
        }, 300);
    }
}
