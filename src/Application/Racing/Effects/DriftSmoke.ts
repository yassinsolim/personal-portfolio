import * as THREE from 'three';
import UIEventBus from '../../UI/EventBus';

type SmokeParticle = {
    sprite: THREE.Sprite;
    velocity: THREE.Vector3;
    age: number;
    life: number;
    baseScale: number;
};

const QUALITY_PARTICLE_LIMIT = 96;
const PERFORMANCE_PARTICLE_LIMIT = 56;

const createSmokeTexture = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) {
        return new THREE.Texture();
    }

    const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 28);
    gradient.addColorStop(0, 'rgba(255,255,255,0.8)');
    gradient.addColorStop(0.45, 'rgba(210,210,210,0.45)');
    gradient.addColorStop(1, 'rgba(150,150,150,0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
};

export default class DriftSmoke {
    root: THREE.Group;
    particles: SmokeParticle[];
    texture: THREE.Texture;
    active: boolean;
    qualityMode: 'quality' | 'performance';

    constructor(parent: THREE.Object3D) {
        this.root = new THREE.Group();
        this.root.name = 'race-drift-smoke-root';
        this.root.renderOrder = 3;
        parent.add(this.root);

        this.particles = [];
        this.texture = createSmokeTexture();
        this.active = false;
        this.qualityMode = 'quality';

        UIEventBus.on(
            'race:qualityChange',
            (state: { mode?: 'quality' | 'performance' } | undefined) => {
                this.qualityMode =
                    state?.mode === 'performance' ? 'performance' : 'quality';
            }
        );
    }

    setActive(active: boolean) {
        this.active = active;
        if (!active) {
            this.clear();
        }
    }

    clear() {
        this.particles.forEach((particle) => {
            this.root.remove(particle.sprite);
            particle.sprite.material.dispose();
        });
        this.particles = [];
    }

    getParticleLimit() {
        return this.qualityMode === 'performance'
            ? PERFORMANCE_PARTICLE_LIMIT
            : QUALITY_PARTICLE_LIMIT;
    }

    emit(position: THREE.Vector3, intensity: number, speedMps: number) {
        if (!this.active || intensity <= 0.05) return;
        if (this.particles.length >= this.getParticleLimit()) {
            const oldest = this.particles.shift();
            if (oldest) {
                this.root.remove(oldest.sprite);
                oldest.sprite.material.dispose();
            }
        }

        const material = new THREE.SpriteMaterial({
            map: this.texture,
            transparent: true,
            opacity: THREE.MathUtils.lerp(0.2, 0.55, intensity),
            depthWrite: false,
            depthTest: true,
            color: new THREE.Color(0xbec3c8),
        });

        const sprite = new THREE.Sprite(material);
        sprite.position.copy(position);

        const scale =
            THREE.MathUtils.lerp(0.65, 1.6, intensity) +
            Math.min(0.9, Math.abs(speedMps) * 0.02);
        sprite.scale.setScalar(scale);
        this.root.add(sprite);

        const velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.9,
            THREE.MathUtils.lerp(0.5, 2.2, intensity),
            (Math.random() - 0.5) * 0.9
        );

        this.particles.push({
            sprite,
            velocity,
            age: 0,
            life: THREE.MathUtils.lerp(0.5, 1.05, intensity),
            baseScale: scale,
        });
    }

    update(deltaSeconds: number) {
        if (this.particles.length === 0) return;

        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.age += deltaSeconds;

            if (particle.age >= particle.life) {
                this.root.remove(particle.sprite);
                particle.sprite.material.dispose();
                this.particles.splice(i, 1);
                continue;
            }

            particle.velocity.multiplyScalar(Math.pow(0.92, deltaSeconds * 60));
            particle.sprite.position.addScaledVector(particle.velocity, deltaSeconds);

            const lifeT = particle.age / particle.life;
            const opacity = Math.max(0, (1 - lifeT) * 0.55);
            (particle.sprite.material as THREE.SpriteMaterial).opacity = opacity;

            const scale = particle.baseScale * (1 + lifeT * 1.6);
            particle.sprite.scale.set(scale, scale, scale);
        }
    }
}

