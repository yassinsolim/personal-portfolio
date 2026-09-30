import AudioManager from './AudioManager';
import * as THREE from 'three';
import UIEventBus from '../UI/EventBus';
import { Vector3 } from 'three';

export class AudioSource {
    manager: AudioManager;

    constructor(manager: AudioManager) {
        this.manager = manager;
    }

    update() {}
}
// key and click sounds while yassinOS on the main screen has the pointer or
// keys. the embed bridge reports only the kind of input, never which key
export class ComputerAudio extends AudioSource {
    constructor(manager: AudioManager) {
        super(manager);

        document.addEventListener('keydown', (event) => {
            if (event.key.includes('_AUTO_')) {
                this.manager.playAudio('ccType', {
                    volume: 0.1,
                    randDetuneScale: 0,
                    pitch: 20,
                });
            }
        });

        UIEventBus.on('room:osInput', (input: { kind?: string } | undefined) => {
            const room = this.manager.application.world?.room;
            if (!room) return;
            if (input?.kind === 'keydown') {
                this.manager.playAudio('keyboardKeydown', {
                    volume: 0.8,
                    position: room.anchor('anchor_keyboard'),
                });
            } else if (input?.kind === 'pointerdown' || input?.kind === 'pointerup') {
                this.manager.playAudio(input.kind === 'pointerdown' ? 'mouseDown' : 'mouseUp', {
                    volume: 0.8,
                    position: room.anchor('anchor_mouse'),
                });
            }
        });
    }
}

export class AmbienceAudio extends AudioSource {
    poolKey: string;

    constructor(manager: AudioManager) {
        super(manager);
        UIEventBus.on('loadingScreenDone', () => {
            this.poolKey = this.manager.playAudio('office', {
                volume: 1,
                loop: true,
                randDetuneScale: 0,
                filter: {
                    type: 'lowpass',
                    frequency: 1000,
                },
            });
            this.manager.playAudio('startup', {
                volume: 0.4,
                randDetuneScale: 0,
            });
        });
    }

    mapValues(
        input: number,
        input_start: number,
        input_end: number,
        output_start: number,
        output_end: number
    ) {
        return (
            output_start +
            ((output_end - output_start) / (input_end - input_start)) *
                (input - input_start)
        );
    }

    update() {
        const cameraPosition =
            this.manager.application.camera.instance.position;
        const y = cameraPosition.y;
        const x = cameraPosition.x;
        const z = cameraPosition.z;

        // calculate distance to origin
        const distance = Math.sqrt(x * x + y * y + z * z);

        const freq = this.mapValues(distance, 0, 10000, 100, 22000);

        const volume = this.mapValues(distance, 1200, 10000, 0, 0.2);
        const volumeClamped = Math.min(Math.max(volume, 0.05), 0.1);

        this.manager.setAudioFilterFrequency(this.poolKey, freq - 3000);
        this.manager.setAudioVolume(this.poolKey, volumeClamped);
    }
}
