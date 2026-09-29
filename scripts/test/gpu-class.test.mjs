// auto's starting tier from the renderer string: every string here is the
// shape a real browser reports (chrome and edge through angle, firefox's
// sanitized stand ins, safari, software rasterizers, chromebooks)
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const { classifyGpu } = await import('../../src/Application/Utils/gpuClass.ts');

const laptop = { cores: 8, memoryGb: 8 };
const cases = [
    // chrome / edge on windows
    [
        'Google Inc. (Intel)',
        'ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (Intel)',
        'ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (Intel)',
        'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (Intel)',
        'ANGLE (Intel, Intel(R) HD Graphics 520 (0x00001916) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (Intel)',
        'ANGLE (Intel, Intel(R) Arc(TM) Graphics (0x00007D55) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (Intel)',
        'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics (0x000056A0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'discrete',
        'high',
    ],
    [
        'Google Inc. (AMD)',
        'ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (AMD)',
        'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics (0x000015D8) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (AMD)',
        'ANGLE (AMD, AMD Radeon 780M Graphics (0x000015BF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (AMD)',
        'ANGLE (AMD, AMD Radeon RX 6600M (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'discrete',
        'high',
    ],
    [
        'Google Inc. (NVIDIA)',
        'ANGLE (NVIDIA, NVIDIA GeForce MX450 (0x00001F97) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'discrete-low',
        'low',
    ],
    [
        'Google Inc. (NVIDIA)',
        'ANGLE (NVIDIA, NVIDIA GeForce MX150 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'discrete-low',
        'low',
    ],
    [
        'Google Inc. (NVIDIA)',
        'ANGLE (NVIDIA, NVIDIA GeForce 940MX Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'discrete-low',
        'low',
    ],
    [
        'Google Inc. (NVIDIA)',
        'ANGLE (NVIDIA, NVIDIA GeForce GT 1030 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'discrete-low',
        'low',
    ],
    [
        'Google Inc. (NVIDIA)',
        'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F91) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'discrete',
        'high',
    ],
    [
        'Google Inc. (NVIDIA)',
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'discrete',
        'high',
    ],
    [
        'Google Inc. (NVIDIA)',
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'discrete',
        'high',
    ],
    // firefox's sanitized names
    ['Intel', 'Intel(R) HD Graphics 400', 'integrated', 'low'],
    [
        'Google Inc.',
        'ANGLE (Intel(R) HD Graphics Direct3D11 vs_5_0 ps_5_0)',
        'integrated',
        'low',
    ],
    ['NVIDIA Corporation', 'NVIDIA GeForce GTX 980', 'unknown', 'high'],
    ['ATI Technologies Inc.', 'Radeon R9 200 Series', 'unknown', 'high'],
    ['Mozilla', 'Generic Renderer', 'unknown', 'high'],
    // mac
    ['Apple Inc.', 'Apple GPU', 'apple', 'high'],
    [
        'Google Inc. (Apple)',
        'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)',
        'apple',
        'high',
    ],
    [
        'Google Inc. (Intel Inc.)',
        'ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)',
        'integrated',
        'low',
    ],
    // software
    [
        'Google Inc. (Google)',
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
        'software',
        'low',
    ],
    ['Google Inc.', 'Google SwiftShader', 'software', 'low'],
    ['Mesa', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'software', 'low'],
    [
        'Microsoft',
        'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'software',
        'low',
    ],
    // linux and chromebooks
    [
        'Google Inc. (Intel)',
        'ANGLE (Intel, Mesa Intel(R) UHD Graphics 600 (GLK 2), OpenGL ES 3.2)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (Intel)',
        'ANGLE (Intel, Mesa Intel(R) Graphics (ADL GT2), OpenGL ES 3.2)',
        'integrated',
        'low',
    ],
    [
        'Google Inc. (ARM)',
        'ANGLE (ARM, Mali-G72, OpenGL ES 3.2)',
        'mobile',
        'low',
    ],
    [
        'Google Inc. (Qualcomm)',
        'ANGLE (Qualcomm, Adreno (TM) 618, OpenGL ES 3.2)',
        'mobile',
        'low',
    ],
    [
        'AMD',
        'AMD Radeon Graphics (renoir, LLVM 15.0.6, DRM 3.49, 6.1.0)',
        'integrated',
        'low',
    ],
];

for (const [vendor, renderer, kind, tier] of cases) {
    test(`${renderer}`, () => {
        const result = classifyGpu({ vendor, renderer, ...laptop });
        assert.equal(result.kind, kind, result.reason);
        assert.equal(result.tier, tier, result.reason);
    });
}

test('a small cpu or little memory goes low whatever the gpu', () => {
    const renderer =
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)';
    assert.equal(classifyGpu({ renderer, cores: 4, memoryGb: 16 }).tier, 'low');
    assert.equal(classifyGpu({ renderer, cores: 12, memoryGb: 4 }).tier, 'low');
    assert.equal(classifyGpu({ renderer, cores: 12 }).tier, 'high');
});

test('phones and tablets go low', () => {
    assert.equal(
        classifyGpu({ renderer: 'Apple GPU', mobile: true, ...laptop }).tier,
        'low'
    );
});

const { calibrate } = await import('../../src/Application/Utils/gpuClass.ts');

test('a slow homepage or a slow race before sends a high guess low', () => {
    const high = classifyGpu({ renderer: 'Apple GPU', ...laptop });
    assert.equal(
        calibrate(high, { homeP50: 16.7, homeFrames: 300 }).tier,
        'high'
    );
    assert.equal(calibrate(high, { homeP50: 45, homeFrames: 120 }).tier, 'low');
    // too few frames to judge
    assert.equal(calibrate(high, { homeP50: 45, homeFrames: 10 }).tier, 'high');
    // under 10 fps: 6 s of homepage is only a few dozen frames, still enough
    assert.equal(calibrate(high, { homeP50: 150, homeFrames: 40 }).tier, 'low');
    assert.equal(calibrate(high, { homeP50: 400, homeFrames: 15 }).tier, 'low');
    assert.equal(calibrate(high, { slowBefore: true }).tier, 'low');
    const low = classifyGpu({ renderer: 'Google SwiftShader', ...laptop });
    assert.equal(calibrate(low, { homeP50: 10, homeFrames: 300 }).tier, 'low');
});
