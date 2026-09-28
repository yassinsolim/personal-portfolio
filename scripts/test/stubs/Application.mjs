// stand-in for src/Application/Application.ts in node tests. the real one is a
// singleton that builds the whole site; tests set globalThis.__testApplication
// to the few fields the code under test reads (resources, scene, time)
export default class Application {
    constructor() {
        if (!globalThis.__testApplication) {
            throw new Error(
                'set globalThis.__testApplication before building race objects'
            );
        }
        return globalThis.__testApplication;
    }
}
