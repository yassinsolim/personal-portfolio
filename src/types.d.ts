type Resource =
    | TextureResource
    | CubeTextureResource
    | ModelResource
    | AudioResource
    | JsonResource;

declare interface StyleSheetCSS {
    [key: string]: React.CSSProperties;
}

type TextureResource = {
    name: string;
    type: 'texture';
    path: string;
    // set at load, so the texture can go to the gpu before its model exists
    flipY?: boolean;
};

type CubeTextureResource = {
    name: string;
    type: 'cubeTexture';
    path: string[];
};

type ModelResource = {
    name: string;
    type: 'gltfModel';
    path: string;
};

type AudioResource = {
    name: string;
    type: 'audio';
    path: string;
};

type JsonResource = {
    name: string;
    type: 'json';
    path: string;
};

type EnclosingPlane = {
    size: THREE.Vector2;
    position: THREE.Vector3;
    rotation: THREE.Euler;
};

type CameraKeyframe = {
    position: THREE.Vector3;
    focalPoint: THREE.Vector3;
};

type LoadedResource =
    | LoadedTexture
    | LoadedCubeTexture
    | LoadedModel
    | LoadedAudio
    | LoadedJson;

type LoadedTexture = THREE.Texture;

type LoadedModel = import('three/examples/jsm/loaders/GLTFLoader').GLTF;

type LoadedCubeTexture = THREE.CubeTexture;

type LoadedAudio = AudioBuffer;

type LoadedJson = Record<string, any>;

type ResourceType = 'texture' | 'cubeTexture' | 'gltfModel' | 'audio' | 'json';

// path under static/ -> content hash, and -> size in bytes, set by the
// production build
declare const __ASSET_VERSIONS__: Record<string, string>;
declare const __ASSET_SIZES__: Record<string, number>;
