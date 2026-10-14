// some sketchfab exports keep all four wheels in one node, or a wheel and its
// caliper mixed in hundreds of pieces. groupWheels regroups them into
// wheel_fl/fr/rl/rr and caliper_* nodes, each centred on its wheel with one
// mesh per material, so the race rig finds four wheels by name and draws a few
// dozen meshes instead of a thousand. optimize-models.mjs runs it on the
// original download before everything else
import { compactPrimitive, getBounds, joinPrimitives, transformPrimitive } from '@gltf-transform/functions';

// wheels: nodes whose meshes spin. calipers: nodes, or materials among the
// wheel parts, that stay put. forward: the model axis the nose points along.
// unskin: a rigged game export, baked into plain meshes first (unskin below)
export const WHEEL_GROUPS = {
    'ferrari-laferrari': {
        wheels: /^Combined_Wheels_3D_$/,
        calipers: /^Combined_CaliperBodies$/,
        forward: 1,
    },
    'lamborghini-huracan': {
        wheels: /^Combined_Wheels_3D_$/,
        calipers: /^Calliper2_Gloss_B\(Clone\)$/,
        forward: 1,
    },
    'porsche-918-spyder': {
        wheels: /^Calliper (Front|Rear) [LR]_0\d$/,
        caliperMaterial: /call?iper/i,
        forward: 1,
    },
    'lamborghini-aventador-s': {
        wheels: /^3DWheel (Front|Rear) [LR]$/,
        calipers: /^Calliper (Front|Rear) [LR]_0\d$/,
        forward: 1,
    },
    'mclaren-p1': {
        wheels: /^WHEEL_[LR][FR]$/,
        calipers: /^DISC_[LR][FR]$/,
        forward: 1,
    },
    'bugatti-chiron-super-sport': {
        wheels: /^3DWheel (Front|Rear) [LR]$/,
        caliperMaterial: /calliper/i,
        forward: 1,
    },
    'koenigsegg-jesko': {
        wheels: /^(jesko:)?LOD_A_(WHEEL_mm_wheel|TYRE_mm_tyre|ROTOR_mm_rotor)\d?$/,
        calipers: /^jesko:LOD_A_BRAKE_CALIPER_(FRONT|REAR)_(LEFT|RIGHT)_mm_misc$/,
        forward: 1,
    },
    // tyres come one per corner, but one mesh holds all four rims and a few
    // more hold the brakes
    'pagani-huayra': {
        wheels: /^Object_(5[0-3]|56|62)$/,
        calipers: /^Object_(4[89]|57|58)$/,
        forward: 1,
    },
    'mclaren-senna': {
        wheels: /^3DWheel (Front|Rear) [LR]$/,
        calipers: /^Calliper (Front|Rear) [LR]_0\d$/,
        forward: 1,
    },
    'ferrari-sf90-stradale': {
        wheels: /^Combined_Wheels_3D_$/,
        calipers: /^Combined_CaliperCalliperZone$/,
        forward: 1,
    },
    // same here: tyres per corner, rims and brakes shared
    'aston-martin-valkyrie': {
        wheels: /^Object_(1[7-9]|20|4[237]|5[12])$/,
        calipers: /^Object_(14|15|29)$/,
        forward: 1,
    },
    // rigged: a joint per wheel and caliper, named by corner. its calipers
    // come in four offsets; the second straddles the stock disc
    'toyota-supra-mk4': {
        unskin: true,
        variant: 1,
        wheels: /^Wheel (Front|Rear) [LR]_\d+\//,
        calipers: /^Calliper (Front|Rear) [LR]_\d+\//,
        forward: 1,
    },
    // a node per corner holds its tyre, hub, disc and caliper
    'amg-one': {
        wheels: /^amgprojone_tire(\.\d+)?$/,
        caliperMaterial: /Tire_Brake/,
        forward: 1,
    },
};

const EMPTY_BOX = () => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const grow = (box, other) => ({
    min: box.min.map((v, i) => Math.min(v, other.min[i])),
    max: box.max.map((v, i) => Math.max(v, other.max[i])),
});
const center = (box) => box.min.map((v, i) => (v + box.max[i]) / 2);
const signature = (prim) =>
    [prim.getMaterial()?.getName() || '', prim.getMode(), ...prim.listSemantics().sort((a, b) => a.localeCompare(b))].join('|');

// a copy with its own accessors, so baking a transform into it leaves shared
// (instanced) geometry alone
const ownCopy = (doc, prim) => {
    const copy = doc.createPrimitive().setMode(prim.getMode()).setMaterial(prim.getMaterial());
    for (const semantic of prim.listSemantics()) copy.setAttribute(semantic, prim.getAttribute(semantic).clone());
    if (prim.getIndices()) copy.setIndices(prim.getIndices().clone());
    return copy;
};

// the same vertices drawn with only the listed triangles, unused ones dropped
const withTriangles = (doc, prim, list) => {
    const buffer = prim.getAttribute('POSITION').getBuffer();
    const indices = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(buffer);
    compactPrimitive(prim.setIndices(indices));
    prim.getIndices().setBuffer(buffer);
    return prim;
};

// one mesh can hold the rims of all four wheels, or every caliper. each
// triangle goes to the corner it sits in, as long as it is near that wheel;
// the rest stays on the body. returns the pieces with their world boxes
const splitByCorner = (doc, node, prim, cornerAt, near) => {
    const position = prim.getAttribute('POSITION');
    const indices = prim.getIndices();
    const count = indices ? indices.getCount() : position.getCount();
    const world = node.getWorldMatrix();
    const corners = new Map();
    const rest = [];
    const local = [0, 0, 0];
    for (let t = 0; t + 2 < count; t += 3) {
        const tri = [t, t + 1, t + 2].map((i) => (indices ? indices.getScalar(i) : i));
        const points = tri.map((i) => {
            position.getElement(i, local);
            return [0, 1, 2].map(
                (a) => world[a] * local[0] + world[4 + a] * local[1] + world[8 + a] * local[2] + world[12 + a],
            );
        });
        const c = [0, 1, 2].map((a) => (points[0][a] + points[1][a] + points[2][a]) / 3);
        const corner = cornerAt(c);
        if (!near(corner, c)) {
            rest.push(...tri);
            continue;
        }
        if (!corners.has(corner)) corners.set(corner, { list: [], box: EMPTY_BOX() });
        const piece = corners.get(corner);
        piece.list.push(...tri);
        for (const p of points) piece.box = grow(piece.box, { min: p, max: p });
    }
    const pieces = [...corners].map(([corner, { list, box }]) => {
        const piece = doc.createPrimitive().setMode(prim.getMode()).setMaterial(prim.getMaterial());
        for (const semantic of prim.listSemantics()) piece.setAttribute(semantic, prim.getAttribute(semantic));
        return { corner, box, prim: withTriangles(doc, piece, list) };
    });
    return { pieces, rest };
};

const multiply = (a, b) => {
    const out = new Array(16).fill(0);
    for (let col = 0; col < 4; col++) {
        for (let row = 0; row < 4; row++) {
            for (let k = 0; k < 4; k++) out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
        }
    }
    return out;
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// a rigged game export draws every part through a skeleton (wheels, doors,
// the steering wheel each on a joint). this bakes the pose it's saved in
// into plain meshes in scene space: each node goes to the scene root, named
// after the joint most of it hangs on. a part kept in several variants on one
// joint (the supra's calipers, one per wheel offset) keeps only the variant'th
const unskin = (doc, variant = 0) => {
    const root = doc.getRoot();
    const scene = root.getDefaultScene() || root.listScenes()[0];
    const variants = [];
    for (const node of root.listNodes()) {
        const skin = node.getSkin();
        const mesh = node.getMesh();
        if (!skin || !mesh) continue;
        const inverseBind = skin.getInverseBindMatrices();
        const joints = skin.listJoints().map((joint, i) =>
            multiply(joint.getWorldMatrix(), inverseBind ? inverseBind.getElement(i, []) : IDENTITY),
        );
        const counts = new Map();
        const baked = doc.createMesh(mesh.getName());
        for (const prim of mesh.listPrimitives()) {
            const copy = ownCopy(doc, prim);
            const sets = [0, 1].filter((set) => copy.getAttribute(`JOINTS_${set}`));
            const matrixOf = (i) => {
                const m = new Array(16).fill(0);
                for (const set of sets) {
                    const j = copy.getAttribute(`JOINTS_${set}`).getElement(i, []);
                    const w = copy.getAttribute(`WEIGHTS_${set}`).getElement(i, []);
                    j.forEach((joint, k) => {
                        if (!w[k]) return;
                        joints[joint].forEach((v, e) => (m[e] += v * w[k]));
                        counts.set(joint, (counts.get(joint) || 0) + w[k]);
                    });
                }
                return m;
            };
            const position = copy.getAttribute('POSITION');
            const normal = copy.getAttribute('NORMAL');
            const tangent = copy.getAttribute('TANGENT');
            const p = [];
            for (let i = 0; i < position.getCount(); i++) {
                const m = matrixOf(i);
                position.getElement(i, p);
                position.setElement(i, [0, 1, 2].map((a) => m[a] * p[0] + m[4 + a] * p[1] + m[8 + a] * p[2] + m[12 + a]));
                for (const [attribute, size] of [[normal, 3], [tangent, 4]]) {
                    if (!attribute) continue;
                    const v = attribute.getElement(i, []);
                    const t = [0, 1, 2].map((a) => m[a] * v[0] + m[4 + a] * v[1] + m[8 + a] * v[2]);
                    const length = Math.hypot(...t) || 1;
                    attribute.setElement(i, size === 4 ? [...t.map((x) => x / length), v[3]] : t.map((x) => x / length));
                }
            }
            for (const set of sets) {
                copy.setAttribute(`JOINTS_${set}`, null);
                copy.setAttribute(`WEIGHTS_${set}`, null);
            }
            baked.addPrimitive(copy);
        }
        const [joint] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
        const name = `${skin.listJoints()[joint]?.getName() || 'part'}/${node.getName()}`;
        const part = doc.createNode(name).setMesh(baked);
        const box = getBounds(part);
        const middle = center(box);
        const reach = Math.hypot(...box.max.map((v, i) => v - box.min[i])) / 2;
        const key = `${joint}:${baked.listPrimitives().map((prim) => `${prim.getMaterial()?.getName()}:${prim.getAttribute('POSITION').getCount()}`).join()}`;
        // the same part moved a little, not its mirror image across the car
        const set = variants.find((other) => other.key === key && Math.hypot(...other.middle.map((v, i) => v - middle[i])) < reach);
        if (set) set.parts.push(part);
        else variants.push({ key, middle, parts: [part] });
        node.setSkin(null).setMesh(null);
    }
    for (const { key, parts } of variants) {
        if (parts.length > 1 && parts.length <= variant) throw new Error(`unskin: ${key} has ${parts.length} variants, no ${variant}`);
        parts.forEach((part, i) => {
            if (i === (parts.length > 1 ? variant : 0)) scene.addChild(part);
            else part.dispose();
        });
    }
    root.listSkins().forEach((skin) => skin.dispose());
};

// returns a line per corner (centre and size in meters) for the log
export const groupWheels = (doc, carId, lengthMeters) => {
    const config = WHEEL_GROUPS[carId];
    if (!config) return [];
    if (config.unskin) unskin(doc, config.variant);
    const root = doc.getRoot();
    const scene = root.getDefaultScene() || root.listScenes()[0];
    const sceneBox = getBounds(scene);
    const meters = lengthMeters / Math.max(...sceneBox.max.map((v, i) => v - sceneBox.min[i]));

    const parts = [];
    const taken = new Set();
    const collect = (pattern, kind) => {
        if (!pattern) return;
        for (const node of root.listNodes().filter((n) => pattern.test(n.getName()))) {
            node.traverse((child) => {
                if (!child.getMesh() || taken.has(child)) return;
                taken.add(child);
                parts.push({ node: child, kind, box: getBounds(child) });
            });
        }
    };
    collect(config.calipers, 'caliper');
    collect(config.wheels, 'wheel');
    if (!parts.some((part) => part.kind === 'wheel')) throw new Error(`${carId}: no wheel nodes matched`);

    const mid = center(parts.filter((p) => p.kind === 'wheel').reduce((box, p) => grow(box, p.box), EMPTY_BOX()));
    const cornerOf = (box) => {
        const c = center(box);
        const front = (c[2] - mid[2]) * config.forward > 0;
        // +x is the car's left when it faces +z
        const left = (c[0] - mid[0]) * config.forward > 0;
        return `${front ? 'f' : 'r'}${left ? 'l' : 'r'}`;
    };

    const groups = new Map();
    const add = (kind, corner, item, box) => {
        const key = `${kind}_${corner}`;
        if (!groups.has(key)) groups.set(key, { corner, box: EMPTY_BOX(), items: [] });
        const group = groups.get(key);
        group.items.push(item);
        if (kind === 'wheel') group.box = grow(group.box, box);
    };
    const kindOf = (part, prim) =>
        part.kind === 'wheel' && config.caliperMaterial?.test(prim.getMaterial()?.getName() || '') ? 'caliper' : part.kind;
    const spans = (box) => [0, 2].some((i) => box.min[i] < mid[i] && box.max[i] > mid[i]);
    for (const part of parts.filter((p) => !spans(p.box))) {
        const corner = cornerOf(part.box);
        for (const prim of part.node.getMesh().listPrimitives()) add(kindOf(part, prim), corner, { node: part.node, prim }, part.box);
    }

    // the wheels found whole say where a shared mesh's triangles may go
    const wheels = {};
    for (const [key, group] of groups) {
        if (!key.startsWith('wheel_')) continue;
        const size = group.box.max.map((v, i) => v - group.box.min[i]);
        wheels[group.corner] = { c: center(group.box), r: Math.max(size[1], size[2]) / 2 };
    }
    const cornerAt = (p) => cornerOf({ min: p, max: p });
    const near = (corner, p) => {
        const wheel = wheels[corner];
        if (!wheel) return true;
        return Math.hypot(p[1] - wheel.c[1], p[2] - wheel.c[2]) <= wheel.r * 1.05 && Math.abs(p[0] - wheel.c[0]) <= wheel.r;
    };
    const split = new Set();
    for (const part of parts.filter((p) => spans(p.box))) {
        const mesh = part.node.getMesh();
        for (const prim of [...mesh.listPrimitives()]) {
            const { pieces, rest } = splitByCorner(doc, part.node, prim, cornerAt, near);
            for (const piece of pieces) add(kindOf(part, prim), piece.corner, { node: part.node, prim: piece.prim, piece: true }, piece.box);
            if (rest.length) withTriangles(doc, prim, rest);
            else {
                mesh.removePrimitive(prim);
                prim.dispose();
            }
        }
        split.add(part.node);
    }

    const log = [];
    const hubs = {};
    for (const [key, group] of groups) {
        if (!key.startsWith('wheel_')) continue;
        hubs[group.corner] = center(group.box);
        const size = group.box.max.map((v, i) => ((v - group.box.min[i]) * meters).toFixed(3));
        log.push(`${key} centre ${hubs[group.corner].map((v) => (v * meters).toFixed(3)).join(',')} size ${size.join(',')}`);
    }

    const sources = new Set();
    for (const [key, group] of groups) {
        const origin = hubs[group.corner];
        const node = doc.createNode(key).setTranslation(origin);
        scene.addChild(node);
        const bySignature = new Map();
        for (const item of group.items) {
            if (!split.has(item.node) || !item.node.getMesh().listPrimitives().length) sources.add(item.node);
            const copy = item.piece ? item.prim : ownCopy(doc, item.prim);
            const local = [...item.node.getWorldMatrix()];
            for (let i = 0; i < 3; i++) local[12 + i] -= origin[i];
            transformPrimitive(copy, local);
            const sig = signature(copy);
            if (!bySignature.has(sig)) bySignature.set(sig, []);
            bySignature.get(sig).push(copy);
        }
        for (const prims of bySignature.values()) {
            const name = `${key}_${prims[0].getMaterial()?.getName() || 'part'}`;
            const joined = prims.length > 1 ? joinPrimitives(prims) : prims[0];
            if (prims.length > 1) prims.forEach((p) => p.dispose());
            node.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(joined)));
        }
    }

    // the originals go, with the branches they leave empty: an empty WHEEL_RR
    // would still match the rig's wheel_rr lookup
    for (const source of sources) {
        source.setMesh(null);
        let node = source;
        while (node && !node.getMesh() && !node.listChildren().length) {
            const parent = node.getParentNode();
            node.dispose();
            node = parent;
        }
    }
    // a couple of the exports carry an unused skeleton
    root.listSkins().forEach((skin) => skin.dispose());
    return log;
};
