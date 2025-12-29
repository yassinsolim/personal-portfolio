const getWebGLContext = () => {
    const canvas = document.createElement('canvas');

    return (
        canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl')
    );
};

const isWebGLAvailable = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    const hasWebGLContext =
        typeof WebGLRenderingContext !== 'undefined' ||
        typeof WebGL2RenderingContext !== 'undefined';

    if (!hasWebGLContext) {
        return false;
    }

    try {
        return !!getWebGLContext();
    } catch (error) {
        return false;
    }
};

export { isWebGLAvailable };
