import * as THREE from 'three';
import Application from '../../Application';
import UIEventBus from '../../UI/EventBus';
import RaceVehicle from '../Vehicle/RaceVehicle';
import { probeHood, type HoodSpot } from './hoodProbe';
import { readGraphicsOff, type GraphicsOption } from '../Visuals/graphicsOptions';

const MOUSE_SENSITIVITY_X = 0.0022;
const MOUSE_SENSITIVITY_Y = 0.0016;
const MIN_PITCH = -0.35;
const MAX_PITCH = 0.28;
const RACE_CAMERA_NEAR = 0.1;
const RACE_CAMERA_FAR = 16000;
const POINTER_LOCK_PENDING_TIMEOUT_MS = 650;
// mouse look drifts back behind the car after this long without input
const LOOK_RETURN_DELAY_S = 1.4;
// how far the pad's right stick turns the view, full over
const PAD_LOOK_YAW = 2.2;
const PAD_LOOK_PITCH = 0.35;
const REFERENCE_CAR_LENGTH = 4.7;
// photo mode moves in m/s, shift for fast, and stays this close to the car
const PHOTO_SPEED = 4;
const PHOTO_FAST = 14;
const PHOTO_REACH = 60;

type CameraView = {
    name: string;
    distance: number;
    height: number;
    lookHeight: number;
    lookAhead: number;
    fov: number;
    // how far the view swings toward the direction of travel in a slide
    slideFollow: number;
    mounted: boolean;
    // hood cam: back from the nose as a share of the length, up as a share
    // of the height, so it lands on the hood of any car
    hood?: { back: number; up: number };
};

// chase is low and close so the road streams past, far shows more of the
// car, bumper sits on the nose
const VIEWS: CameraView[] = [
    {
        name: 'chase',
        distance: 6.3,
        height: 1.85,
        lookHeight: 1.05,
        lookAhead: 5.5,
        fov: 62,
        slideFollow: 0.42,
        mounted: false,
    },
    {
        name: 'far',
        distance: 9.4,
        height: 2.9,
        lookHeight: 1.25,
        lookAhead: 7.5,
        fov: 58,
        slideFollow: 0.32,
        mounted: false,
    },
    {
        name: 'bumper',
        distance: -0.2,
        height: 0.72,
        lookHeight: 0.62,
        lookAhead: 20,
        fov: 70,
        slideFollow: 0,
        mounted: true,
    },
    {
        name: 'hood',
        distance: 0,
        height: 0,
        lookHeight: 0,
        lookAhead: 22,
        fov: 66,
        slideFollow: 0,
        mounted: true,
        hood: { back: 0.27, up: 0.78 },
    },
];
const VIEW_STORAGE_KEY = 'yassinverse:nordschleife:cameraView:v1';

// where a mounted view sits on the car, from its anchor: along is forward, up
// is up. the hood cam uses the spot probed on the body when it has one
const mountOf = (
    view: CameraView,
    body: THREE.Vector3,
    rideHeight: number,
    spot: HoodSpot | null
) => {
    if (!view.hood) {
        return {
            along: body.z * 0.5 + view.distance,
            up: view.height - rideHeight,
            lookUp: view.lookHeight - rideHeight,
        };
    }
    if (spot) return { along: spot.along, up: spot.up, lookUp: spot.up - 0.1 };
    const up = body.y * view.hood.up - rideHeight;
    return { along: body.z * (0.5 - view.hood.back), up, lookUp: up - 0.1 };
};

// critically damped spring toward a target, frame rate independent
const spring = (
    value: number,
    velocity: number,
    target: number,
    omega: number,
    dt: number
): [number, number] => {
    const x = omega * dt;
    const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = value - target;
    const temp = (velocity + omega * change) * dt;
    const nextVelocity = (velocity - omega * temp) * decay;
    const nextValue = target + (change + temp) * decay;
    return [nextValue, nextVelocity];
};

// smooth noise for shake: a few detuned sines, cheap and never repeats in play
const wobble = (time: number, seed: number) =>
    Math.sin(time * 1.9 + seed) * 0.5 +
    Math.sin(time * 4.3 + seed * 2.1) * 0.3 +
    Math.sin(time * 9.7 + seed * 3.7) * 0.2;

const wrapAngle = (angle: number) =>
    Math.atan2(Math.sin(angle), Math.cos(angle));

export default class RaceChaseCamera {
    application: Application;
    vehicle: RaceVehicle;
    active: boolean;
    paused: boolean;
    pointerLocked: boolean;
    pointerLockRequestPending: boolean;
    yawOffset: number;
    pitchOffset: number;
    lookIdle: number;
    viewIndex: number;
    farOverride = 0;
    garage = false;
    // where the car stands in the garage scene, when it's there
    garageAnchor: THREE.Vector3 | null = null;
    garageAngle = 0;
    garagePitch = 0;
    garageDragIdle = 10;
    // the screen area the garage panel leaves free, in css pixels
    garageFrame: { x: number; y: number; width: number; height: number } | null = null;
    // photo mode: a free orbit around the paused car
    photo = false;
    photoAngle = 0;
    photoPitch = 0.12;
    photoZoom = 1;
    photoFov = 50;
    // photo mode: where the orbit's center has been moved to, off the car,
    // and the way it's moving (right, up, forward, each -1..1)
    photoPan = new THREE.Vector3();
    photoMove = { x: 0, y: 0, z: 0, fast: false };
    // a board lap being watched: the camera follows its car instead of yours,
    // dragged round it and zoomed
    watchTarget: THREE.Object3D | null = null;
    watchLength = REFERENCE_CAR_LENGTH;
    watchAngle = 0;
    watchPitch = 0;
    watchZoom = 1;
    // advanced graphics switches
    shakeOff = readGraphicsOff().includes('shake');
    speedFovOff = readGraphicsOff().includes('speedFov');
    // our own exitPointerLock, not the player's esc
    releasing = false;
    // the hood cam's spot, probed once per car model
    hoodCache: { model: THREE.Object3D | null; spot: HoodSpot | null } = {
        model: null,
        spot: null,
    };
    defaultFov: number;
    defaultNear: number;
    defaultFar: number;
    time: number;
    initialized: boolean;
    heading: number;
    headingVelocity: number;
    distance: number;
    distanceVelocity: number;
    height: number;
    heightVelocity: number;
    fov: number;
    fovVelocity: number;
    lookY: number;
    lookYVelocity: number;
    impactShake: number;
    lastImpact: number;
    shakeOffset: THREE.Vector3;
    tmpForward: THREE.Vector3;
    tmpSide: THREE.Vector3;
    tmpAnchor: THREE.Vector3;
    tmpPosition: THREE.Vector3;
    tmpLook: THREE.Vector3;
    tmpUp: THREE.Vector3;
    keyDownHandler: (event: KeyboardEvent) => void;
    viewKeyHandler: (event: KeyboardEvent) => void;
    mouseDownHandler: (event: MouseEvent) => void;
    mouseMoveHandler: (event: MouseEvent) => void;
    pointerLockChangeHandler: () => void;
    pointerLockErrorHandler: () => void;
    blurHandler: () => void;
    pointerLockPendingTimeoutId: number | null;

    constructor(vehicle: RaceVehicle) {
        this.application = new Application();
        this.vehicle = vehicle;
        this.active = false;
        this.paused = false;
        this.pointerLocked = false;
        this.pointerLockRequestPending = false;
        this.yawOffset = 0;
        this.pitchOffset = 0;
        this.lookIdle = 0;
        this.viewIndex = this.readStoredView();
        this.defaultFov = this.application.camera.instance.fov;
        this.defaultNear = this.application.camera.instance.near;
        this.defaultFar = this.application.camera.instance.far;
        this.time = 0;
        this.initialized = false;
        this.heading = 0;
        this.headingVelocity = 0;
        this.distance = VIEWS[0].distance;
        this.distanceVelocity = 0;
        this.height = VIEWS[0].height;
        this.heightVelocity = 0;
        this.fov = VIEWS[0].fov;
        this.fovVelocity = 0;
        this.lookY = 0;
        this.lookYVelocity = 0;
        this.impactShake = 0;
        this.lastImpact = 0;
        this.shakeOffset = new THREE.Vector3();
        this.tmpForward = new THREE.Vector3();
        this.tmpSide = new THREE.Vector3();
        this.tmpAnchor = new THREE.Vector3();
        this.tmpPosition = new THREE.Vector3();
        this.tmpLook = new THREE.Vector3();
        this.tmpUp = new THREE.Vector3();
        this.pointerLockPendingTimeoutId = null;

        this.viewKeyHandler = (event: KeyboardEvent) => {
            if (!this.active || this.paused || event.repeat) return;
            if (event.code !== 'KeyC') return;
            const target = event.target as HTMLElement | null;
            const tag = (target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select')
                return;
            this.cycleView();
        };
        document.addEventListener('keydown', this.viewKeyHandler);
        UIEventBus.on('race:garageOrbit', (state: { dx?: number; dy?: number } | undefined) => {
            this.garageAngle -= (state?.dx || 0) * 0.008;
            this.garagePitch = Math.min(0.6, Math.max(-0.25, this.garagePitch + (state?.dy || 0) * 0.004));
            this.garageDragIdle = 0;
        });
        UIEventBus.on('race:garageFrame', (frame: RaceChaseCamera['garageFrame']) => {
            this.garageFrame = frame && frame.width > 0 && frame.height > 0 ? frame : null;
        });
        UIEventBus.on('race:photoOrbit', (state: { dx?: number; dy?: number } | undefined) => {
            this.photoAngle -= (state?.dx || 0) * 0.008;
            this.photoPitch = Math.min(1.3, Math.max(-0.2, this.photoPitch + (state?.dy || 0) * 0.005));
        });
        UIEventBus.on('race:photoZoom', (state: { delta?: number } | undefined) => {
            const zoom = this.photoZoom * Math.exp((state?.delta || 0) * 0.0015);
            this.photoZoom = Math.min(4, Math.max(0.4, zoom));
        });
        UIEventBus.on('race:photoFov', (state: { fov?: number } | undefined) => {
            this.photoFov = Math.min(90, Math.max(15, Number(state?.fov) || 50));
        });
        UIEventBus.on('race:watchOrbit', (state: { dx?: number; dy?: number } | undefined) => {
            this.watchAngle = wrapAngle(this.watchAngle - (state?.dx || 0) * 0.008);
            this.watchPitch = Math.min(0.9, Math.max(-0.12, this.watchPitch + (state?.dy || 0) * 0.004));
        });
        UIEventBus.on('race:watchZoom', (state: { delta?: number } | undefined) => {
            const zoom = this.watchZoom * Math.exp((state?.delta || 0) * 0.0015);
            this.watchZoom = Math.min(3, Math.max(0.5, zoom));
        });
        UIEventBus.on(
            'race:photoMove',
            (state: { x?: number; y?: number; z?: number; fast?: boolean } | undefined) => {
                const axis = (value: unknown) => Math.min(1, Math.max(-1, Number(value) || 0));
                this.photoMove = {
                    x: axis(state?.x),
                    y: axis(state?.y),
                    z: axis(state?.z),
                    fast: Boolean(state?.fast),
                };
            }
        );
        UIEventBus.on('race:graphicsOff', (state: { off?: GraphicsOption[] } | undefined) => {
            const off = state?.off || [];
            this.shakeOff = off.includes('shake');
            this.speedFovOff = off.includes('speedFov');
        });
        // the graphics preset's draw distance
        UIEventBus.on(
            'race:drawDistance',
            (state: { far?: number } | undefined) => {
                this.farOverride = state?.far || 0;
                if (!this.active) return;
                const camera = this.application.camera.instance;
                camera.far = this.farOverride || RACE_CAMERA_FAR;
                camera.updateProjectionMatrix();
            }
        );
        UIEventBus.on('race:cycleCamera', () => {
            if (this.active) this.cycleView();
        });

        this.keyDownHandler = (event: KeyboardEvent) => {
            if (!this.active) return;
            if (event.code !== 'Escape') return;
            if (this.paused) return;

            event.preventDefault();
            UIEventBus.dispatch('race:pauseRequest', {
                source: 'escape',
            });
        };

        this.mouseDownHandler = (event: MouseEvent) => {
            if (!this.active || this.paused || this.pointerLocked) return;
            if (event.button !== 0) return;

            const target = event.target as HTMLElement | null;
            if (
                target?.closest('#prevent-click') ||
                target?.closest('[data-prevent-click]')
            ) {
                return;
            }

            this.requestPointerLock();
        };

        this.mouseMoveHandler = (event: MouseEvent) => {
            if (!this.active || !this.pointerLocked) return;

            this.lookIdle = 0;
            this.yawOffset -= event.movementX * MOUSE_SENSITIVITY_X;
            this.pitchOffset += event.movementY * MOUSE_SENSITIVITY_Y;
            this.pitchOffset = THREE.MathUtils.clamp(
                this.pitchOffset,
                MIN_PITCH,
                MAX_PITCH
            );
        };

        this.pointerLockChangeHandler = () => {
            this.clearPointerLockPendingTimeout();
            const element = this.application.renderer.instance.domElement;
            const wasLocked = this.pointerLocked;
            this.pointerLockRequestPending = false;
            this.pointerLocked = document.pointerLockElement === element;
            UIEventBus.dispatch('race:pointerLockChanged', {
                locked: this.pointerLocked,
            });
            if (!this.pointerLocked) {
                UIEventBus.dispatch('race:inputReset', {
                    source: 'pointerLockChange',
                });
            }
            // esc with the mouse locked only unlocks it, the page never sees
            // the key, so losing the lock while driving is the pause
            if (
                wasLocked &&
                !this.pointerLocked &&
                !this.releasing &&
                this.active &&
                !this.paused &&
                !this.garage &&
                !this.photo
            ) {
                UIEventBus.dispatch('race:pauseRequest', { source: 'pointerUnlock' });
            }
            this.releasing = false;
        };

        this.pointerLockErrorHandler = () => {
            this.clearPointerLockPendingTimeout();
            this.pointerLockRequestPending = false;
            this.pointerLocked = false;
            UIEventBus.dispatch('race:pointerLockChanged', {
                locked: false,
            });
            UIEventBus.dispatch('race:inputReset', {
                source: 'pointerLockError',
            });
        };

        this.blurHandler = () => {
            UIEventBus.dispatch('race:inputReset', {
                source: 'windowBlur',
            });
        };

        document.addEventListener('keydown', this.keyDownHandler);
        document.addEventListener('mousedown', this.mouseDownHandler);
        document.addEventListener('mousemove', this.mouseMoveHandler);
        document.addEventListener(
            'pointerlockchange',
            this.pointerLockChangeHandler
        );
        document.addEventListener(
            'pointerlockerror',
            this.pointerLockErrorHandler
        );
        window.addEventListener('blur', this.blurHandler);

        UIEventBus.on('race:requestPointerLock', () => {
            if (!this.active || this.paused) return;
            this.requestPointerLock();
        });
    }

    requestPointerLock() {
        if (!this.active || this.paused || this.pointerLockRequestPending)
            return;
        const canvas = this.application.renderer.instance.domElement;
        if (
            !canvas ||
            !canvas.isConnected ||
            !document.hasFocus() ||
            document.pointerLockElement === canvas ||
            document.pointerLockElement !== null
        ) {
            return;
        }

        if (canvas.requestPointerLock) {
            try {
                this.pointerLockRequestPending = true;
                this.clearPointerLockPendingTimeout();
                const maybePromise: unknown = canvas.requestPointerLock();
                const pointerLockPromise =
                    maybePromise instanceof Promise ? maybePromise : null;

                if (pointerLockPromise) {
                    pointerLockPromise
                        .catch((error) => {
                            if (this.isExpectedPointerLockAbort(error)) {
                                return;
                            }
                            console.warn(
                                '[Race] Pointer lock request failed',
                                error
                            );
                            UIEventBus.dispatch('race:pointerLockChanged', {
                                locked: false,
                            });
                        })
                        .finally(() => {
                            this.pointerLockRequestPending = false;
                            this.clearPointerLockPendingTimeout();
                        });
                } else {
                    this.pointerLockPendingTimeoutId = window.setTimeout(() => {
                        this.pointerLockPendingTimeoutId = null;
                        this.pointerLockRequestPending = false;
                    }, POINTER_LOCK_PENDING_TIMEOUT_MS);
                }
            } catch (error) {
                this.pointerLockRequestPending = false;
                this.clearPointerLockPendingTimeout();
                if (!this.isExpectedPointerLockAbort(error)) {
                    console.warn('[Race] Pointer lock request failed', error);
                }
                UIEventBus.dispatch('race:pointerLockChanged', {
                    locked: false,
                });
                UIEventBus.dispatch('race:inputReset', {
                    source: 'pointerLockRequestError',
                });
            }
        }
    }

    isExpectedPointerLockAbort(error: unknown) {
        const message = (
            error instanceof Error ? error.message : String(error)
        ).toLowerCase();
        return (
            message.includes(
                'exited the lock before this request was completed'
            ) ||
            message.includes('user has exited the lock') ||
            message.includes('request is not allowed') ||
            message.includes('aborted') ||
            message.includes('not active')
        );
    }

    exitPointerLock() {
        this.pointerLockRequestPending = false;
        this.clearPointerLockPendingTimeout();
        if (document.pointerLockElement) {
            this.releasing = true;
            document.exitPointerLock();
        }
    }

    clearPointerLockPendingTimeout() {
        if (this.pointerLockPendingTimeoutId === null) return;
        window.clearTimeout(this.pointerLockPendingTimeoutId);
        this.pointerLockPendingTimeoutId = null;
    }

    readStoredView() {
        try {
            const stored = Number(
                window.localStorage.getItem(VIEW_STORAGE_KEY)
            );
            return Number.isInteger(stored) &&
                stored >= 0 &&
                stored < VIEWS.length
                ? stored
                : 0;
        } catch {
            return 0;
        }
    }

    cycleView() {
        this.viewIndex = (this.viewIndex + 1) % VIEWS.length;
        this.initialized = false;
        try {
            window.localStorage.setItem(
                VIEW_STORAGE_KEY,
                String(this.viewIndex)
            );
        } catch {
            // not saved, still switches
        }
        UIEventBus.dispatch('race:cameraView', {
            view: VIEWS[this.viewIndex].name,
        });
    }

    getView() {
        return VIEWS[this.viewIndex];
    }

    setActive(active: boolean) {
        this.active = active;
        const camera = this.application.camera.instance;
        if (active) {
            this.time = 0;
            this.initialized = false;
            // springs start at rest, so the first frame is restPose()
            this.headingVelocity = 0;
            this.distanceVelocity = 0;
            this.heightVelocity = 0;
            this.fovVelocity = 0;
            this.lookYVelocity = 0;
            this.impactShake = 0;
            camera.near = RACE_CAMERA_NEAR;
            camera.far = this.farOverride || RACE_CAMERA_FAR;
            camera.fov = this.getView().fov;
            camera.updateProjectionMatrix();
            return;
        }

        this.exitPointerLock();
        this.pointerLocked = false;
        this.pointerLockRequestPending = false;
        this.clearPointerLockPendingTimeout();
        this.yawOffset = 0;
        this.pitchOffset = 0;
        camera.clearViewOffset();
        camera.near = this.defaultNear;
        camera.far = this.defaultFar;
        camera.fov = this.defaultFov;
        camera.updateProjectionMatrix();
        UIEventBus.dispatch('race:inputReset', {
            source: 'setInactive',
        });
        UIEventBus.dispatch('race:pointerLockChanged', { locked: false });
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        if (paused) {
            this.exitPointerLock();
            this.pointerLockRequestPending = false;
            this.clearPointerLockPendingTimeout();
            UIEventBus.dispatch('race:inputReset', {
                source: 'setPaused',
            });
        }
    }

    update(deltaSeconds: number) {
        if (!this.active) return;
        const dt = Math.min(0.05, Math.max(0, deltaSeconds));
        const camera = this.application.camera.instance;
        const vehicle = this.vehicle;
        const telemetry = vehicle.getTelemetry();
        const view = this.getView();
        this.time += dt;

        const speed = Math.hypot(vehicle.speedMps, vehicle.lateralSpeed);
        const size = vehicle.bodySize.z / REFERENCE_CAR_LENGTH;
        const carYaw = vehicle.yaw;
        const travelYaw =
            speed > 3
                ? Math.atan2(vehicle.velocity.x, vehicle.velocity.z)
                : carYaw;
        // the pad's right stick (or B, to look back) points the view and it
        // springs back when let go. mouse look settles back behind the car
        // once the mouse stops
        const padLook = vehicle.input.look;
        if (padLook.back || padLook.x || padLook.y) {
            this.lookIdle = 0;
            const yaw = padLook.back ? Math.PI : -padLook.x * PAD_LOOK_YAW;
            const pitch = padLook.back
                ? 0
                : THREE.MathUtils.clamp(padLook.y * PAD_LOOK_PITCH, MIN_PITCH, MAX_PITCH);
            const follow = Math.min(1, dt * 12);
            this.yawOffset += (yaw - this.yawOffset) * follow;
            this.pitchOffset += (pitch - this.pitchOffset) * follow;
        } else {
            this.lookIdle += dt;
            if (!this.pointerLocked || this.lookIdle > LOOK_RETURN_DELAY_S) {
                const settle = Math.min(1, dt * (this.pointerLocked ? 2.5 : 5));
                this.yawOffset += (0 - this.yawOffset) * settle;
                this.pitchOffset += (0 - this.pitchOffset) * settle;
            }
        }

        this.tmpUp.set(0, 1, 0);
        const anchor = this.tmpAnchor.copy(vehicle.position);

        if (this.watchTarget) {
            this.updateWatch(camera, this.watchTarget, dt);
            return;
        }

        if (this.photo) {
            this.updatePhoto(camera, anchor, carYaw, dt);
            return;
        }

        // garage: a slow orbit around the parked car, draggable
        if (this.garage) {
            this.garageAngle += dt * (this.garageDragIdle > 1.5 ? 0.22 : 0);
            this.garageDragIdle += dt;
            let radius = vehicle.bodySize.z * 0.95 + 2.2;
            // centered in what the panel leaves free, further back when that's small
            const frame = this.garageFrame;
            if (frame) {
                const width = window.innerWidth;
                const height = window.innerHeight;
                camera.setViewOffset(
                    width,
                    height,
                    width / 2 - (frame.x + frame.width / 2),
                    height / 2 - (frame.y + frame.height / 2),
                    width,
                    height
                );
                const focal = height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
                radius = Math.max(
                    radius,
                    (focal * vehicle.bodySize.z * 0.9) / (frame.width * 0.8),
                    (focal * 2) / (frame.height * 0.8)
                );
            } else if (camera.view?.enabled) {
                camera.clearViewOffset();
            }
            // on the garage's stand the car faces +z
            const center = this.garageAnchor || anchor;
            const angle =
                (this.garageAnchor ? 0 : carYaw) + Math.PI * 0.8 + this.garageAngle;
            camera.position.set(
                center.x + Math.sin(angle) * radius,
                center.y + 1.25 + this.garagePitch * 2.5,
                center.z + Math.cos(angle) * radius
            );
            camera.up.set(0, 1, 0);
            camera.lookAt(center.x, center.y + 0.45, center.z);
            this.initialized = false;
            return;
        }
        if (camera.view?.enabled) camera.clearViewOffset();

        if (view.mounted) {
            this.updateMounted(view, carYaw, anchor, size, speed, dt);
            return;
        }

        // the camera heading lags the car's, and leans toward where the car is
        // actually going in a slide, so you see its side
        const slide = Math.min(1, speed / 12) * view.slideFollow;
        const targetHeading =
            carYaw + wrapAngle(travelYaw - carYaw) * slide + this.yawOffset;
        if (!this.initialized) this.heading = targetHeading;
        const headingError = wrapAngle(this.heading - targetHeading);
        [this.heading, this.headingVelocity] = spring(
            targetHeading + headingError,
            this.headingVelocity,
            targetHeading,
            5.2,
            dt
        );

        // hard acceleration pulls the car away a little, braking brings it close
        const surge = -telemetry.longitudinalG * 0.55;
        const followOffset = vehicle.getCameraFollowDistanceOffset() * 0.25;
        const targetDistance =
            view.distance * size +
            followOffset +
            surge +
            Math.min(1.2, speed * 0.012);
        const targetHeight = view.height * (0.85 + size * 0.15) + speed * 0.002;
        if (!this.initialized) {
            this.distance = targetDistance;
            this.height = targetHeight;
            this.fov = view.fov;
            this.lookY = anchor.y;
        }
        [this.distance, this.distanceVelocity] = spring(
            this.distance,
            this.distanceVelocity,
            targetDistance,
            4.5,
            dt
        );
        [this.height, this.heightVelocity] = spring(
            this.height,
            this.heightVelocity,
            targetHeight,
            6,
            dt
        );
        // the look point rides the car but damps its bumps
        [this.lookY, this.lookYVelocity] = spring(
            this.lookY,
            this.lookYVelocity,
            anchor.y,
            14,
            dt
        );

        const pitch = this.pitchOffset;
        const forward = this.tmpForward.set(
            Math.sin(this.heading),
            0,
            Math.cos(this.heading)
        );
        const position = this.tmpPosition
            .copy(anchor)
            .addScaledVector(forward, -this.distance * Math.cos(pitch))
            .setY(this.lookY + this.height + this.distance * Math.sin(pitch));
        const look = this.tmpLook
            .copy(anchor)
            .addScaledVector(forward, view.lookAhead * size)
            .setY(this.lookY + view.lookHeight);

        // never under the ground
        const ground = vehicle.track.sampleGround(position.x, position.z);
        if (ground !== null && position.y < ground + 0.55) {
            position.y = ground + 0.55;
        }

        this.applyShake(position, look, telemetry, speed, dt);
        this.applyFov(view, telemetry, speed, dt);
        this.initialized = true;
        camera.position.copy(position);
        camera.lookAt(look);
        this.applyRoll(camera, telemetry);
    }

    // following a watched lap's car, or back on yours with null. each watch
    // starts from behind it
    setWatch(target: THREE.Object3D | null, length = REFERENCE_CAR_LENGTH) {
        if (target && !this.watchTarget) {
            this.watchAngle = 0;
            this.watchPitch = 0;
            this.watchZoom = 1;
        }
        if (Boolean(target) !== Boolean(this.watchTarget)) this.initialized = false;
        this.watchTarget = target;
        this.watchLength = length;
    }

    // behind the watched car, its heading followed through a spring, never
    // under the ground
    updateWatch(camera: THREE.PerspectiveCamera, target: THREE.Object3D, dt: number) {
        const anchor = this.tmpAnchor.copy(target.position);
        const forward = this.tmpForward.set(0, 0, 1).applyQuaternion(target.quaternion);
        const goal = Math.atan2(forward.x, forward.z) + this.watchAngle;
        if (!this.initialized) {
            this.heading = goal;
            this.headingVelocity = 0;
            this.lookY = anchor.y;
            this.lookYVelocity = 0;
        }
        const error = wrapAngle(this.heading - goal);
        [this.heading, this.headingVelocity] = spring(goal + error, this.headingVelocity, goal, 3.6, dt);
        [this.lookY, this.lookYVelocity] = spring(this.lookY, this.lookYVelocity, anchor.y, 10, dt);
        const distance = (this.watchLength + 3.4) * this.watchZoom;
        const pitch = 0.17 + this.watchPitch;
        const position = this.tmpPosition.set(
            anchor.x - Math.sin(this.heading) * distance * Math.cos(pitch),
            this.lookY + 0.9 + distance * Math.sin(pitch),
            anchor.z - Math.cos(this.heading) * distance * Math.cos(pitch)
        );
        const ground = this.vehicle.track.sampleGround(position.x, position.z);
        if (ground !== null && position.y < ground + 0.55) position.y = ground + 0.55;
        if (camera.view?.enabled) camera.clearViewOffset();
        if (camera.fov !== VIEWS[0].fov) {
            camera.fov = VIEWS[0].fov;
            camera.updateProjectionMatrix();
        }
        camera.position.copy(position);
        camera.up.set(0, 1, 0);
        camera.lookAt(anchor.x, this.lookY + 0.8, anchor.z);
        this.initialized = true;
    }

    // where the first update() after setActive(true) puts the camera, from the
    // car as it is now. the homepage transition flies there, so the handoff
    // to the race camera doesn't move a pixel. up is the camera's up vector
    restPose(position: THREE.Vector3, look: THREE.Vector3, up: THREE.Vector3) {
        const vehicle = this.vehicle;
        const view = this.getView();
        const telemetry = vehicle.getTelemetry();
        const anchor = vehicle.position;
        if (view.mounted) {
            const mount = this.mount(view);
            up.set(0, 1, 0).applyQuaternion(vehicle.carPivot.quaternion);
            const forward = new THREE.Vector3(0, 0, 1)
                .applyQuaternion(vehicle.carPivot.quaternion)
                .normalize();
            position
                .copy(anchor)
                .addScaledVector(forward, mount.along)
                .addScaledVector(up, mount.up);
            look.copy(position)
                .addScaledVector(forward, view.lookAhead)
                .addScaledVector(up, mount.lookUp - mount.up);
            return view.fov;
        }
        const speed = Math.hypot(vehicle.speedMps, vehicle.lateralSpeed);
        const size = vehicle.bodySize.z / REFERENCE_CAR_LENGTH;
        const heading = vehicle.yaw + this.yawOffset;
        const distance =
            view.distance * size +
            vehicle.getCameraFollowDistanceOffset() * 0.25 -
            telemetry.longitudinalG * 0.55 +
            Math.min(1.2, speed * 0.012);
        const height = view.height * (0.85 + size * 0.15) + speed * 0.002;
        const pitch = this.pitchOffset;
        const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
        position
            .copy(anchor)
            .addScaledVector(forward, -distance * Math.cos(pitch))
            .setY(anchor.y + height + distance * Math.sin(pitch));
        look.copy(anchor)
            .addScaledVector(forward, view.lookAhead * size)
            .setY(anchor.y + view.lookHeight);
        const ground = vehicle.track.sampleGround(position.x, position.z);
        if (ground !== null && position.y < ground + 0.55) {
            position.y = ground + 0.55;
        }
        up.set(0, 1, 0);
        return (
            view.fov +
            (this.speedFovOff ? 0 : Math.max(0, telemetry.longitudinalG) * 3.5)
        );
    }

    // photo mode: drag orbits, scroll zooms, wasd (or the left stick) moves
    // the whole view, the fov comes from the slider
    updatePhoto(
        camera: THREE.PerspectiveCamera,
        anchor: THREE.Vector3,
        carYaw: number,
        dt: number
    ) {
        const vehicle = this.vehicle;
        if (camera.view?.enabled) camera.clearViewOffset();
        // zoomed all the way in it stops just off the bumpers
        const radius = Math.max(
            vehicle.bodySize.z * 0.5 + 0.5,
            (vehicle.bodySize.z * 0.8 + 1.8) * this.photoZoom
        );
        const angle = carYaw + Math.PI * 0.8 + this.photoAngle;
        const move = this.photoMove;
        if (move.x || move.y || move.z) {
            const speed = (move.fast ? PHOTO_FAST : PHOTO_SPEED) * dt;
            // forward is the way the camera looks, flat on the ground
            const fx = -Math.sin(angle);
            const fz = -Math.cos(angle);
            this.photoPan.x += (fx * move.z - fz * move.x) * speed;
            this.photoPan.z += (fz * move.z + fx * move.x) * speed;
            this.photoPan.y += move.y * speed;
            // never out of sight of the car
            if (this.photoPan.length() > PHOTO_REACH) this.photoPan.setLength(PHOTO_REACH);
        }
        const center = this.tmpLook.copy(anchor).add(this.photoPan);
        center.y += 0.4;
        const centerGround = vehicle.track.sampleGround(center.x, center.z);
        if (centerGround !== null && center.y < centerGround + 0.2) {
            center.y = centerGround + 0.2;
        }
        const position = this.tmpPosition.set(
            center.x + Math.sin(angle) * Math.cos(this.photoPitch) * radius,
            center.y + Math.sin(this.photoPitch) * radius,
            center.z + Math.cos(angle) * Math.cos(this.photoPitch) * radius
        );
        const ground = vehicle.track.sampleGround(position.x, position.z);
        if (ground !== null && position.y < ground + 0.12) {
            position.y = ground + 0.12;
        }
        camera.fov = this.photoFov;
        camera.updateProjectionMatrix();
        camera.position.copy(position);
        camera.up.set(0, 1, 0);
        camera.lookAt(center);
        this.initialized = false;
    }

    setPhoto(on: boolean) {
        this.photo = on;
        this.initialized = false;
        this.photoMove = { x: 0, y: 0, z: 0, fast: false };
        if (!on) return;
        this.photoAngle = 0;
        this.photoPitch = 0.12;
        this.photoZoom = 1;
        this.photoFov = 50;
        this.photoPan.set(0, 0, 0);
    }

    mount(view: CameraView) {
        const vehicle = this.vehicle;
        let spot: HoodSpot | null = null;
        const model = vehicle.carModel;
        if (view.hood && model) {
            if (this.hoodCache.model !== model) {
                this.hoodCache = {
                    model,
                    spot: probeHood(
                        vehicle.carPivot,
                        model,
                        vehicle.bodySize.z,
                        vehicle.rideHeight
                    ),
                };
            }
            spot = this.hoodCache.spot;
        }
        return mountOf(view, vehicle.bodySize, vehicle.rideHeight, spot);
    }

    // bumper and hood cams: fixed to the car, only the shake and fov move
    updateMounted(
        view: CameraView,
        carYaw: number,
        anchor: THREE.Vector3,
        size: number,
        speed: number,
        dt: number
    ) {
        const camera = this.application.camera.instance;
        const vehicle = this.vehicle;
        const telemetry = vehicle.getTelemetry();
        const up = this.tmpUp
            .set(0, 1, 0)
            .applyQuaternion(vehicle.carPivot.quaternion);
        const forward = this.tmpForward
            .set(0, 0, 1)
            .applyQuaternion(vehicle.carPivot.quaternion)
            .normalize();
        const mount = this.mount(view);
        const position = this.tmpPosition
            .copy(anchor)
            .addScaledVector(forward, mount.along)
            .addScaledVector(up, mount.up);
        const look = this.tmpLook
            .copy(position)
            .addScaledVector(forward, view.lookAhead)
            .addScaledVector(up, mount.lookUp - mount.up);
        if (!this.initialized) this.fov = view.fov;
        this.applyShake(position, look, telemetry, speed, dt, 0.35);
        this.applyFov(view, telemetry, speed, dt);
        this.initialized = true;
        camera.position.copy(position);
        camera.up.copy(up);
        camera.lookAt(look);
        camera.up.set(0, 1, 0);
        void carYaw;
        void size;
    }

    // speed widens the view, hard acceleration kicks it out a bit more
    applyFov(
        view: CameraView,
        telemetry: ReturnType<RaceVehicle['getTelemetry']>,
        speed: number,
        dt: number
    ) {
        const camera = this.application.camera.instance;
        const speedKick =
            Math.pow(Math.min(1, Math.max(0, (speed - 12) / 80)), 1.3) * 13;
        const accelKick = Math.max(0, telemetry.longitudinalG) * 3.5;
        const target =
            this.paused || this.speedFovOff
                ? view.fov
                : view.fov + speedKick + accelKick;
        [this.fov, this.fovVelocity] = spring(
            this.fov,
            this.fovVelocity,
            target,
            5,
            dt
        );
        camera.fov = this.fov;
        camera.updateProjectionMatrix();
    }

    // shake from speed, the surface, and hits. never fed back into the springs
    applyShake(
        position: THREE.Vector3,
        look: THREE.Vector3,
        telemetry: ReturnType<RaceVehicle['getTelemetry']>,
        speed: number,
        dt: number,
        scale = 1
    ) {
        if (this.paused || this.shakeOff) return;
        if (telemetry.impact > this.lastImpact + 0.5) {
            this.impactShake = Math.min(
                1,
                this.impactShake + telemetry.impact * 0.08
            );
        }
        this.lastImpact = telemetry.impact;
        this.impactShake = Math.max(0, this.impactShake - dt * 2.4);
        const fast = Math.max(0, (speed - 42) / 45);
        const kerb = telemetry.onKerb ? Math.min(1, speed / 25) : 0;
        const grass = telemetry.onGrass ? Math.min(1, speed / 20) : 0;
        const amount =
            (fast * 0.018 +
                kerb * 0.03 +
                grass * 0.05 +
                this.impactShake * 0.16) *
            scale;
        if (amount < 0.0005) return;
        const t = this.time;
        const rate = 1 + kerb * 2.5;
        this.shakeOffset.set(
            wobble(t * 3.1 * rate, 1.3) * amount,
            wobble(t * 3.7 * rate, 4.1) * amount * 0.8,
            wobble(t * 2.3 * rate, 7.7) * amount * 0.4
        );
        position.add(this.shakeOffset);
        look.addScaledVector(this.shakeOffset, 0.4);
    }

    // a hint of lean with cornering load, so turns feel like they have weight
    applyRoll(
        camera: THREE.PerspectiveCamera,
        telemetry: ReturnType<RaceVehicle['getTelemetry']>
    ) {
        const lean = Math.max(-1, Math.min(1, telemetry.lateralG)) * 0.012;
        camera.rotateZ(-lean);
    }
}
