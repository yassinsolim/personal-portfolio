// lets node scripts import the game's plain typescript modules (the ones with
// no three.js or dom, like the driving model). node strips the types itself;
// this adds the '.ts' the source imports leave off, and loads them as modules
import { registerHooks } from 'node:module';

registerHooks({
    resolve(specifier, context, nextResolve) {
        try {
            return nextResolve(specifier, context);
        } catch (error) {
            const relative = /^\.{1,2}\//.test(specifier);
            const bare = !/\.[a-z]+$/i.test(specifier);
            if (error?.code === 'ERR_MODULE_NOT_FOUND' && relative && bare) {
                return nextResolve(`${specifier}.ts`, context);
            }
            throw error;
        }
    },
    load(url, context, nextLoad) {
        if (url.endsWith('.ts')) {
            return nextLoad(url, { ...context, format: 'module-typescript' });
        }
        return nextLoad(url, context);
    },
});
