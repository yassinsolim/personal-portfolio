// the monitor loader's gpu line: renderer strings from chromium (angle on
// metal, d3d11, opengl, vulkan), safari, android and software gl, prettified
//
//   npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import './ts-hooks.mjs';

const { prettyGpu } = await import('../../src/Application/Utils/hardwareInfo.ts');

const cases = [
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)', 'Apple M5', 'Metal'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 5080', 'Direct3D 11'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Intel UHD Graphics 630', 'Direct3D 11'],
    ['ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'AMD Radeon RX 6800 XT', 'Direct3D 11'],
    ['ANGLE (NVIDIA Corporation, NVIDIA GeForce GTX 1080/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 535.54.03)', 'NVIDIA GeForce GTX 1080', 'OpenGL'],
    ['ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)', 'Intel Iris Plus Graphics 655', 'OpenGL'],
    ['ANGLE (ATI Technologies Inc., AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)', 'AMD Radeon Pro 5500M', 'OpenGL'],
    ['ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)', 'Adreno 740', 'OpenGL ES'],
    ['Apple GPU', 'Apple GPU', ''],
    ['Mali-G78 MC24', 'Mali-G78 MC24', ''],
];

for (const [renderer, name, api] of cases) {
    test(`${name} from ${renderer.slice(0, 48)}`, () => {
        const gpu = prettyGpu(renderer);
        assert.equal(gpu.name, name);
        assert.equal(gpu.api, api);
        assert.equal(gpu.software, false);
    });
}

test('software renderers say so', () => {
    const swiftshader = prettyGpu(
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'
    );
    assert.equal(swiftshader.software, true);
    assert.match(swiftshader.name, /^SwiftShader \(software/);
    assert.equal(prettyGpu('llvmpipe (LLVM 15.0.7, 256 bits)').software, true);
});

test('an empty string stays readable', () => {
    assert.equal(prettyGpu('').name, 'unknown GPU');
});
