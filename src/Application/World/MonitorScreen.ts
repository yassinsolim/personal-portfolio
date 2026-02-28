import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import GUI from 'lil-gui';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import Debug from '../Utils/Debug';
import Resources from '../Utils/Resources';
import Sizes from '../Utils/Sizes';
import Camera from '../Camera/Camera';
import EventEmitter from '../Utils/EventEmitter';

const SCREEN_SIZE = { w: 1280, h: 1024 };
const IFRAME_MARGIN_X = 44;
const IFRAME_MARGIN_Y = 40;
const IFRAME_SIZE = {
    w: SCREEN_SIZE.w - IFRAME_MARGIN_X * 2,
    h: SCREEN_SIZE.h - IFRAME_MARGIN_Y * 2,
};
const MONITOR_EDGE_LEEWAY_PX = 28;
const MONITOR_LEAVE_DEBOUNCE_MS = 180;

export default class MonitorScreen extends EventEmitter {
    application: Application;
    scene: THREE.Scene;
    cssScene: THREE.Scene;
    resources: Resources;
    debug: Debug;
    sizes: Sizes;
    debugFolder: GUI;
    screenSize: THREE.Vector2;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    camera: Camera;
    prevInComputer: boolean;
    shouldLeaveMonitor: boolean;
    inComputer: boolean;
    mouseClickInProgress: boolean;
    monitorIframe: HTMLIFrameElement | null;
    monitorContainer: HTMLDivElement | null;
    monitorCssObject: CSS3DObject | null;
    monitorSceneObjects: THREE.Object3D[];
    raceModeActive: boolean;
    leaveMonitorTimeoutId: number | null;
    dimmingPlane: THREE.Mesh;
    videoTextures: { [key in string]: THREE.VideoTexture };

    constructor() {
        super();
        this.application = new Application();
        this.scene = this.application.scene;
        this.cssScene = this.application.cssScene;
        this.sizes = this.application.sizes;
        this.resources = this.application.resources;
        this.screenSize = new THREE.Vector2(SCREEN_SIZE.w, SCREEN_SIZE.h);
        this.camera = this.application.camera;
        this.position = new THREE.Vector3(0, 950, 255);
        this.rotation = new THREE.Euler(-3 * THREE.MathUtils.DEG2RAD, 0, 0);
        this.videoTextures = {};
        this.prevInComputer = false;
        this.inComputer = false;
        this.mouseClickInProgress = false;
        this.shouldLeaveMonitor = false;
        this.monitorIframe = null;
        this.monitorContainer = null;
        this.monitorCssObject = null;
        this.monitorSceneObjects = [];
        this.raceModeActive = false;
        this.leaveMonitorTimeoutId = null;

        // Create screen
        this.bindRaceModeVisibility();
        this.initializeScreenEvents();
        this.createIframe();
        const maxOffset = this.createTextureLayers();
        this.createEnclosingPlanes(maxOffset);
        this.createPerspectiveDimmer(maxOffset);
        this.setMonitorVisualVisibility(true);
    }

    bindRaceModeVisibility() {
        UIEventBus.on(
            'raceMode:changed',
            (state: { active?: boolean } | undefined) => {
                const active = Boolean(state?.active);
                this.raceModeActive = active;
                this.setMonitorVisualVisibility(!active);
                if (active) {
                    this.clearPendingMonitorLeave();
                    this.inComputer = false;
                    this.prevInComputer = false;
                    this.mouseClickInProgress = false;
                    this.shouldLeaveMonitor = false;
                    this.camera.trigger('leftMonitor');
                }
            }
        );
    }

    setMonitorVisualVisibility(visible: boolean) {
        if (this.monitorCssObject) {
            this.monitorCssObject.visible = visible;
        }
        this.monitorSceneObjects.forEach((object) => {
            object.visible = visible;
        });

        if (this.monitorContainer) {
            this.monitorContainer.style.visibility = visible ? 'visible' : 'hidden';
            this.monitorContainer.style.pointerEvents = visible ? 'auto' : 'none';
        }

        if (this.monitorIframe) {
            this.monitorIframe.style.pointerEvents = visible ? 'auto' : 'none';
        }
    }

    initializeScreenEvents() {
        document.addEventListener(
            'mousemove',
            (event) => {
                this.inComputer = this.isMonitorPointerEvent(event);

                if (this.inComputer) {
                    this.clearPendingMonitorLeave();
                }

                if (this.inComputer && !this.prevInComputer) {
                    this.camera.trigger('enterMonitor');
                }

                if (
                    !this.inComputer &&
                    this.prevInComputer &&
                    !this.mouseClickInProgress
                ) {
                    this.scheduleMonitorLeave();
                }

                if (
                    !this.inComputer &&
                    this.mouseClickInProgress &&
                    this.prevInComputer
                ) {
                    this.shouldLeaveMonitor = true;
                } else if (this.inComputer) {
                    this.shouldLeaveMonitor = false;
                }

                this.application.mouse.trigger('mousemove', [event]);

                this.prevInComputer = this.inComputer;
            },
            false
        );
        document.addEventListener(
            'mousedown',
            (event) => {
                this.inComputer = this.isMonitorPointerEvent(event);
                this.application.mouse.trigger('mousedown', [event]);

                this.mouseClickInProgress = true;
                if (this.inComputer) {
                    this.clearPendingMonitorLeave();
                }
                this.prevInComputer = this.inComputer;
            },
            false
        );
        document.addEventListener(
            'mouseup',
            (event) => {
                this.inComputer = this.isMonitorPointerEvent(event);
                this.application.mouse.trigger('mouseup', [event]);

                if (this.shouldLeaveMonitor) {
                    this.scheduleMonitorLeave();
                    this.shouldLeaveMonitor = false;
                }

                this.mouseClickInProgress = false;
                this.prevInComputer = this.inComputer;
            },
            false
        );
    }

    isMonitorPointerEvent(event: MouseEvent & { inComputer?: boolean }) {
        if (this.raceModeActive) {
            return false;
        }

        if (Boolean(event.inComputer)) {
            return true;
        }

        const target = event.target as HTMLElement | null;
        if (target?.id === 'computer-screen' || target?.closest('#computer-screen')) {
            return true;
        }

        if (
            typeof event.clientX !== 'number' ||
            typeof event.clientY !== 'number' ||
            !Number.isFinite(event.clientX) ||
            !Number.isFinite(event.clientY)
        ) {
            return false;
        }

        return this.isWithinMonitorBounds(event.clientX, event.clientY);
    }

    isWithinMonitorBounds(clientX: number, clientY: number) {
        const iframe = this.monitorIframe;
        if (!iframe) return false;

        const rect = iframe.getBoundingClientRect();
        const pad = MONITOR_EDGE_LEEWAY_PX;
        return (
            clientX >= rect.left - pad &&
            clientX <= rect.right + pad &&
            clientY >= rect.top - pad &&
            clientY <= rect.bottom + pad
        );
    }

    scheduleMonitorLeave() {
        if (this.leaveMonitorTimeoutId !== null) {
            return;
        }

        this.leaveMonitorTimeoutId = window.setTimeout(() => {
            this.leaveMonitorTimeoutId = null;
            if (this.inComputer || this.mouseClickInProgress) {
                return;
            }
            this.camera.trigger('leftMonitor');
        }, MONITOR_LEAVE_DEBOUNCE_MS);
    }

    clearPendingMonitorLeave() {
        if (this.leaveMonitorTimeoutId === null) {
            return;
        }
        window.clearTimeout(this.leaveMonitorTimeoutId);
        this.leaveMonitorTimeoutId = null;
    }

    /**
     * Creates the iframe for the computer screen
     */
    createIframe() {
        // Create container
        const container = document.createElement('div') as HTMLDivElement;
        container.style.width = this.screenSize.width + 'px';
        container.style.height = this.screenSize.height + 'px';
        container.style.position = 'relative';
        container.style.overflow = 'hidden';
        container.style.borderRadius = '8px';
        container.style.opacity = '1';
        container.style.background = '#000000';
        container.style.backfaceVisibility = 'hidden';
        container.style.transformStyle = 'preserve-3d';
        this.monitorContainer = container;

        // Create iframe
        const iframe = document.createElement('iframe');

        // Set iframe attributes
        const productionSrc = 'https://os.yassin.app/?embed=1&quality=high';
        const localDevSrc = 'http://localhost:3000/';
        const urlParams = new URLSearchParams(window.location.search);
        const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(
            window.location.hostname
        );
        const iframeSrc =
            isLocalhost && urlParams.has('dev') ? localDevSrc : productionSrc;
        iframe.src = iframeSrc;
        iframe.setAttribute(
            'sandbox',
            'allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation'
        );
        iframe.setAttribute('referrerpolicy', 'no-referrer');

        /**
         * Use dev server if query params are present and we're on localhost.
         *
         * Warning: This will not work unless the dev server is running on localhost:3000
         * Also running the dev server causes browsers to flag the insecure iframe.
         */
        iframe.style.width = IFRAME_SIZE.w + 'px';
        iframe.style.height = IFRAME_SIZE.h + 'px';
        iframe.style.left = IFRAME_MARGIN_X + 'px';
        iframe.style.top = IFRAME_MARGIN_Y + 'px';
        iframe.style.position = 'absolute';
        iframe.style.boxSizing = 'border-box';
        iframe.style.opacity = '1';
        if (urlParams.has('crt')) {
            iframe.className = 'jitter';
        }
        iframe.id = 'computer-screen';
        iframe.frameBorder = '0';
        iframe.style.border = '0';
        iframe.style.transform = 'translateZ(0)';
        iframe.style.imageRendering = 'auto';
        iframe.style.backfaceVisibility = 'hidden';
        // iframe.title = 'yassinOS';
        this.monitorIframe = iframe;

        // Bubble mouse move events to the main application, so we can affect the camera
        const iframeOrigin = new URL(iframeSrc, window.location.href).origin;
        const allowedOrigins = new Set<string>([
            iframeOrigin,
            window.location.origin,
        ]);
        const allowedMessageTypes = new Set([
            'mousemove',
            'mousedown',
            'mouseup',
            'keydown',
            'keyup',
        ]);

        iframe.onload = () => {
            if (!iframe.contentWindow) {
                return;
            }

            window.addEventListener('message', (event: MessageEvent) => {
                if (!allowedOrigins.has(event.origin)) {
                    return;
                }

                if (
                    event.origin === iframeOrigin &&
                    event.source !== iframe.contentWindow
                ) {
                    return;
                }

                if (
                    event.origin === window.location.origin &&
                    event.source !== window
                ) {
                    return;
                }

                if (!event.data || typeof event.data !== 'object') {
                    return;
                }

                const data = event.data as {
                    type?: string;
                    clientX?: number;
                    clientY?: number;
                    key?: string;
                };

                if (!data.type || !allowedMessageTypes.has(data.type)) {
                    return;
                }

                var evt = new CustomEvent(data.type, {
                    bubbles: true,
                    cancelable: false,
                });

                // @ts-ignore
                evt.inComputer = true;
                if (data.type === 'mousemove') {
                    if (
                        typeof data.clientX !== 'number' ||
                        typeof data.clientY !== 'number' ||
                        !Number.isFinite(data.clientX) ||
                        !Number.isFinite(data.clientY)
                    ) {
                        return;
                    }

                    var clRect = iframe.getBoundingClientRect();
                    const { top, left, width, height } = clRect;
                    const widthRatio = width / IFRAME_SIZE.w;
                    const heightRatio = height / IFRAME_SIZE.h;

                    // @ts-ignore
                    evt.clientX = Math.round(
                        data.clientX * widthRatio + left
                    );
                    //@ts-ignore
                    evt.clientY = Math.round(
                        data.clientY * heightRatio + top
                    );
                } else if (data.type === 'keydown' || data.type === 'keyup') {
                    if (typeof data.key !== 'string') {
                        return;
                    }
                    // @ts-ignore
                    evt.key = data.key;
                }

                iframe.dispatchEvent(evt);
            });
        };

        // Add iframe to container
        container.appendChild(iframe);

        // Create CSS plane
        this.createCssPlane(container);
    }

    /**
     * Creates a CSS plane and GL plane to properly occlude the CSS plane
     * @param element the element to create the css plane for
     */
    createCssPlane(element: HTMLElement) {
        // Create CSS3D object
        const object = new CSS3DObject(element);

        // copy monitor position and rotation
        object.position.copy(this.position);
        object.rotation.copy(this.rotation);

        // Add to CSS scene
        this.cssScene.add(object);
        this.monitorCssObject = object;

        // Create GL plane
        const material = new THREE.MeshLambertMaterial();
        material.side = THREE.DoubleSide;
        material.opacity = 0;
        material.transparent = true;
        // NoBlending allows the GL plane to occlude the CSS plane
        material.blending = THREE.NoBlending;

        // Create plane geometry
        const geometry = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height
        );

        // Create the GL plane mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Copy the position, rotation and scale of the CSS plane to the GL plane
        mesh.position.copy(object.position);
        mesh.rotation.copy(object.rotation);
        mesh.scale.copy(object.scale);

        // Add to gl scene
        this.scene.add(mesh);
        this.monitorSceneObjects.push(mesh);
    }

    /**
     * Creates the texture layers for the computer screen
     * @returns the maximum offset of the texture layers
     */
    createTextureLayers() {
        const textures = this.resources.items.texture;

        this.getVideoTextures('video-1');
        this.getVideoTextures('video-2');

        // Scale factor to multiply depth offset by
        const scaleFactor = 4;

        // Construct the texture layers
        const layers = {
            smudge: {
                texture: textures.monitorSmudgeTexture,
                blending: THREE.AdditiveBlending,
                opacity: 0.12,
                offset: 24,
            },
            innerShadow: {
                texture: textures.monitorShadowTexture,
                blending: THREE.NormalBlending,
                opacity: 1,
                offset: 5,
            },
            video: {
                texture: this.videoTextures['video-1'],
                blending: THREE.AdditiveBlending,
                opacity: 0.5,
                offset: 10,
            },
            video2: {
                texture: this.videoTextures['video-2'],
                blending: THREE.AdditiveBlending,
                opacity: 0.1,
                offset: 15,
            },
        };

        // Declare max offset
        let maxOffset = -1;

        // Add the texture layers to the screen
        for (const [_, layer] of Object.entries(layers)) {
            const offset = layer.offset * scaleFactor;
            this.addTextureLayer(
                layer.texture,
                layer.blending,
                layer.opacity,
                offset
            );
            // Calculate the max offset
            if (offset > maxOffset) maxOffset = offset;
        }

        // Return the max offset
        return maxOffset;
    }

    getVideoTextures(videoId: string) {
        const video = document.getElementById(videoId);
        if (!video) {
            setTimeout(() => {
                this.getVideoTextures(videoId);
            }, 100);
        } else {
            this.videoTextures[videoId] = new THREE.VideoTexture(
                video as HTMLVideoElement
            );
        }
    }

    /**
     * Adds a texture layer to the screen
     * @param texture the texture to add
     * @param blending the blending mode
     * @param opacity the opacity of the texture
     * @param offset the offset of the texture, higher values are further from the screen
     */
    addTextureLayer(
        texture: THREE.Texture,
        blendingMode: THREE.Blending,
        opacity: number,
        offset: number
    ) {
        // Create material
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            blending: blendingMode,
            side: THREE.DoubleSide,
            opacity,
            transparent: true,
        });

        // Create geometry
        const geometry = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height
        );

        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Copy position and apply the depth offset
        mesh.position.copy(
            this.offsetPosition(this.position, new THREE.Vector3(0, 0, offset))
        );

        // Copy rotation
        mesh.rotation.copy(this.rotation);

        this.scene.add(mesh);
        this.monitorSceneObjects.push(mesh);
    }

    /**
     * Creates enclosing planes for the computer screen
     * @param maxOffset the maximum offset of the texture layers
     */
    createEnclosingPlanes(maxOffset: number) {
        // Create planes, lots of boiler plate code here because I'm lazy
        const planes = {
            left: {
                size: new THREE.Vector2(maxOffset, this.screenSize.height),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        -this.screenSize.width / 2,
                        0,
                        maxOffset / 2
                    )
                ),
                rotation: new THREE.Euler(0, 90 * THREE.MathUtils.DEG2RAD, 0),
            },
            right: {
                size: new THREE.Vector2(maxOffset, this.screenSize.height),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        this.screenSize.width / 2,
                        0,
                        maxOffset / 2
                    )
                ),
                rotation: new THREE.Euler(0, 90 * THREE.MathUtils.DEG2RAD, 0),
            },
            top: {
                size: new THREE.Vector2(this.screenSize.width, maxOffset),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        0,
                        this.screenSize.height / 2,
                        maxOffset / 2
                    )
                ),
                rotation: new THREE.Euler(90 * THREE.MathUtils.DEG2RAD, 0, 0),
            },
            bottom: {
                size: new THREE.Vector2(this.screenSize.width, maxOffset),
                position: this.offsetPosition(
                    this.position,
                    new THREE.Vector3(
                        0,
                        -this.screenSize.height / 2,
                        maxOffset / 2
                    )
                ),
                rotation: new THREE.Euler(90 * THREE.MathUtils.DEG2RAD, 0, 0),
            },
        };

        // Add each of the planes
        for (const [_, plane] of Object.entries(planes)) {
            this.createEnclosingPlane(plane);
        }
    }

    /**
     * Creates a plane for the enclosing planes
     * @param plane the plane to create
     */
    createEnclosingPlane(plane: EnclosingPlane) {
        const material = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            color: 0x48493f,
        });

        const geometry = new THREE.PlaneGeometry(plane.size.x, plane.size.y);
        const mesh = new THREE.Mesh(geometry, material);

        mesh.position.copy(plane.position);
        mesh.rotation.copy(plane.rotation);

        this.scene.add(mesh);
        this.monitorSceneObjects.push(mesh);
    }

    createPerspectiveDimmer(maxOffset: number) {
        const material = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            color: 0x000000,
            transparent: true,
            blending: THREE.AdditiveBlending,
        });

        const plane = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height
        );

        const mesh = new THREE.Mesh(plane, material);

        mesh.position.copy(
            this.offsetPosition(
                this.position,
                new THREE.Vector3(0, 0, maxOffset - 5)
            )
        );

        mesh.rotation.copy(this.rotation);

        this.dimmingPlane = mesh;

        this.scene.add(mesh);
        this.monitorSceneObjects.push(mesh);
    }

    /**
     * Offsets a position vector by another vector
     * @param position the position to offset
     * @param offset the offset to apply
     * @returns the new offset position
     */
    offsetPosition(position: THREE.Vector3, offset: THREE.Vector3) {
        const newPosition = new THREE.Vector3();
        newPosition.copy(position);
        newPosition.add(offset);
        return newPosition;
    }

    update() {
        if (this.raceModeActive) {
            return;
        }

        if (this.dimmingPlane) {
            const planeNormal = new THREE.Vector3(0, 0, 1);
            const viewVector = new THREE.Vector3();
            viewVector.copy(this.camera.instance.position);
            viewVector.sub(this.position);
            viewVector.normalize();

            const dot = viewVector.dot(planeNormal);

            // calculate the distance from the camera vector to the plane vector
            const dimPos = this.dimmingPlane.position;
            const camPos = this.camera.instance.position;

            const distance = Math.sqrt(
                (camPos.x - dimPos.x) ** 2 +
                    (camPos.y - dimPos.y) ** 2 +
                    (camPos.z - dimPos.z) ** 2
            );

            const opacity = 1 / (distance / 10000);

            const DIM_FACTOR = 0.7;

            // @ts-ignore
            this.dimmingPlane.material.opacity =
                (1 - opacity) * DIM_FACTOR + (1 - dot) * DIM_FACTOR;
        }
    }
}
