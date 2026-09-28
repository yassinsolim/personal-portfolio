// lets node import the game's typescript for tests: extensionless relative
// imports resolve to .ts, .ts is transpiled with the repo's typescript and
// src/tsconfig.json, and the Application singleton is swapped for a stand-in
// (stubs/Application.mjs) so nothing pulls in the whole site
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const application = path.join(root, 'src/Application/Application.ts');
const applicationStub = pathToFileURL(
    path.join(here, 'stubs/Application.mjs')
).href;

const tsconfig = ts.readConfigFile(
    path.join(root, 'src/tsconfig.json'),
    ts.sys.readFile
);
const compilerOptions = {
    ...ts.convertCompilerOptionsFromJson(
        tsconfig.config.compilerOptions,
        path.join(root, 'src')
    ).options,
    module: ts.ModuleKind.ESNext,
    // the build targets es6, keep its class field semantics
    target: ts.ScriptTarget.ES2022,
    useDefineForClassFields: false,
    sourceMap: false,
    inlineSourceMap: true,
    inlineSources: true,
};

const isFile = (file) => {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
};

registerHooks({
    resolve(specifier, context, nextResolve) {
        const parent = context.parentURL;
        if (parent?.startsWith('file:') && /^\.\.?\//.test(specifier)) {
            const target = fileURLToPath(new URL(specifier, parent));
            const candidates = isFile(target)
                ? [target]
                : [
                      `${target}.ts`,
                      `${target}.tsx`,
                      path.join(target, 'index.ts'),
                  ];
            const file = candidates.find(isFile);
            if (file === application)
                return { url: applicationStub, shortCircuit: true };
            if (file && /\.tsx?$/.test(file)) {
                return {
                    url: pathToFileURL(file).href,
                    format: 'module',
                    shortCircuit: true,
                };
            }
        }
        return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
        if (url.startsWith('file:') && /\.tsx?$/.test(url)) {
            const file = fileURLToPath(url);
            const { outputText } = ts.transpileModule(
                fs.readFileSync(file, 'utf8'),
                {
                    compilerOptions,
                    fileName: file,
                }
            );
            return { format: 'module', source: outputText, shortCircuit: true };
        }
        return nextLoad(url, context);
    },
});
