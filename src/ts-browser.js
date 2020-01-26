/**
 * @module ts-browser - like ts-node, this tool allows you
 * to require typescript files and compiles then on the fly
 *
 * though in order to use it, you'll need a very specific import pattern in all files
 */
import {oneSuccess} from "./utils.js";
import {addPathToUrl} from "./UrlPathResolver.js";

/**
 * @param {ts.ImportClause} importClause - `{Field1, Field2}`
 */
const es6ToDestr = (tsCode, importClause) => {
    const {pos, end} = importClause;
    const text = tsCode.slice(pos, end);
    const {namedBindings = null, name = null} = importClause;
    if (namedBindings) {
        const {elements = [], name = null} = namedBindings;
        if (elements.length > 0) {
            // `import {A, B, C} from './module';`
            return 'const ' + text;
        } else if (name && name.escapedText) {
            return 'const ' + name.escapedText;
        } else {
            const exc = new Error('Unsupported namedBindings');
            exc.data = {namedBindings, text};
            throw exc;
        }
    } else if (name && name.escapedText) {
        // `import DefaultClass from './module';`
        return 'const {default: ' + text + '}';
    } else {
        const exc = new Error('Unsupported importClause');
        exc.data = {importClause, text};
        throw exc;
    }
};

/** @cudos to https://stackoverflow.com/a/30106551/2750743 */
const b64EncodeUnicode = (str) => {
    // first we use encodeURIComponent to get percent-encoded UTF-8,
    // then we convert the percent encodings into raw bytes which
    // can be fed into btoa.
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
        function toSolidBytes(match, p1) {
            return String.fromCharCode('0x' + p1);
        }));
};

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

const CACHE_LOADED = 'ts-browser-loaded-modules';
const explicitExtensions = ['ts', 'js', 'tsx', 'jsx'];
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

/** @param {ts.CompilerOptions} compilerOptions */
const LoadRootModule = async ({
    rootModuleUrl,
    compilerOptions = {},
}) => {
    const ts = await getTs();
    const targetLanguageVersion = compilerOptions.target || ts.ScriptTarget.ES2018;

    const fetchModuleData = url => {
        // typescript does not allow specifying extension in the import, but react
        // files may have .tsx extension rather than .ts, so have to check both
        const urlOptions = [];
        if (explicitExtensions.some(ext => url.endsWith('.' + ext))) {
            urlOptions.push(url);
        } else {
            urlOptions.push(url + '.ts');
            if (compilerOptions.jsx) {
                urlOptions.push(url + '.tsx');
            }
        }
        const whenResource = oneSuccess(urlOptions.map(fullUrl => fetch(fullUrl)
            .then(rs => {
                if (rs.status === 200) {
                    return rs.text().then(tsCode => ({fullUrl, tsCode}));
                } else {
                    const msg = 'Failed to fetch module file ' + rs.status + ': ' + fullUrl;
                    return Promise.reject(new Error(msg));
                }
            })));
        return whenResource
            .then(async ({fullUrl, tsCode}) => {
                const extension = fullUrl.replace(/^.*\./, '');
                const sourceFile = ts.createSourceFile(
                    'ololo.' + extension, tsCode, targetLanguageVersion
                );
                let tsCodeAfterImports = '';
                const dependencies = [];
                for (const statement of sourceFile.statements) {
                    const kindName = ts.SyntaxKind[statement.kind];
                    if (kindName === 'ImportDeclaration') {
                        const relPath = statement.moduleSpecifier.text;
                        const {importClause = null} = statement;
                        dependencies.push({
                            url: addPathToUrl(relPath, url),
                            // can be not set in case of side-effectish `import './some/url.css';`
                            destrJsPart: importClause
                                ? es6ToDestr(tsCode, importClause) : '',
                        });
                        // leaving a blank line so that stack trace matched original lines
                        tsCodeAfterImports += '\n';
                    } else {
                        const {pos, end} = statement;
                        tsCodeAfterImports += tsCode.slice(pos, end) + '\n';
                    }
                }
                return {url, extension, dependencies, tsCodeAfterImports};
            });
    };

    const fetchDependencyFiles = async (entryUrls) => {
        const cachedFiles = {};
        const urlToPromise = {};
        for (const entryUrl of entryUrls) {
            urlToPromise[entryUrl] = fetchModuleData(entryUrl);
        }
        let promises;
        while ((promises = Object.values(urlToPromise)).length > 0) {
            const next = await Promise.race(promises);
            cachedFiles[next.url] = next;
            delete urlToPromise[next.url];
            for (const {url} of next.dependencies) {
                if (!urlToPromise[url] && !cachedFiles[url]) {
                    urlToPromise[url] = fetchModuleData(url);
                }
            }
        }
        return cachedFiles;
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

    /** @return {Promise<Module>} - just  */
    const loadModuleFromFiles = (baseUrl, cachedFiles) => {
        const modulePromises = {};
        const load = async (baseUrl) => {
            const fileData = cachedFiles[baseUrl];
            let tsCodeImports = '';
            for (const dependency of fileData.dependencies) {
                const newUrl = dependency.url;
                window[CACHE_LOADED] = window[CACHE_LOADED] || {};
                if (!modulePromises[newUrl]) {
                    let reportOk, reportErr;
                    modulePromises[newUrl] = new Promise((ok,err) => {
                        [reportOk, reportErr] = [ok, err];
                    });
                    load(newUrl).then(reportOk).catch(reportErr);
                    window[CACHE_LOADED][newUrl] = await modulePromises[newUrl];
                } else if (!window[CACHE_LOADED][newUrl]) {
                    window[CACHE_LOADED][newUrl] = makeCircularRefProxy(modulePromises[newUrl], newUrl);
                }
                const assignedValue = 'window[' + JSON.stringify(CACHE_LOADED) + '][' + JSON.stringify(newUrl) + ']';
                if (dependency.destrJsPart) {
                    tsCodeImports += dependency.destrJsPart + ' = ' + assignedValue + ';\n';
                }
            }
            const tsCodeResult = tsCodeImports + '\n' + fileData.tsCodeAfterImports;
            const isJsSrc = fileData.extension === 'js';
            let jsCode = isJsSrc ? tsCodeResult :
                ts.transpile(tsCodeResult, {
                    module: 5, target: targetLanguageVersion /* ES2018 */,
                    ...compilerOptions,
                });
            jsCode += '\n//# sourceURL=' + baseUrl;
            const base64Code = b64EncodeUnicode(jsCode);
            if (isJsSrc) {
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

    const main = async () => {
        const cachedFiles = await fetchDependencyFiles([rootModuleUrl]);
        return loadModuleFromFiles(rootModuleUrl, cachedFiles);
    };

    return main();
};

/** @return {Promise<any>} */
export const loadModule = async (absUrl, compilerOptions = {}) => {
    return LoadRootModule({rootModuleUrl: absUrl, compilerOptions});
};
