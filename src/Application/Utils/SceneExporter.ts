import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { GLTFExporterOptions } from 'three/examples/jsm/exporters/GLTFExporter.js';

const DEFAULT_EXPORT_OPTIONS: GLTFExporterOptions = {
    binary: true,
    embedImages: true,
    onlyVisible: false,
};

const exportSceneToGLB = (
    scene: THREE.Scene,
    options?: GLTFExporterOptions
): Promise<ArrayBuffer> => {
    scene.updateMatrixWorld(true);

    const exporter = new GLTFExporter();
    const exportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };

    return new Promise((resolve, reject) => {
        try {
            exporter.parse(
                scene,
                (result) => {
                    if (result instanceof ArrayBuffer) {
                        resolve(result);
                        return;
                    }

                    try {
                        const json = JSON.stringify(result);
                        const buffer = new TextEncoder().encode(json).buffer;
                        resolve(buffer);
                    } catch (error) {
                        reject(error);
                    }
                },
                exportOptions
            );
        } catch (error) {
            reject(error);
        }
    });
};

const downloadGLB = (buffer: ArrayBuffer, filename: string) => {
    const blob = new Blob([buffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 0);
};

const saveGLBToEndpoint = async (
    buffer: ArrayBuffer,
    endpoint: string
): Promise<any> => {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
    });

    if (!response.ok) {
        throw new Error(`Save failed with status ${response.status}`);
    }

    try {
        return await response.json();
    } catch {
        return { ok: true };
    }
};

export { exportSceneToGLB, downloadGLB, saveGLBToEndpoint };
