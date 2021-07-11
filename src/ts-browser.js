
import {b64EncodeUnicode} from "./utils.js";
import {addPathToUrl} from "./UrlPathResolver.js";
import WorkerManager from "./WorkerManager.js";
import {tryEvalLegacyJsModule} from "./sideEffectModules/sideEffectUtils.js";

const CACHE_LOADED = 'ts-browser-loaded-modules';
const IMPORT_DYNAMIC = 'ts-browser-import-dynamic';

/**
 * @module ts-browser - like ts-node, this tool allows you
 * to require typescript files and compiles then on the fly
 */

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
        let jsCode = await fileData.whenJsCode;
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
                if (jsCode.match(/(^|\s+)export\b/)) {
                    // the check is to exclude type definition-only files, as they have no vars
                    const msg = 'warning: circular dependency on ' + baseUrl + ' -> ' +
                        newUrl + ', variables will be empty in module top-level scope';
                    console.warn(msg);
                }
                window[CACHE_LOADED][newUrl] = makeCircularRefProxy(modulePromises[newUrl], newUrl);
            }
        }
        jsCode = jsCode + '\n' +
            '//# sourceURL=' + baseUrl;
        const base64Code = b64EncodeUnicode(jsCode);
        if (fileData.isJsSrc) {
            const loaded = tryEvalLegacyJsModule(jsCode);
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

/** ts.ScriptTarget.ES2018 */
const TS_SCRIPT_TARGET_ES2018 = 5;

/** @param {ts.CompilerOptions} compilerOptions */
const LoadRootModule = async ({
    rootModuleUrl,
    compilerOptions = {},
}) => {
    compilerOptions.target = compilerOptions.target || TS_SCRIPT_TARGET_ES2018;
    const workerManager = WorkerManager({compilerOptions});

    const cachedFiles = {};
    const urlToWhenFileData = {};
    const getFileData = url => {
        if (!urlToWhenFileData[url]) {
            urlToWhenFileData[url] = workerManager.fetchModuleData(url);
        }
        return urlToWhenFileData[url];
    };

    const dynamicImportUrls = new Set();
    const fetchDependencyFiles = async (entryUrl) => {
        dynamicImportUrls.add(entryUrl);
        const urlToPromise = {};
        urlToPromise[entryUrl] = getFileData(entryUrl);
        let promises;
        let safeguard = 10000;
        while ((promises = Object.values(urlToPromise)).length > 0) {
            if (--safeguard <= 0) {
                throw new Error('Got into infinite loop while fetching dependencies of ' + entryUrl);
            }
            const next = await Promise.race(promises);
            cachedFiles[next.url] = next;
            delete urlToPromise[next.url];
            for (const {url} of next.staticDependencies) {
                if (!urlToPromise[url] && !cachedFiles[url]) {
                    urlToPromise[url] = getFileData(url);
                }
            }
            for (const dep of next.dynamicDependencies) {
                if (dep.url) {
                    if (!cachedFiles[dep.url] && !dynamicImportUrls.has(dep.url)) {
                        // preload dynamic dependency files for optimization
                        fetchDependencyFiles(dep.url);
                    }
                }
            }
        }
        return cachedFiles;
    };

    const importDynamic = async (relUrl, baseUrl) => {
        try {
            const url = addPathToUrl(relUrl, baseUrl);
            await fetchDependencyFiles(url);
            return await loadModuleFromFiles(url, cachedFiles);
        } catch (exc) {
            console.warn('Resetting transpilation cache due to uncaught error');
            WorkerManager.resetCache();
            throw exc;
        }
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
