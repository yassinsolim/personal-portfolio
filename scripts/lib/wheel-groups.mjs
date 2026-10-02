// some sketchfab exports keep all four wheels in one node, or a wheel and its
// caliper mixed in hundreds of pieces. groupWheels regroups them into
// wheel_fl/fr/rl/rr and caliper_* nodes, each centred on its wheel with one
// mesh per material, so the race rig finds four wheels by name and draws a few
// dozen meshes instead of a thousand. optimize-models.mjs runs it on the
// original download before everything else
import { getBounds, joinPrimitives, transformPrimitive } from '@gltf-transform/functions';

// wheels: nodes whose meshes spin. calipers: nodes, or materials among the
// wheel parts, that stay put. forward: the model axis the nose points along
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

// returns a line per corner (centre and size in meters) for the log
export const groupWheels = (doc, carId, lengthMeters) => {
    const config = WHEEL_GROUPS[carId];
    if (!config) return [];
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
    for (const part of parts) {
        const corner = cornerOf(part.box);
        for (const prim of part.node.getMesh().listPrimitives()) {
            const material = prim.getMaterial()?.getName() || '';
            const kind = part.kind === 'wheel' && config.caliperMaterial?.test(material) ? 'caliper' : part.kind;
            const key = `${kind}_${corner}`;
            if (!groups.has(key)) groups.set(key, { corner, box: EMPTY_BOX(), items: [] });
            const group = groups.get(key);
            group.items.push({ node: part.node, prim });
            if (kind === 'wheel') group.box = grow(group.box, part.box);
        }
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
            sources.add(item.node);
            const copy = ownCopy(doc, item.prim);
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
