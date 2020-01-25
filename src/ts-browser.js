/**
 * @module ts-browser - like ts-node, this tool allows you
 * to require typescript files and compiles then on the fly
 *
 * though in order to use it, you'll need a very specific import pattern in all files
 */
import {oneSuccess} from "./utils.js";

const addPathToUrl = (path, url) => {
    let result;
    if (path.startsWith('/') || path.match(/^https?:\/\//)) {
        // full path from the site root
        result = path;
    } else if (!path.startsWith('./') && !path.startsWith('../')) {
        // apparently, typescript compiler marks paths from root this way
        // src/utils/Dom, weird, but ok
        result = '/' + path;
    } else {
        const urlParts = url.split('/');
        const pathParts = path.split('/');

        if (urlParts.slice(-1)[0] !== '') {
            // does not end with a slash - script, not directory
            urlParts.pop();
        }

        // getting rid of trailing slashes if any
        while (pathParts[0] === '') pathParts.shift();
        while (urlParts.slice(-1)[0] === '') urlParts.pop();

        while (pathParts.length > 0 && urlParts.length > 0) {
            if (pathParts[0] === '.') {
                pathParts.shift();
            } else if (pathParts[0] === '..') {
                pathParts.shift();
                urlParts.pop();
            } else {
                break;
            }
        }
        result = urlParts.join('/') + '/' + pathParts.join('/');
    }

    return result;
};

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
function b64EncodeUnicode(str) {
    // first we use encodeURIComponent to get percent-encoded UTF-8,
    // then we convert the percent encodings into raw bytes which
    // can be fed into btoa.
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g,
        function toSolidBytes(match, p1) {
            return String.fromCharCode('0x' + p1);
        }));
}

const CACHE_LOADED = 'ts-browser-loaded-modules';
const explicitExtensions = ['.ts', '.js', '.tsx', '.jsx'];

/** @param {ts.CompilerOptions} compilerOptions */
const LoadRootModule = ({
    rootModuleUrl,
    compilerOptions = {},
}) => {
    const targetLanguageVersion = compilerOptions.target || window.ts.ScriptTarget.ES2018;

    const fetchModuleData = url => {
        // typescript does not allow specifying extension in the import, but react
        // files may have .tsx extension rather than .ts, so have to check both
        const urlOptions = [];
        if (explicitExtensions.some(ext => url.endsWith(ext))) {
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
                const sourceFile = window.ts.createSourceFile(
                    fullUrl.replace(/^.*\//, ''), tsCode, targetLanguageVersion
                );
                let tsCodeAfterImports = '';
                const dependencies = [];
                for (const statement of sourceFile.statements) {
                    const kindName = window.ts.SyntaxKind[statement.kind];
                    if (kindName === 'ImportDeclaration') {
                        const relPath = statement.moduleSpecifier.text;
                        const {importClause = null} = statement;
                        dependencies.push({
                            url: addPathToUrl(relPath, url),
                            // can be not set in case of side-effectish `import './some/url.css';`
                            destrJsPart: importClause
                                ? es6ToDestr(tsCode, importClause) : '',
                        });
                    } else {
                        const {pos, end} = statement;
                        tsCodeAfterImports += tsCode.slice(pos, end) + '\n';
                    }
                }
                return {url, dependencies, tsCodeAfterImports};
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
            let jsCode = window.ts.transpile(tsCodeResult, {
                module: 5, target: targetLanguageVersion /* ES2018 */,
                ...compilerOptions,
            });
            jsCode += '\n//# sourceURL=' + baseUrl;
            let base64Code;
            try {
                base64Code = b64EncodeUnicode(jsCode);
            } catch (exc) {
                const msg = exc.message + '\nbtoa() failed on ' + baseUrl;
                const newExc = new Error(msg);
                newExc.tsCode = tsCodeResult;
                newExc.jsCode = jsCode;
                throw newExc;
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
