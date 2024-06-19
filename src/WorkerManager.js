import {oneSuccess} from "./utils.js";
import {addPathToUrl} from "./UrlPathResolver.js";

const EXPLICIT_EXTENSIONS = ['ts', 'js', 'tsx', 'jsx', 'mjs'];

// on my 4-core PC 3 workers seems to be the optimal solution
const NUM_OF_WORKERS = 3;

/**
 * this number must supposedly be updated in case generated code
 * format changes, very hope I won't forget to update it every time
 *
 * it's the md5 of the last commit
 */
const CACHED_FORMAT_VERSION = '4b3e236d842f6ca0a86cd571c4c203ab8c6cde7a';

function eventToError(data, contextMessage) {
    const {messageType, messageData} = data;
    if (messageType === 'error') {
        const msg = contextMessage + ' - ' + messageData.message;
        const exc = new Error(msg);
        exc.stack += '\nCaused by:\n' + messageData.stack;
        return exc;
    } else {
        const msg = contextMessage + ' - ' + JSON.stringify(data);
        return new Error(msg);
    }
}

const workers = [...Array(NUM_OF_WORKERS).keys()].map(i => {
    const scriptUrl = import.meta.url;

    const workerUrl = addPathToUrl('./TranspileWorker.js', scriptUrl);
    const whenWorker = fetch(workerUrl).then(rs => rs.text()).then(workerCode => {
        const scriptBlobUrl = window.URL.createObjectURL(new Blob([workerCode]));
        return new Worker(scriptBlobUrl + '#' + new URLSearchParams({workerUrl}));
    }).then(worker => {
        return new Promise((resolve, reject) => {
            worker.onmessage = ({data}) => {
                if (data.messageType === 'ready') {
                    resolve(worker);
                } else {
                    reject(eventToError(data, 'Worker #' + i));
                }
            };
        });
    });

    let lastReferenceId = 0;
    const referenceIdToCallback = new Map();

    whenWorker.then(w => w.onmessage = ({data}) => {
        const {messageType, messageData, referenceId} = data;
        const callback = referenceIdToCallback.get(referenceId);
        if (callback) {
            callback({messageType, messageData});
        } else {
            console.debug('Unexpected message from worker #' + i, data);
        }
    });

    let whenFree = Promise.resolve();
    return {
        getWhenFree: () => whenFree,
        parseTsModule: async (params) => {
            const referenceId = ++lastReferenceId;
            const worker = await whenWorker;
            worker.postMessage({
                messageType: 'parseTsModule',
                messageData: params,
                referenceId: referenceId,
            });
            return new Promise((ok, err) => {
                let reportJsCodeOk, reportJsCodeErr;
                referenceIdToCallback.set(referenceId, (payload) => {
                    const {messageType, messageData} = payload;
                    if (messageType === 'parseTsModule_deps') {
                        const {isJsSrc, staticDependencies, dynamicDependencies} = messageData;
                        const whenJsCode = new Promise((ok, err) => {
                            [reportJsCodeOk, reportJsCodeErr] = [ok, err];
                        });
                        whenFree = whenJsCode;
                        ok({
                            isJsSrc, staticDependencies,
                            dynamicDependencies, whenJsCode,
                        });
                    } else if (messageType === 'parseTsModule_code') {
                        reportJsCodeOk(messageData.jsCode);
                        referenceIdToCallback.delete(referenceId);
                    } else {
                        const reject = reportJsCodeErr || err;
                        let contextMessage;
                        if (messageType === 'error') {
                            contextMessage = 'Failed to transpile ' + params.fullUrl;
                        } else {
                            contextMessage = 'Unexpected parseTsModule() worker response at ' + params.fullUrl;
                        }
                        reject(eventToError(payload, contextMessage));
                        referenceIdToCallback.delete(referenceId);
                    }
                });
            });
        },
    };
});

const workerCallbackQueue = [];
const freeWorkers = new Set(workers);

const withFreeWorker = (action) => new Promise((ok, err) => {
    workerCallbackQueue.push(
        worker => Promise.resolve()
            .then(() => action(worker))
            .then(ok).catch(err)
    );
    const checkFree = () => {
        if (freeWorkers.size > 0 &&
            workerCallbackQueue.length > 0
        ) {
            const worker = [...freeWorkers][0];
            freeWorkers.delete(worker);
            const callback = workerCallbackQueue.shift();
            callback(worker).finally(async () => {
                await worker.getWhenFree().catch(exc => {});
                freeWorkers.add(worker);
                checkFree();
            });
        }
    };
    checkFree();
});

const CACHE_PREFIX = 'ts-browser-cache:';

const resetCache = () => {
    for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith(CACHE_PREFIX)) {
            window.localStorage.removeItem(key);
        }
    }
};

const getFromCache = ({fullUrl, checksum}) => {
    const absUrl = addPathToUrl(fullUrl, window.location.pathname);
    const cacheKey = CACHE_PREFIX + absUrl;
    const oldResultStr = window.localStorage.getItem(cacheKey);
    let oldResult = null;
    try {
        oldResult = JSON.parse(oldResultStr || 'null');
    } catch (exc) {
        console.warn('Failed to parse cached ' + fullUrl, exc);
    }

    if (oldResult && oldResult.checksum === checksum) {
        const {jsCode, ...rs} = oldResult.value;
        return {...rs, whenJsCode: Promise.resolve(jsCode)};
    } else {
        return null;
    }
};

const putToCache = ({fullUrl, checksum, jsCode, ...rs}) => {
    const absUrl = addPathToUrl(fullUrl, window.location.pathname);
    const cacheKey = CACHE_PREFIX + absUrl;
    window.localStorage.setItem(cacheKey, JSON.stringify({
        checksum, value: {...rs, jsCode},
    }));
};

/**
 * @cudos https://stackoverflow.com/a/50767210/2750743
 * @param {ArrayBuffer} buffer
 * @return {string}
 */
function bufferToHex (buffer) {
    return [...new Uint8Array(buffer)]
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

function tryFetchModuleSrcWithExt(fullUrl) {
    return fetch(fullUrl)
        .then(rs => {
            if (rs.status === 200) {
                return rs.text().then(tsCode => ({fullUrl, tsCode}));
            } else {
                const msg = 'Failed to fetch module file ' + rs.status + ': ' + fullUrl;
                return Promise.reject(new Error(msg));
            }
        });
}

/**
 * @param {string} url
 * @param {boolean} jsx
 */
function tryFetchModuleSrcExtOrNot(url, jsx) {
    // typescript does not allow specifying extension in the import, but react
    // files may have .tsx extension rather than .ts, so have to check both
    const urlOptions = [];
    const explicitExtension = EXPLICIT_EXTENSIONS.find(ext => url.endsWith('.' + ext));
    if (explicitExtension) {
        const whenModule = tryFetchModuleSrcWithExt(url);
        if (explicitExtension === "js") {
            // when you import .ts files, compiler normally does not let you specify ".ts" explicitly
            // you can only use ".js" extension or no extension at all to refer to that .ts file
            // since typescript allows referring to .ts files by .js extension - so should we
            return whenModule.catch(async jsExtError => {
                try {
                    return await tryFetchModuleSrcWithExt(url.replace(/\.js$/, "") + ".ts")
                } catch {
                    throw jsExtError;
                }
            });
        } else {
            return whenModule;
        }
    }
    urlOptions.push(url + '.ts');
    if (jsx) {
        urlOptions.push(url + '.tsx');
    }
    return oneSuccess(
        urlOptions.map(tryFetchModuleSrcWithExt)
    ).catch(async tsExtError => {
        // if nor .ts, nor .tsx extension works - try the .js
        // the lib would be happier if .js file imports always included
        // the .js extension as is the requirement in es6 imports, but
        // IDEA does not include extensions in imports by default, so it's still a use
        // case - let's make it work when we can: better slower than not working at all
        try {
            return await tryFetchModuleSrcWithExt(url + ".js")
        } catch {
            throw tsExtError;
        }
    });
}

const WorkerManager = ({compilerOptions}) => {
    const fetchModuleSrc = (url) => {
        return tryFetchModuleSrcExtOrNot(url, compilerOptions.jsx);
    };

    const parseInWorker = async ({url, fullUrl, tsCode}) => {
        const sourceCodeBytes = new TextEncoder().encode(
            '// ts-browser format version: ' + CACHED_FORMAT_VERSION + '\n' + tsCode
        );
        // only available on https pages, probably should just use some simple inline checksum
        // function, like crc, but bigger than 32 bytes to make sure there won't be collisions
        const checksum = !crypto.subtle ? null :
            await crypto.subtle.digest(
                'SHA-256', sourceCodeBytes
            ).then(bufferToHex);
        const fromCache = !checksum ? null : getFromCache({fullUrl, checksum});
        if (fromCache) {
            // ensure `url` won't be taken from cache, as it
            // is often used as key without extension outside
            return {...fromCache, url};
        } else {
            return withFreeWorker(worker => worker.parseTsModule({
                fullUrl, tsCode, compilerOptions,
            })).then(({whenJsCode, ...importData}) => {
                const rs = {url, ...importData};
                if (!checksum) {
                    // can't cache, as hashing function not available on non-https
                } else if (fullUrl.endsWith('.ts') || fullUrl.endsWith('.tsx')) {
                    whenJsCode.then(jsCode => {
                        putToCache({...rs, fullUrl, checksum, jsCode});
                    });
                } else {
                    // no caching for large raw js libs
                }
                return {...rs, whenJsCode};
            });
        }
    };

    return {
        fetchModuleData: url => fetchModuleSrc(url)
            .then(({fullUrl, tsCode}) => parseInWorker({url, fullUrl, tsCode})),
    };
};

WorkerManager.resetCache = resetCache;

export default WorkerManager;
