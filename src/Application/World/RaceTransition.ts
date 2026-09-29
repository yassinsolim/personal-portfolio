import * as THREE from 'three';
import TWEEN from '@tweenjs/tween.js';
import BezierEasing from 'bezier-easing';
import Application from '../Application';
import UIEventBus from '../UI/EventBus';
import { CameraKey } from '../Camera/Camera';
import { getInviteLobbyCode } from '../Racing/Multiplayer/invite';
import type RaceManager from '../Racing/RaceManager';
import type { RevealPlate } from '../Racing/Visuals/RaceReveal';
import { finishOf, paintMaterialsOf } from '../Racing/Garage/carLook';
import { reportStage } from '../Utils/loadStages';

// click the car in the room: it rocks on its springs and the camera swings
// round behind it, landing exactly where the race camera will start, with its
// lens. the room car and the race car are clones of one model, so the matrix
// between their frames maps the race camera into the room, and from there the
// room car covers the very pixels the race car will. the room's last frame is
// kept (the plate), the race starts under it with the car parked, and the ring
// builds out from the car (Racing/Visuals/RaceReveal): the plate melts away
// from the tyres outward, exactly where the ring comes out of the haze under
// it. any key or click skips, prefers-reduced-motion gets a short cross-fade
const FLY_SECONDS = 1.9;
// slow to leave, long soft landing behind the car
const FLY_EASE = BezierEasing(0.45, 0, 0.12, 1);
// how long the camera waits behind the car for the race programs at most
const COMPILE_WAIT_MS = 2500;
const JOIN_WAIT_MS = 4000;
const NAME_KEY = 'yassinverse:nordschleife:multiplayer:name:v1';
const WORLD_UP = new THREE.Vector3(0, 1, 0);

type Pose = {
    position: THREE.Vector3;
    look: THREE.Vector3;
    up: THREE.Vector3;
    fov: number;
};

type Flight = {
    center: THREE.Vector3;
    from: Pose;
    to: Pose;
    radius: [number, number];
    angle: [number, number];
    height: [number, number];
    // the race's resolution, switched to at the end of the fly
    maxPixelRatio: number;
    resized: boolean;
    started: number;
    resolve: () => void;
};

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

// phases for scripts/race-transition-record.mjs to split frame times by, and
// for a loader to follow ('load:stage' events, Utils/loadStages)
const mark = (phase: string) => {
    performance.mark?.(`race-transition:${phase}`);
    reportStage('race', phase, phase === 'done' ? 1 : 0);
};

const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

export default class RaceTransition {
    application: Application;
    busy: boolean;
    skipped: boolean;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    lastHover: number;
    hovering: boolean;
    skipHandler: (event: Event) => void;
    plate: (RevealPlate & { dispose: () => void }) | null;
    groundMaterial: THREE.ShaderMaterial;
    groundCarMaterial: THREE.ShaderMaterial;
    groundOutlineMaterial: THREE.ShaderMaterial;
    private flight: Flight | null;
    private streaming = false;
    private joining = false;
    private tickActions: Array<() => void> = [];
    // the room's furniture as boxes, for the fly's path (the room never moves)
    private roomBoxes: THREE.Box3[] | null = null;
    private respray: {
        paint: THREE.Color | null;
        finish: { metalness: number; roughness: number } | null;
        materials: {
            material: THREE.MeshStandardMaterial;
            color: THREE.Color;
            metalness: number;
            roughness: number;
        }[];
    } | null = null;
    private lookMatrix: THREE.Matrix4;
    private releaseResolution: (() => void) | null = null;

    constructor() {
        this.application = new Application();
        this.busy = false;
        this.skipped = false;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.lastHover = 0;
        this.hovering = false;
        this.plate = null;
        this.flight = null;
        this.lookMatrix = new THREE.Matrix4();
        this.groundMaterial = this.createGroundMaterial();
        this.groundCarMaterial = this.createGroundMaterial(1);
        // the race car, drawn from its own camera over whatever depth the
        // room left, only needs the flag
        this.groundOutlineMaterial = this.createGroundMaterial(1);
        this.groundOutlineMaterial.depthTest = false;
        this.groundOutlineMaterial.depthWrite = false;
        this.skipHandler = (event: Event) => {
            if (event instanceof KeyboardEvent && event.repeat) return;
            this.skip();
        };

        // capture phase, ahead of the camera's own click handler
        document.addEventListener(
            'mousedown',
            (event) => {
                if (event.button !== 0 || !this.canStart()) return;
                if (!this.hitsCar(event.clientX, event.clientY)) return;
                event.stopImmediatePropagation();
                event.preventDefault();
                void this.start();
            },
            true
        );
        document.addEventListener('mousemove', (event) => {
            const now = performance.now();
            if (now - this.lastHover < 90) return;
            this.lastHover = now;
            const over =
                this.canStart() && this.hitsCar(event.clientX, event.clientY);
            if (over === this.hovering) return;
            this.hovering = over;
            document.body.style.cursor = over ? 'pointer' : '';
            if (over) this.holdResolution();
            else if (!this.busy) this.letResolutionGo();
            // building the ring takes most of a second on the main thread, so
            // start it on hover and the click doesn't have to wait. then the
            // race programs compile in the background
            if (over) void this.prepareOnHover();
        });
    }

    // one step a frame: the race programs, then what the fly and the capture
    // need the first time (the room's boxes, the capture's two programs)
    async prepareOnHover() {
        // a failed download is retried by the click
        const manager = await this.application.world.ensureRaceManager().catch(() => null);
        if (!manager) return;
        await nextFrame();
        // software gl compiles for seconds, which the room shouldn't stall
        // on. the transition does it behind the car instead
        if (manager.active || this.busy || manager.visuals.software) return;
        await manager.visuals.prewarm(this.application.camera.instance);
        const car = this.application.world.car?.model;
        if (!car || this.roomBoxes || this.busy) return;
        await nextFrame();
        if (this.busy) return;
        this.roomBoxes = this.obstacles(car);
        await nextFrame();
        if (this.busy) return;
        const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
        this.drawGround(target, { raceFromRoom: new THREE.Matrix4(), center: new THREE.Vector3() });
        // the race car's outline pass has its own geometry variants, and the
        // car is out of this view, so those compile instead of drawing
        const raceCar = manager.vehicle.carModel;
        if (raceCar) {
            const renderer = this.application.renderer.instance;
            const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
            raceCar.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (!mesh.isMesh) return;
                materials.set(mesh, mesh.material);
                mesh.material = this.groundOutlineMaterial;
            });
            renderer.setRenderTarget(target);
            renderer.compile(raceCar, this.application.camera.instance);
            renderer.setRenderTarget(null);
            materials.forEach((original, mesh) => (mesh.material = original));
        }
        target.dispose();
    }

    // the room's resolution stays put while the pointer is on the car and
    // through the transition. a change resizes the canvas, which stalls
    // that frame on the gpu for 50 ms or more
    holdResolution() {
        if (this.releaseResolution) return;
        void this.application.renderer.holdResolution(
            new Promise<void>((resolve) => (this.releaseResolution = resolve))
        );
    }

    letResolutionGo() {
        this.releaseResolution?.();
        this.releaseResolution = null;
    }

    canStart() {
        const camera = this.application.camera;
        const world = this.application.world;
        if (this.busy || camera.freeCam || camera.raceModeActive) return false;
        if (world?.raceManager?.active) return false;
        const key = camera.currentKeyframe ?? camera.targetKeyframe;
        return key === CameraKey.IDLE || key === CameraKey.DESK;
    }

    // the car has to be the first thing under the pointer, not behind the desk
    hitsCar(x: number, y: number) {
        const car = this.application.world?.car?.model;
        if (!car) return false;
        const canvas = this.application.renderer.instance.domElement;
        const rect = canvas.getBoundingClientRect();
        this.pointer.set(
            ((x - rect.left) / rect.width) * 2 - 1,
            -((y - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(
            this.pointer,
            this.application.camera.instance
        );
        const shown = (object: THREE.Object3D | null) => {
            for (let node = object; node; node = node.parent) {
                if (!node.visible) return false;
            }
            return true;
        };
        // the hidden race world is in the scene too, only what's drawn counts
        const hit = this.raycaster
            .intersectObjects(this.application.scene.children, true)
            .find((h) => (h.object as THREE.Mesh).isMesh && shown(h.object));
        if (!hit) return false;
        let node: THREE.Object3D | null = hit.object;
        while (node) {
            if (node === car) return true;
            node = node.parent;
        }
        return false;
    }

    async start() {
        const car = this.application.world?.car?.model;
        if (!car || this.busy) return;
        this.busy = true;
        this.skipped = false;
        this.joining = false;
        this.holdResolution();
        mark('start');
        document.body.style.cursor = '';
        // the monitor's iframe stops taking clicks until the race is up, so a
        // click to skip reaches us instead of focusing yassinOS
        UIEventBus.dispatch('race:transitionLock', { locked: true });
        // the click's default was stopped, so focus can still be inside the
        // monitor's iframe, where a key to skip would never reach us
        this.returnFocus();
        // capture, the page's own key handlers stop some keys from bubbling
        window.addEventListener('keydown', this.skipHandler, true);
        window.addEventListener('pointerdown', this.skipHandler, true);
        document.body.classList.add('race-transition');
        const reduced = Boolean(
            window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        );
        const camera = this.application.camera;
        const baseY = car.position.y;
        if (!reduced) this.rock(car, baseY);

        // the race world builds while the car rocks, then the camera flies,
        // so the fly never stutters on the build
        let manager: RaceManager;
        try {
            manager = await this.application.world.ensureRaceManager();
        } catch {
            // the race code or track didn't download: the room stays, and the
            // next click tries again
            this.abort();
            return;
        }
        await nextFrame();
        if (!this.busy) return;
        const invite = getInviteLobbyCode();
        camera.currentKeyframe = undefined;
        camera.targetKeyframe = undefined;
        // the fly and the race start run inside the app's frame, before it
        // draws
        camera.externalControl = () => this.tick();
        if (this.skipped) {
            await this.skipToRace(manager, invite);
            return;
        }
        const software = manager.visuals.software;
        const warm = software ? Promise.resolve() : manager.visuals.prewarm(camera.instance);
        // an invite joins first, so the grid slot (where the car starts) is
        // known. solo leaves any lobby
        if (invite) await this.joinFirst(manager, invite);
        else await manager.multiplayer.setSoloMode(this.playerName(), manager.vehicle.currentCarId);
        const target = await this.raceStart(manager, car, baseY);
        if (!this.busy) return;
        if (!target || this.skipped) {
            await this.skipToRace(manager, invite);
            return;
        }
        // the car is ready now (a lite car loads late), anything new of it
        // compiles during the fly
        const ready = software ? null : warm.then(() => manager.visuals.prewarm(camera.instance));

        mark('fly');
        if (!reduced && !software) {
            const race = target.race;
            manager.visuals.streamStart(race.position, race.look, race.up, race.fov, camera.instance.aspect);
            this.streaming = true;
        }
        if (!reduced) await this.fly(car, target.pose, manager.visuals.maxPixelRatio());
        this.streaming = false;
        mark('settled');
        // behind the car the view is still, so waiting for the programs is
        // just the camera settling. software gl compiles everything here
        await Promise.race([
            ready || manager.visuals.prewarm(camera.instance),
            this.until(() => false, software ? 60000 : COMPILE_WAIT_MS),
        ]);
        if (!this.busy) return;
        if (this.skipped) {
            await this.skipToRace(manager, invite);
            return;
        }

        const reveal = manager.visuals.reveal;
        await this.inTick(() => {
            mark('handoff');
            // the race's resolution first: resizing clears the canvas, and
            // the capture below draws it straight back
            this.application.renderer.matchScenePixelRatio(manager.visuals.maxPixelRatio());
            this.plate = this.capturePlate(target, !reduced);
            reveal.arm(target.center, target.base, this.plate, !reduced);
            manager.transitionHold = true;
            this.keepRoomGrain(true);
            manager.enterRaceMode();
        });
        if (!this.busy) return;
        // its first frames under the plate, where a slow one can't be seen
        await this.smoothFrames(true, software ? 20000 : 1500);
        if (this.skipped || !this.busy) {
            this.finish(manager);
            return;
        }
        // the car spawned somewhere else (the lobby's grid changed): no 1:1
        // handoff to melt through, so the room just fades off the race
        if (!reduced && manager.vehicle.position.distanceTo(target.spawn) > 0.05) {
            reveal.arm(target.center, target.base, this.plate, false);
        }
        mark('reveal');
        reveal.start();
        await this.until(() => reveal.done, 12000, () => {
            this.keepRoomGrain(true, reveal.roomGrain);
        });
        this.finish(manager);
    }

    // the transition's part of every frame, from the camera's update: the fly,
    // the race world's uploads streamed while it flies, one-off actions
    tick() {
        this.flyStep();
        // from a few frames in, so the camera starts off clean
        const flight = this.flight;
        if (this.streaming && flight && performance.now() - flight.started > 100) {
            this.streaming = this.application.world.raceManager?.visuals.streamStep() || false;
        }
        const actions = this.tickActions;
        this.tickActions = [];
        actions.forEach((action) => action());
    }

    // runs action inside the next frame, before it draws
    inTick(action: () => void) {
        return new Promise<void>((resolve) => {
            this.tickActions.push(() => {
                try {
                    action();
                } finally {
                    resolve();
                }
            });
        });
    }

    // no plate, no reveal: the race, as soon as it can draw. an invite's
    // join (started now if it wasn't) gets its few seconds first
    async skipToRace(manager: RaceManager, invite: string) {
        if (!manager.active) {
            if (invite) {
                if (!this.joining) this.startJoin(invite);
                await this.until(() => this.inLobby(manager), JOIN_WAIT_MS, undefined, true);
            } else {
                await manager.multiplayer.setSoloMode(this.playerName(), manager.vehicle.currentCarId);
            }
            await this.inTick(() => {
                this.application.renderer.matchScenePixelRatio(manager.visuals.maxPixelRatio());
                if (!manager.active) manager.enterRaceMode();
            });
        }
        await this.until(() => manager.active, 8000, undefined, true);
        await this.smoothFrames(true);
        this.finish(manager);
    }

    // a rev on its springs
    rock(car: THREE.Object3D, baseY: number) {
        const rock = { t: 0 };
        new TWEEN.Tween(rock)
            .to({ t: 1 }, 420)
            .onUpdate(() => {
                car.position.y =
                    baseY + Math.sin(rock.t * Math.PI * 3) * (1 - rock.t) * 0.6;
            })
            .onComplete(() => (car.position.y = baseY))
            .start();
    }

    // the race itself starts later, from the transition
    startJoin(lobbyCode: string) {
        this.joining = true;
        UIEventBus.dispatch('race:multiplayerJoinLobby', {
            playerName: this.playerName(),
            lobbyCode,
            startRace: false,
        });
    }

    inLobby(manager: RaceManager) {
        const state = manager.multiplayer.getState();
        return state.mode === 'lobby' && state.connected;
    }

    async joinFirst(manager: RaceManager, lobbyCode: string) {
        this.startJoin(lobbyCode);
        await this.until(() => this.inLobby(manager), JOIN_WAIT_MS);
    }

    // puts the race car on its grid slot, and works out where the race camera
    // starts and what that is in the room
    async raceStart(manager: RaceManager, car: THREE.Object3D, baseY: number) {
        const vehicle = manager.vehicle;
        const model = await vehicle.ensurePreparedModel(vehicle.currentCarId);
        // rims from another car come from that car's model
        const wheels = vehicle.look.wheels;
        if (wheels !== 'stock' && wheels !== vehicle.currentCarId) {
            await vehicle.ensurePreparedModel(wheels);
            await nextFrame();
        }
        if (!model || vehicle.carModel !== model) return null;
        vehicle.spawnSlot = manager.getSpawnSlot();
        vehicle.resetToStart();
        const race: Pose = {
            position: new THREE.Vector3(),
            look: new THREE.Vector3(),
            up: new THREE.Vector3(),
            fov: 0,
        };
        race.fov = manager.chaseCamera.restPose(race.position, race.look, race.up);

        // race car frame to room car frame, with the room car at rest
        const rocking = car.position.y;
        car.position.y = baseY;
        car.updateMatrixWorld(true);
        vehicle.root.updateMatrixWorld(true);
        const roomFromRace = new THREE.Matrix4().multiplyMatrices(
            car.matrixWorld,
            model.matrixWorld.clone().invert()
        );
        car.position.y = rocking;
        car.updateMatrixWorld(true);
        const pose: Pose = {
            position: race.position.clone().applyMatrix4(roomFromRace),
            look: race.look.clone().applyMatrix4(roomFromRace),
            up: race.up.clone().transformDirection(roomFromRace),
            fov: race.fov,
        };
        const spawn = vehicle.position.clone();
        const center = new THREE.Vector3(spawn.x, 0, spawn.z);
        const base = manager.track.sampleGround(spawn.x, spawn.z) ?? spawn.y - vehicle.rideHeight;
        center.y = base;
        // the race camera's first view, for drawing the race car's outline
        const raceCamera = new THREE.PerspectiveCamera(
            race.fov,
            this.application.camera.instance.aspect,
            0.1,
            100
        );
        raceCamera.position.copy(race.position);
        raceCamera.up.copy(race.up);
        raceCamera.lookAt(race.look);
        raceCamera.updateMatrixWorld();
        this.prepareRespray(car, vehicle.currentCarId, vehicle.look);
        return {
            pose,
            race,
            raceFromRoom: roomFromRace.clone().invert(),
            center,
            base,
            spawn,
            raceCamera,
            raceCar: model,
        };
    }

    // the room car takes the saved garage paint and finish while the camera
    // swings round, so it's already the player's color when the view settles.
    // only uniforms change (no new programs), and the room gets its own look
    // back once the race is up
    prepareRespray(car: THREE.Object3D, carId: string, look: { paint: string | null; finish: Parameters<typeof finishOf>[0] }) {
        const paint = look.paint ? new THREE.Color(look.paint) : null;
        const finish = finishOf(look.finish);
        this.respray =
            paint || finish
                ? {
                      paint,
                      finish,
                      materials: paintMaterialsOf(car, carId).map((material) => ({
                          material,
                          color: material.color.clone(),
                          metalness: material.metalness,
                          roughness: material.roughness,
                      })),
                  }
                : null;
    }

    applyRespray(amount: number) {
        const respray = this.respray;
        if (!respray) return;
        respray.materials.forEach((entry) => {
            entry.material.color.copy(entry.color);
            if (respray.paint) entry.material.color.lerp(respray.paint, amount);
            if (respray.finish) {
                entry.material.metalness = THREE.MathUtils.lerp(entry.metalness, respray.finish.metalness, amount);
                entry.material.roughness = THREE.MathUtils.lerp(entry.roughness, respray.finish.roughness, amount);
            }
        });
    }

    // radius, angle and height about the room car blend on their own, so the
    // path swings round the car instead of cutting through it, while the aim,
    // the up vector (the road's slight lean) and the lens blend onto the race
    // camera's. the camera itself is driven from the app's frame, no lag
    fly(car: THREE.Object3D, to: Pose, maxPixelRatio: number) {
        const camera = this.application.camera;
        const instance = camera.instance;
        const box = new THREE.Box3().setFromObject(car);
        const center = box.getCenter(new THREE.Vector3()).setY(box.min.y);
        const from: Pose = {
            position: instance.position.clone(),
            look: camera.focalPoint.clone(),
            up: WORLD_UP.clone(),
            fov: instance.fov,
        };
        const a = from.position.clone().sub(center);
        const b = to.position.clone().sub(center);
        const angleFrom = Math.atan2(a.x, a.z);
        const shortest = wrapAngle(Math.atan2(b.x, b.z) - angleFrom);
        const longest = shortest - Math.sign(shortest || 1) * Math.PI * 2;
        const flight: Flight = {
            center,
            from,
            to,
            radius: [Math.max(1, Math.hypot(a.x, a.z)), Math.max(1, Math.hypot(b.x, b.z))],
            angle: [angleFrom, angleFrom + shortest],
            height: [a.y, b.y],
            maxPixelRatio,
            resized: false,
            started: 0,
            resolve: () => {},
        };
        // round the side where the desk and the rest block the car least
        const boxes = this.roomBoxes || this.obstacles(car);
        const blocked = (turn: number) => {
            flight.angle[1] = angleFrom + turn;
            const eye = new THREE.Vector3();
            const ray = new THREE.Ray();
            const hit = new THREE.Vector3();
            let count = 0;
            for (let i = 1; i < 24; i++) {
                this.pathPoint(flight, i / 24, eye);
                const distance = eye.distanceTo(center);
                ray.set(eye, center.clone().sub(eye).normalize());
                if (
                    boxes.some(
                        (box) =>
                            box.containsPoint(eye) ||
                            (ray.intersectBox(box, hit) && eye.distanceTo(hit) < distance)
                    )
                )
                    count++;
            }
            return count;
        };
        const turn = blocked(longest) < blocked(shortest) ? longest : shortest;
        flight.angle[1] = angleFrom + turn;
        return new Promise<void>((resolve) => {
            flight.started = performance.now();
            flight.resolve = resolve;
            this.flight = flight;
        });
    }

    // the other things in the room, as boxes. the room's shell (floor and
    // walls around everything) doesn't count
    obstacles(car: THREE.Object3D) {
        const raceRoot = this.application.world.raceManager?.raceRoot;
        const boxes: THREE.Box3[] = [];
        this.application.scene.children.forEach((child) => {
            if (child === car || child === raceRoot || !child.visible) return;
            if ((child as THREE.Light).isLight || (child as THREE.Camera).isCamera) return;
            const box = new THREE.Box3().setFromObject(child);
            if (box.isEmpty()) return;
            const size = box.getSize(new THREE.Vector3());
            if (Math.max(size.x, size.z) > 40000) return;
            boxes.push(box);
        });
        return boxes;
    }

    pathPoint(flight: Flight, e: number, target: THREE.Vector3) {
        const [r0, r1] = flight.radius;
        const radius = r0 * Math.pow(r1 / r0, e);
        const angle = flight.angle[0] + (flight.angle[1] - flight.angle[0]) * e;
        return target.set(
            flight.center.x + Math.sin(angle) * radius,
            flight.center.y + flight.height[0] + (flight.height[1] - flight.height[0]) * e,
            flight.center.z + Math.cos(angle) * radius
        );
    }

    flyStep() {
        const flight = this.flight;
        if (!flight) return;
        const camera = this.application.camera;
        const instance = camera.instance;
        const t = Math.min(1, (performance.now() - flight.started) / (FLY_SECONDS * 1000));
        const e = this.skipped ? 1 : FLY_EASE(t);
        this.applyRespray(THREE.MathUtils.smoothstep(t, 0.15, 0.75));
        // the resize is a slow frame, so it goes where the camera has all but
        // stopped
        if (!flight.resized && t > 0.95) {
            flight.resized = true;
            this.application.renderer.matchScenePixelRatio(flight.maxPixelRatio);
        }
        this.pathPoint(flight, e, instance.position);
        const look = flight.from.look.clone().lerp(flight.to.look, e);
        const up = flight.from.up.clone().lerp(flight.to.up, e).normalize();
        this.lookMatrix.lookAt(instance.position, look, up);
        instance.quaternion.setFromRotationMatrix(this.lookMatrix);
        instance.fov = flight.from.fov + (flight.to.fov - flight.from.fov) * e;
        instance.updateProjectionMatrix();
        if (e >= 1) {
            instance.position.copy(flight.to.position);
            this.lookMatrix.lookAt(flight.to.position, flight.to.look, flight.to.up);
            instance.quaternion.setFromRotationMatrix(this.lookMatrix);
            instance.fov = flight.to.fov;
            instance.updateProjectionMatrix();
            // the room camera rests here once the race is over
            camera.position.copy(flight.to.position);
            camera.focalPoint.copy(flight.to.look);
            this.flight = null;
            flight.resolve();
        }
    }

    playerName() {
        try {
            return window.localStorage.getItem(NAME_KEY) || 'Driver';
        } catch {
            return 'Driver';
        }
    }

    // a few even frames in a row, past the first frames' uploads. software gl
    // never gets under 40 ms, it counts frames not slower than twice the last
    smoothFrames(held: boolean, timeoutMs = held ? 1500 : 6000) {
        let last = performance.now();
        let previous = Infinity;
        let smooth = 0;
        return this.until(
            () => {
                const now = performance.now();
                const interval = now - last;
                smooth = interval < 40 || interval < previous * 2 ? smooth + 1 : 0;
                previous = interval;
                last = now;
                return smooth >= 3;
            },
            timeoutMs,
            undefined,
            held
        );
    }

    // resolves on the first frame check() holds, after timeoutMs, or when
    // skipped (unless held through a skip)
    until(check: () => boolean, timeoutMs: number, each?: () => void, throughSkip = false) {
        return new Promise<void>((resolve) => {
            const started = performance.now();
            const frame = () => {
                each?.();
                if (
                    (this.skipped && !throughSkip) ||
                    !this.busy ||
                    check() ||
                    performance.now() - started > timeoutMs
                ) {
                    resolve();
                    return;
                }
                requestAnimationFrame(frame);
            };
            frame();
        });
    }

    // every surface writes where it lands on the ring, through the car to car
    // mapping into the race world: meters from the reveal center along the
    // ground, height above the road, and whether it's the car
    createGroundMaterial(car = 0) {
        return new THREE.ShaderMaterial({
            name: 'race-transition-ground',
            uniforms: {
                uRaceFromRoom: { value: new THREE.Matrix4() },
                uCenter: { value: new THREE.Vector3() },
                uCar: { value: car },
            },
            vertexShader: /* glsl */ `
                uniform mat4 uRaceFromRoom;
                uniform vec3 uCenter;
                varying vec3 vGround;
                void main() {
                    vec4 world = modelMatrix * vec4(position, 1.0);
                    vGround = (uRaceFromRoom * world).xyz - uCenter;
                    gl_Position = projectionMatrix * viewMatrix * world;
                }
            `,
            fragmentShader: /* glsl */ `
                uniform float uCar;
                varying vec3 vGround;
                void main() {
                    gl_FragColor = vec4(vGround.xz, vGround.y, uCar);
                }
            `,
        });
    }

    // the room's last frame exactly as the screen shows it (its own pixels,
    // copied off the drawing buffer), and for the reveal to melt it by, where
    // each pixel lands on the ring. the car is drawn again on its own, flagged
    capturePlate(
        handoff: {
            raceFromRoom: THREE.Matrix4;
            center: THREE.Vector3;
            raceCamera: THREE.Camera;
            raceCar: THREE.Object3D;
        },
        spatial: boolean
    ) {
        const renderer = this.application.renderer.instance;
        const scene = this.application.scene;
        const camera = this.application.camera.instance;
        const size = renderer.getDrawingBufferSize(new THREE.Vector2());
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        const color = new THREE.FramebufferTexture(size.x, size.y);
        color.minFilter = THREE.LinearFilter;
        color.magFilter = THREE.LinearFilter;
        renderer.copyFramebufferToTexture(color);
        const target = new THREE.WebGLRenderTarget(spatial ? size.x : 1, spatial ? size.y : 1, {
            type: THREE.HalfFloatType,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
        });
        if (spatial) this.drawGround(target, handoff);
        return {
            color,
            ground: target.texture,
            dispose: () => {
                color.dispose();
                target.dispose();
            },
        };
    }

    // the room with every surface writing its ring position, then the car on
    // its own with its flag set, then the race car's outline flagged too (a
    // garage wing or other rims reach past the room car's), from the race
    // camera it will be seen from
    drawGround(
        target: THREE.WebGLRenderTarget,
        handoff: {
            raceFromRoom: THREE.Matrix4;
            center: THREE.Vector3;
            raceCamera?: THREE.Camera;
            raceCar?: THREE.Object3D;
        }
    ) {
        const renderer = this.application.renderer.instance;
        const scene = this.application.scene;
        const camera = this.application.camera.instance;
        const car = this.application.world.car?.model;
        if (!car) return;
        [this.groundMaterial, this.groundCarMaterial].forEach((material) => {
            material.uniforms.uRaceFromRoom.value.copy(handoff.raceFromRoom);
            material.uniforms.uCenter.value.copy(handoff.center);
        });
        const clearColor = renderer.getClearColor(new THREE.Color());
        const clearAlpha = renderer.getClearAlpha();
        const autoClear = renderer.autoClear;
        const override = scene.overrideMaterial;
        const previous = renderer.getRenderTarget();
        // nothing drawn reads as far away, it goes last
        renderer.setClearColor(new THREE.Color(1e4, 1e4, 0), 0);
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.autoClear = false;
        scene.overrideMaterial = this.groundMaterial;
        car.visible = false;
        renderer.render(scene, camera);
        car.visible = true;
        scene.overrideMaterial = override;
        // the soft contact shadow under each car is floor, not car: it melts
        // with the floor around it
        const drawFlagged = (model: THREE.Object3D, material: THREE.Material, view: THREE.Camera) => {
            const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
            const hidden: THREE.Object3D[] = [];
            model.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (!mesh.isMesh) return;
                if (/shadow/i.test(mesh.name) && mesh.visible) {
                    mesh.visible = false;
                    hidden.push(mesh);
                    return;
                }
                materials.set(mesh, mesh.material);
                mesh.material = material;
            });
            renderer.render(model, view);
            materials.forEach((original, mesh) => (mesh.material = original));
            hidden.forEach((mesh) => (mesh.visible = true));
        };
        drawFlagged(car, this.groundCarMaterial, camera);
        if (handoff.raceCar && handoff.raceCamera) {
            drawFlagged(handoff.raceCar, this.groundOutlineMaterial, handoff.raceCamera);
        }
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(previous);
        renderer.setClearColor(clearColor, clearAlpha);
    }

    // the room's film grain stays on (it's its own canvas over the scene) and
    // fades with the room, instead of blinking off when the race starts
    keepRoomGrain(on: boolean, amount = 1) {
        const renderer = this.application.renderer;
        const grain = renderer.overlayInstance.domElement;
        renderer.keepGrain = on;
        if (!on) {
            grain.style.opacity = '0.12';
            renderer.applyEffects();
            return;
        }
        if (!renderer.effectsLow) grain.style.display = '';
        grain.style.opacity = String(0.12 * amount);
    }

    skip() {
        if (!this.busy || this.skipped) return;
        this.skipped = true;
        this.returnFocus();
        // the camera jump and the race start still happen, just at once
        TWEEN.removeAll();
        UIEventBus.dispatch('race:transitionSkip', {});
        this.flyStep();
        this.application.world.raceManager?.visuals.reveal.finish();
    }

    // undoes start() when the race never loaded, before anything moved
    abort() {
        this.busy = false;
        this.letResolutionGo();
        window.removeEventListener('keydown', this.skipHandler, true);
        window.removeEventListener('pointerdown', this.skipHandler, true);
        document.body.classList.remove('race-transition');
        UIEventBus.dispatch('race:transitionLock', { locked: false });
    }

    finish(manager: RaceManager) {
        mark('done');
        this.flight = null;
        this.tickActions = [];
        // the room is hidden now, it gets its own car look back
        this.applyRespray(0);
        this.respray = null;
        this.application.camera.externalControl = null;
        manager.visuals.reveal.finish();
        this.plate?.dispose();
        this.plate = null;
        if (manager.transitionHold) {
            manager.transitionHold = false;
            // the lap clock starts as the hud comes in
            manager.startLapTimer();
        }
        this.keepRoomGrain(false);
        this.busy = false;
        this.letResolutionGo();
        window.removeEventListener('keydown', this.skipHandler, true);
        window.removeEventListener('pointerdown', this.skipHandler, true);
        this.returnFocus();
        UIEventBus.dispatch('race:transitionLock', { locked: false });
        // the race's panels fade in
        const body = document.body.classList;
        body.add('race-transition-out');
        body.remove('race-transition');
        window.setTimeout(() => body.remove('race-transition-out'), 700);
        // solo, quick join or an invite link, asked once the ring is built.
        // an invite link already picked the lobby
        if (manager.active && !getInviteLobbyCode()) {
            UIEventBus.dispatch('race:lobbyChoice', {});
        }
    }

    // keys go to the page, never to the iframe or a button left focused
    returnFocus() {
        const active = document.activeElement as HTMLElement | null;
        if (active && active !== document.body) active.blur?.();
        window.focus();
    }
}
