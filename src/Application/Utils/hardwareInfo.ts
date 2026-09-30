// the gpu line in the loading screen's log: the renderer string cleaned up
// ("ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)" to
// "Apple M5", with the backend). the renderer string itself comes from
// gpuClass.ts's readRenderer

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;

const apiOf = (text: string) => {
    if (/metal/i.test(text)) return 'Metal';
    if (/direct3d ?11|d3d11/i.test(text)) return 'Direct3D 11';
    if (/direct3d ?9|d3d9/i.test(text)) return 'Direct3D 9';
    if (/vulkan/i.test(text)) return 'Vulkan';
    if (/opengl es/i.test(text)) return 'OpenGL ES';
    if (/opengl/i.test(text)) return 'OpenGL';
    return '';
};

// "ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)" to
// "Apple M5", "ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 (0x00002C02)
// Direct3D11 vs_5_0 ps_5_0, D3D11)" to "NVIDIA GeForce RTX 5080"
export const prettyGpu = (renderer: string) => {
    const raw = renderer.trim();
    const angle = /^ANGLE \((.*)\)$/.exec(raw);
    const parts = angle ? angle[1].split(', ') : [raw];
    let name = angle ? parts[1] || parts[0] : raw;
    const api = apiOf(angle ? parts.slice(1).join(' ') : raw);
    if (SOFTWARE.test(raw)) {
        const which = /swiftshader|llvmpipe|softpipe|lavapipe/i.exec(raw);
        return { name: `${which ? which[0] : 'Software'} (software, no GPU)`, api, software: true };
    }
    name = name
        .replace(/^ANGLE \w+ Renderer: /i, '')
        .replace(/\((?:R|TM)\)/gi, '')
        .replace(/\(0x[0-9a-f]+\)/gi, '')
        .replace(/Direct3D\d+.*$/i, '')
        .replace(/vs_\d_\d.*$/i, '')
        .replace(/\/PCIe.*$/i, '')
        .replace(/ OpenGL Engine$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    return { name: name || raw || 'unknown GPU', api, software: false };
};

export const formatBytes = (bytes: number) => {
    if (bytes < 0) return '?';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};
