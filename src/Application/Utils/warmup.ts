import * as THREE from 'three';
import Application from '../Application';

// for the loading screens that show this work: compiles the room's shaders
// (in parallel where the browser has KHR_parallel_shader_compile) and
// uploads its textures one a frame, reporting each to Loading. the room
// isn't drawn meanwhile, so no frame has to do it all at once like the
// first frame after the build otherwise does. resolves when a frame of the
// room can draw without compiling or uploading

type ProgramInfo = { id: number; type: string; name: string; isReady: () => boolean };

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

const fileName = (texture: THREE.Texture) => {
    const image = texture.image as { src?: string; currentSrc?: string } | undefined;
    const src = image?.currentSrc || image?.src || '';
    if (src && !src.startsWith('blob:') && !src.startsWith('data:')) {
        return decodeURIComponent(src.split('/').pop() || src);
    }
    return texture.name || 'embedded texture';
};

const texturesIn = (scene: THREE.Object3D) => {
    const found = new Set<THREE.Texture>();
    scene.traverseVisible((object) => {
        const material = (object as THREE.Mesh).material;
        if (!material) return;
        (Array.isArray(material) ? material : [material]).forEach((m) => {
            Object.values(m).forEach((value) => {
                const texture = value as THREE.Texture | null;
                if (
                    texture &&
                    texture.isTexture &&
                    !(texture as THREE.CubeTexture).isCubeTexture &&
                    !(texture as unknown as { isRenderTargetTexture?: boolean })
                        .isRenderTargetTexture
                ) {
                    found.add(texture);
                }
            });
        });
    });
    return [...found];
};

// a jpg's decode is most of its upload. createImageBitmap decodes off the
// main thread, with the same pixels three's own upload would take: no color
// conversion (three turns it off for srgb textures), the texture's flip and
// alpha, which webgl ignores for bitmaps
const decodeOffThread = (texture: THREE.Texture): Promise<ImageBitmap | null> => {
    const image = texture.image as HTMLImageElement | undefined;
    if (
        typeof createImageBitmap === 'undefined' ||
        typeof HTMLImageElement === 'undefined' ||
        !(image instanceof HTMLImageElement) ||
        !image.complete ||
        !image.naturalWidth
    ) {
        return Promise.resolve(null);
    }
    const options = (orientation: string) =>
        ({
            imageOrientation: texture.flipY ? 'flipY' : orientation,
            premultiplyAlpha: texture.premultiplyAlpha ? 'premultiply' : 'none',
            colorSpaceConversion: 'none',
        }) as ImageBitmapOptions;
    // 'from-image' is the newer name for 'none'
    return createImageBitmap(image, options('from-image'))
        .catch(() => createImageBitmap(image, options('none')))
        .catch(() => null);
};

const upload = (
    renderer: THREE.WebGLRenderer,
    texture: THREE.Texture,
    bitmap: ImageBitmap | null
) => {
    if (!bitmap) {
        renderer.initTexture(texture);
        return;
    }
    // upload from the bitmap, then point the texture back at its image so a
    // later re-upload (context restore) still has a source
    const image = texture.image;
    texture.image = bitmap;
    try {
        renderer.initTexture(texture);
    } finally {
        texture.image = image;
        bitmap.close();
    }
};

// one draw of the whole room into a single pixel of the canvas: uploads
// every mesh's buffers and runs each program's first use (uniform lookups)
// now instead of on the first frames that show them. same canvas, so the
// same program variants; the next frame clears that pixel
const prime = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, view: THREE.Camera) => {
    const test = renderer.getScissorTest();
    const rect = renderer.getScissor(new THREE.Vector4());
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, 1, 1);
    try {
        renderer.render(scene, view);
    } finally {
        renderer.setScissor(rect);
        renderer.setScissorTest(test);
    }
};

export type WarmUpOptions = {
    // a camera that sees the whole room, when the loading screen's own camera
    // doesn't (the monitor boot looks at the screen only)
    primeView?: THREE.Camera;
    // keep the room off screen meanwhile (default). the pipeline loader draws
    // its own stand in materials instead, and swaps the real ones in only
    // around the compile, the texture list and the prime draw
    hold?: boolean;
    swap?: () => () => void;
};

export const warmUp = async (camera: THREE.Camera, options: WarmUpOptions = {}) => {
    const application = new Application();
    const renderer = application.renderer.instance;
    const scene = application.scene;
    const loading = application.loading;
    const hold = options.hold !== false;
    const withReal = <T>(fn: () => T): T => {
        const restore = options.swap?.();
        try {
            return fn();
        } finally {
            restore?.();
        }
    };
    if (hold) application.renderer.holdScene = true;
    try {
        // compile: issue every program now, then report each as it's ready
        loading.stageStart('compile');
        const startedAt = performance.now();
        const before = new Set(
            (renderer.info.programs as unknown as ProgramInfo[]).map((p) => p.id)
        );
        const found = withReal(() => {
            renderer.compile(scene, camera);
            return texturesIn(scene);
        });
        const pending = (renderer.info.programs as unknown as ProgramInfo[]).filter(
            (p) => !before.has(p.id)
        );
        const total = pending.length;

        // upload: decode everything off thread at once, then one texture a
        // frame as its bitmap comes in, while the programs compile
        loading.stageStart('upload');
        const textures: (THREE.Texture | null)[] = found;
        const count = textures.length;
        const bitmaps: (ImageBitmap | null | undefined)[] = textures.map(() => undefined);
        textures.forEach((texture, i) => {
            void decodeOffThread(texture as THREE.Texture).then((bitmap) => {
                bitmaps[i] = bitmap;
            });
        });
        let uploaded = 0;

        // a driver that never reports ready shouldn't hold the page: after
        // this the first frame just waits on whatever is left
        const giveUpAt = startedAt + 8000;
        while ((pending.length || uploaded < count) && performance.now() < giveUpAt) {
            for (let i = pending.length - 1; i >= 0; i--) {
                if (!pending[i].isReady()) continue;
                const program = pending.splice(i, 1)[0];
                loading.item(
                    'compile',
                    program.type || 'program',
                    performance.now() - startedAt,
                    program.name || ''
                );
            }
            if (!pending.length) loading.stageDone('compile', total);
            // a 4k texture is a frame on its own (the copy to the gpu, not the
            // decode, is most of it), small ones share a frame
            const frameStart = performance.now();
            for (;;) {
                const next = bitmaps.findIndex((bitmap, i) => bitmap !== undefined && textures[i]);
                if (next < 0) break;
                const bitmap = bitmaps[next] ?? null;
                const texture = textures[next] as THREE.Texture;
                textures[next] = null;
                uploaded++;
                const t0 = performance.now();
                upload(renderer, texture, bitmap);
                const image = texture.image as { width?: number; height?: number } | undefined;
                loading.item(
                    'upload',
                    fileName(texture),
                    performance.now() - t0,
                    image?.width ? `${image.width}x${image.height}` : ''
                );
                if (uploaded === count) loading.stageDone('upload', count);
                if (performance.now() - frameStart > 8) break;
            }
            await nextFrame();
        }
        loading.stageDone('compile', total);
        loading.stageDone('upload', count);
        withReal(() => prime(renderer, scene, options.primeView || camera));
    } finally {
        if (hold) application.renderer.holdScene = false;
    }
};
