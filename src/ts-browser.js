
import {b64EncodeUnicode} from "./utils.js";
import {addPathToUrl} from "./UrlPathResolver.js";
import {CACHE_LOADED, IMPORT_DYNAMIC} from "./actions/ParseTsModule.js";
import WorkerManager from "./WorkerManager.js";

/**
 * @module ts-browser - like ts-node, this tool allows you
 * to require typescript files and compiles then on the fly
 */

const tryLoadSideEffectsJsModule = (jsCode) => {
    try {
        // trying to support non es6 modules
        const globalsBefore = new Set(Object.keys(window));
        const self = {};
        const evalResult = eval.apply(self, [jsCode]);
        const newGlobals = Object.keys(window)
            .filter(k => !globalsBefore.has(k));
        const result = {};
        for (const name of newGlobals) {
            result[name] = window[name];
        }
        if (new Set(newGlobals.map(g => window[g])).size === 1) {
            result['default'] = window[newGlobals[0]];
        }
        const name = jsCode.slice(-100).replace(/[\s\S]*\//, '');
        console.debug('side-effects js lib loaded ' + name, {
            newGlobals, evalResult, self,
        });
        if (newGlobals.length === 0) {
            const msg = 'warning: imported lib ' + name + ' did not add any keys to window. ' +
                'If it is imported in both html and js, you can only use it with side-effects ' +
                'import like `import "someLib.js"; const someLib = window.someLib;`';
            console.warn(msg);
            return {warning: msg};
        } else {
            return result;
        }
    } catch (exc) {
        // Unexpected token 'import/export' - means it is a es6 module
        return null;
    }
};

let whenTypescriptServices = null;

/** @return {Promise<ts>} */
const getTs = () => {
    if (!whenTypescriptServices) {
        if (window.ts) {
            whenTypescriptServices = Promise.resolve(window.ts);
        } else {
            // kind of lame that typescript does not provide it's own CDN
            const url = 'https://klesun-misc.github.io/TypeScript/lib/typescriptServices.js';
            whenTypescriptServices = fetch(url)
                .then(rs => rs.text())
                .then(jsCode => {
                    jsCode += '\nwindow.ts = ts;';
                    jsCode += '\n//# sourceURL=' + url;
                    if (tryLoadSideEffectsJsModule(jsCode)) {
                        return Promise.resolve(window.ts);
                    } else {
                        return Promise.reject(new Error('Failed to load typescriptServices.js'));
                    }
                });
        }
    }
    return whenTypescriptServices;
};

const makeCircularRefProxy = (whenModule, newUrl) => {
    // from position of an app writer, it would be better to just not use circular
    // references, but since typescript supports them somewhat, so should I I guess
    let loadedModule = null;
    whenModule.then(module => loadedModule = module);
    return new Proxy({}, {
        get: (target, name) => {
            return new Proxy(() => {}, {
                apply: (callTarget, thisArg, argumentsList) => {
                    if (loadedModule) {
                        return loadedModule[name].apply(thisArg, argumentsList);
                    } else {
                        throw new Error('Tried to call ' + name + '() on a circular reference ' + newUrl);
                    }
                },
                get: (target, subName) => {
                    if (loadedModule) {
                        return loadedModule[name][subName];
                    } else {
                        throw new Error('Tried to get field ' + name + '.' + subName + ' on a circular reference ' + newUrl);
                    }
                },
            });
        },
    });
};
window[CACHE_LOADED] = window[CACHE_LOADED] || {};

/** @return {Promise<Module>} */
const loadModuleFromFiles = (baseUrl, cachedFiles) => {
    const modulePromises = {};
    const load = async (baseUrl) => {
        if (window[CACHE_LOADED][baseUrl]) {
            // it was already loaded by another dynamic import
            return Promise.resolve(window[CACHE_LOADED][baseUrl]);
        }
        const fileData = cachedFiles[baseUrl];
        for (const dependency of fileData.staticDependencies) {
            const newUrl = dependency.url;
            if (!modulePromises[newUrl]) {
                let reportOk, reportErr;
                modulePromises[newUrl] = new Promise((ok,err) => {
                    [reportOk, reportErr] = [ok, err];
                });
                load(newUrl).then(reportOk).catch(reportErr);
                window[CACHE_LOADED][newUrl] = await modulePromises[newUrl];
            } else if (!window[CACHE_LOADED][newUrl]) {
                if (fileData.jsCode.match(/(^|\s+)export\b/)) {
                    // the check is to exclude type definition-only files, as they have no vars
                    const msg = 'warning: circular dependency on ' + baseUrl + ' -> ' +
                        newUrl + ', variables will be empty in module top-level scope';
                    console.warn(msg);
                }
                window[CACHE_LOADED][newUrl] = makeCircularRefProxy(modulePromises[newUrl], newUrl);
            }
        }
        const jsCode = fileData.jsCode + '\n' +
            '//# sourceURL=' + baseUrl;
        const base64Code = b64EncodeUnicode(jsCode);
        if (fileData.isJsSrc) {
            const loaded = tryLoadSideEffectsJsModule(jsCode);
            if (loaded) {
                // only side effect imports supported, as binding
                // AMD/CJS modules with es6 has some problems
                return Promise.resolve(loaded);
            }
        }
        return import('data:text/javascript;base64,' + base64Code);
    };

    return load(baseUrl);
};

/** @param {ts.CompilerOptions} compilerOptions */
const LoadRootModule = async ({
    rootModuleUrl,
    compilerOptions = {},
}) => {
    const ts = await getTs();
    compilerOptions.target = compilerOptions.target || ts.ScriptTarget.ES2018;
    const workerManager = WorkerManager({ts, compilerOptions});

    const cachedFiles = {};
    const urlToWhenFileData = {};
    const getFileData = url => {
        if (!urlToWhenFileData[url]) {
            urlToWhenFileData[url] = workerManager.fetchModuleData(url);
        }
        return urlToWhenFileData[url];
    };

    const fetchDependencyFiles = async (entryUrls) => {
        const urlToPromise = {};
        for (const entryUrl of entryUrls) {
            urlToPromise[entryUrl] = getFileData(entryUrl);
        }
        let promises;
        let safeguard = 100000;
        while ((promises = Object.values(urlToPromise)).length > 0) {
            if (--safeguard <= 0) {
                throw new Error('Got into infinite loop while fetching dependencies of ' + entryUrls);
            }
            const next = await Promise.race(promises);
            cachedFiles[next.url] = next;
            delete urlToPromise[next.url];
            for (const {url} of next.staticDependencies) {
                if (!urlToPromise[url] && !cachedFiles[url]) {
                    urlToPromise[url] = getFileData(url);
                }
            }
        }
        return cachedFiles;
    };

    const importDynamic = async (relUrl, baseUrl) => {
        const url = addPathToUrl(relUrl, baseUrl);
        await fetchDependencyFiles([url]);
        return loadModuleFromFiles(url, cachedFiles);
    };

    const main = async () => {
        window[IMPORT_DYNAMIC] = importDynamic;
        return importDynamic(rootModuleUrl, './');
    };

    return main();
};

/** @return {Promise<any>} */
export const loadModule = async (absUrl, compilerOptions = {}) => {
    return LoadRootModule({rootModuleUrl: absUrl, compilerOptions});
};
