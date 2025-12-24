import * as THREE from 'three';
import type Application from '../Application';
import {
    downloadGLB,
    exportSceneToGLB,
    saveGLBToEndpoint,
} from './SceneExporter';

type ExportFlags = {
    exportOnLoad: boolean;
    saveToDisk: boolean;
    downloadFile: boolean;
    showButton: boolean;
};

type TextureSwap = {
    material: THREE.Material;
    key: string;
    texture: THREE.Texture;
    reason: string;
};

type ExportState = {
    textureSwaps: TextureSwap[];
    exportCamera?: THREE.PerspectiveCamera;
    animationClip?: THREE.AnimationClip;
    runtimeCamera?: THREE.Camera;
    runtimeCameraParent?: THREE.Object3D | null;
};

const EXPORT_FILENAME = 'exported-scene.glb';
const SAVE_ENDPOINT = '/api/save-glb';
const EXPORT_DURATION_SECONDS = 10;
const EXPORT_FPS = 60;

export default class SceneExportController {
    application: Application;
    resourcesReady: boolean;
    exportQueued: boolean;
    hasExported: boolean;
    flags: ExportFlags;
    exportButton?: HTMLButtonElement;

    constructor(application: Application) {
        this.application = application;
        this.resourcesReady = false;
        this.exportQueued = false;
        this.hasExported = false;
        this.flags = this.getFlags();

        if (this.flags.showButton) {
            this.createButton();
        }

        this.registerResourceReady();
    }

    private getFlags(): ExportFlags {
        const params = new URLSearchParams(window.location.search);
        const exportOnLoad = params.has('export');
        const saveToDisk = params.has('save');
        const downloadFile = !saveToDisk || params.has('download');
        const showButton =
            params.has('export-ui') ||
            params.has('exportUi') ||
            params.has('debug');

        return { exportOnLoad, saveToDisk, downloadFile, showButton };
    }

    private registerResourceReady() {
        const resources = this.application.resources;

        if (resources.loaded === resources.toLoad) {
            this.handleResourcesReady();
            return;
        }

        resources.on('ready', () => {
            this.handleResourcesReady();
        });
    }

    private handleResourcesReady() {
        if (this.resourcesReady) {
            return;
        }

        this.resourcesReady = true;

        if (this.exportButton) {
            this.exportButton.disabled = false;
        }

        if (this.flags.exportOnLoad) {
            this.exportOnce('auto');
        }

        if (this.exportQueued) {
            this.exportOnce('button');
        }
    }

    private createButton() {
        if (document.getElementById('export-glb-button')) {
            return;
        }

        const button = document.createElement('button');
        button.id = 'export-glb-button';
        button.type = 'button';
        button.className = 'export-glb-button';
        button.textContent = 'Export GLB';
        button.disabled = !this.resourcesReady;
        button.addEventListener('click', () => {
            if (!this.resourcesReady) {
                this.exportQueued = true;
                return;
            }

            this.exportOnce('button');
        });

        document.body.appendChild(button);
        this.exportButton = button;
    }

    private async exportOnce(source: string) {
        if (this.hasExported) {
            return;
        }

        this.hasExported = true;

        try {
            await this.waitForSceneReady();

            const scene = this.application.scene;
            scene.updateMatrixWorld(true);

            const exportState = this.prepareSceneForExport(scene);
            const stats = this.collectSceneStats(scene);
            console.info(`[SceneExport] ${source} export`, stats);

            try {
                const animationClips = exportState.animationClip
                    ? [exportState.animationClip]
                    : undefined;
                const buffer = await exportSceneToGLB(scene, {
                    animations: animationClips,
                });
                console.info(`[SceneExport] exported ${buffer.byteLength} bytes`);

                if (this.flags.saveToDisk) {
                    try {
                        const response = await saveGLBToEndpoint(
                            buffer,
                            SAVE_ENDPOINT
                        );
                        console.info('[SceneExport] saved to disk', response);
                    } catch (error) {
                        console.error('[SceneExport] save failed', error);
                    }
                }

                if (this.flags.downloadFile) {
                    downloadGLB(buffer, EXPORT_FILENAME);
                }
            } finally {
                this.restoreSceneAfterExport(exportState);
            }
        } catch (error) {
            console.error('[SceneExport] export failed', error);
        }
    }

    private async waitForSceneReady() {
        await this.waitForNextFrame();
        await this.waitForNextFrame();
    }

    private waitForNextFrame(): Promise<void> {
        return new Promise((resolve) => {
            requestAnimationFrame(() => resolve());
        });
    }

    private prepareSceneForExport(scene: THREE.Scene): ExportState {
        const swaps: TextureSwap[] = [];
        const skipped: { [reason: string]: number } = {};
        const exportState: ExportState = { textureSwaps: swaps };

        scene.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) {
                return;
            }

            const meshMaterials = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material];

            meshMaterials.forEach((material) => {
                if (!material) {
                    return;
                }

                const materialProps =
                    material as unknown as Record<string, unknown>;

                for (const key in materialProps) {
                    const value = materialProps[key];
                    const texture = value as THREE.Texture;

                    if (!texture || !texture.isTexture) {
                        continue;
                    }

                    const reason = this.getTextureSkipReason(texture);
                    if (!reason) {
                        continue;
                    }

                    swaps.push({ material, key, texture, reason });
                    materialProps[key] = null;
                    skipped[reason] = (skipped[reason] || 0) + 1;
                }
            });
        });

        if (Object.keys(skipped).length > 0) {
            console.warn('[SceneExport] skipped textures', skipped);
        }

        const runtimeCamera = this.application.camera.instance;
        if (runtimeCamera) {
            exportState.runtimeCamera = runtimeCamera;
            exportState.runtimeCameraParent = runtimeCamera.parent || scene;
            runtimeCamera.removeFromParent();
        }

        const { camera, clip } = this.buildIdleExportCamera();
        exportState.exportCamera = camera;
        exportState.animationClip = clip;
        scene.add(camera);

        return exportState;
    }

    private restoreSceneAfterExport(state: ExportState) {
        state.textureSwaps.forEach((swap) => {
            const materialProps =
                swap.material as unknown as Record<string, unknown>;
            materialProps[swap.key] = swap.texture;
        });

        if (state.exportCamera) {
            state.exportCamera.removeFromParent();
        }

        if (state.runtimeCamera) {
            const parent = state.runtimeCameraParent || this.application.scene;
            parent.add(state.runtimeCamera);
        }
    }

    private buildIdleExportCamera() {
        const sourceCamera = this.application.camera.instance;
        const exportCamera = sourceCamera.clone() as THREE.PerspectiveCamera;
        exportCamera.name = 'ExportCamera';
        exportCamera.aspect =
            this.application.sizes.width / this.application.sizes.height;
        exportCamera.updateProjectionMatrix();

        const origin = new THREE.Vector3(-20000, 12000, 20000);
        const focalPoint = new THREE.Vector3(0, -1000, 0);
        const sampleCount = Math.max(
            2,
            Math.floor(EXPORT_DURATION_SECONDS * EXPORT_FPS) + 1
        );

        const times = new Array<number>(sampleCount);
        const positions = new Array<number>(sampleCount * 3);
        const quaternions = new Array<number>(sampleCount * 4);

        for (let i = 0; i < sampleCount; i += 1) {
            const timeSeconds = i / EXPORT_FPS;
            const timeMs = timeSeconds * 1000;

            const position = new THREE.Vector3(
                Math.sin((timeMs + 19000) * 0.00008) * origin.x,
                Math.sin((timeMs + 1000) * 0.000004) * 4000 +
                    origin.y -
                    3000,
                origin.z
            );

            exportCamera.position.copy(position);
            exportCamera.lookAt(focalPoint);
            exportCamera.updateMatrixWorld(true);

            times[i] = timeSeconds;
            position.toArray(positions, i * 3);
            exportCamera.quaternion.toArray(quaternions, i * 4);
        }

        exportCamera.position.fromArray(positions, 0);
        exportCamera.quaternion.fromArray(quaternions, 0);
        exportCamera.updateMatrixWorld(true);

        const positionTrack = new THREE.VectorKeyframeTrack(
            `${exportCamera.name}.position`,
            times,
            positions
        );
        const quaternionTrack = new THREE.QuaternionKeyframeTrack(
            `${exportCamera.name}.quaternion`,
            times,
            quaternions
        );

        const clip = new THREE.AnimationClip('IdleCameraPan', -1, [
            positionTrack,
            quaternionTrack,
        ]);
        clip.resetDuration();

        return { camera: exportCamera, clip };
    }

    private getTextureSkipReason(texture: THREE.Texture): string | null {
        const image = texture.image as any;
        const textureAny = texture as any;

        if (textureAny.isVideoTexture) {
            return 'video-texture';
        }

        if (textureAny.isCubeTexture) {
            return 'cube-texture';
        }

        if (Array.isArray(image)) {
            return 'array-image';
        }

        if (!image) {
            return 'missing-image';
        }

        const size = this.getTextureImageSize(image);
        if (!size) {
            return 'unknown-image-size';
        }

        if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) {
            return 'invalid-image-size';
        }

        if (size.width <= 0 || size.height <= 0) {
            return 'invalid-image-size';
        }

        if (
            typeof HTMLVideoElement !== 'undefined' &&
            image instanceof HTMLVideoElement
        ) {
            return 'video-texture';
        }

        return null;
    }

    private getTextureImageSize(image: any) {
        if (!image) {
            return null;
        }

        if (
            typeof HTMLImageElement !== 'undefined' &&
            image instanceof HTMLImageElement
        ) {
            if (
                image.width <= 0 &&
                image.naturalWidth > 0 &&
                image.naturalHeight > 0
            ) {
                image.width = image.naturalWidth;
                image.height = image.naturalHeight;
            }
        }

        if (typeof image.width === 'number' && typeof image.height === 'number') {
            return { width: image.width, height: image.height };
        }

        if (
            typeof image.videoWidth === 'number' &&
            typeof image.videoHeight === 'number'
        ) {
            return { width: image.videoWidth, height: image.videoHeight };
        }

        if (
            typeof image.naturalWidth === 'number' &&
            typeof image.naturalHeight === 'number'
        ) {
            return { width: image.naturalWidth, height: image.naturalHeight };
        }

        return null;
    }

    private collectSceneStats(scene: THREE.Scene) {
        let nodes = 0;
        let meshes = 0;
        const materials = new Set<THREE.Material>();
        const textures = new Set<THREE.Texture>();

        scene.traverse((child) => {
            nodes += 1;

            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) {
                return;
            }

            meshes += 1;

            const meshMaterials = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material];

            meshMaterials.forEach((material) => {
                if (!material) {
                    return;
                }

                materials.add(material);

                const materialProps =
                    material as unknown as Record<string, unknown>;

                for (const key in materialProps) {
                    const value = materialProps[key];
                    const texture = value as THREE.Texture;
                    if (texture && texture.isTexture) {
                        textures.add(texture);
                    }
                }
            });
        });

        return {
            nodes,
            meshes,
            materials: materials.size,
            textures: textures.size,
        };
    }
}
