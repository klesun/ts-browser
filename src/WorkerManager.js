import {oneSuccess} from "./utils.js";
import {addPathToUrl} from "./UrlPathResolver.js";

const EXPLICIT_EXTENSIONS = ['ts', 'js', 'tsx', 'jsx'];

// on my 4-core PC 3 workers seems to be the optimal solution
const NUM_OF_WORKERS = 3;

/**
 * this number must supposedly be updated in case generated code
 * format changes, very hope I won't forget to update it every time
 *
 * it's the md5 of the last commit
 */
const CACHED_FORMAT_VERSION = 'c364de0a57780ef0d248878f6fd710fff8c6fff9';

const workers = [...Array(NUM_OF_WORKERS).keys()].map(i => {
    const scriptUrl = import.meta.url;

    const workerUrl = addPathToUrl('./TranspileWorker.js', scriptUrl);
    const whenWorker = fetch(workerUrl).then(rs => rs.text()).then(workerCode => {
        return new Worker(window.URL.createObjectURL(new Blob([workerCode])));
    });

    let lastReferenceId = 0;
    const referenceIdToCallback = new Map();

    whenWorker.then(w => w.onmessage = ({data}) => {
        console.log('Received event from worker #' + i, data);
    });
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
        parseTsModule: (params) => {
            const referenceId = ++lastReferenceId;
            whenWorker.then(w => w.postMessage({
                messageType: 'parseTsModule',
                messageData: params,
                referenceId: referenceId,
            }));
            return new Promise((ok, err) => {
                let reportJsCodeOk, reportJsCodeErr;
                referenceIdToCallback.set(referenceId, ({messageType, messageData}) => {
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
                        const msg = 'Unexpected parseTsModule() worker response';
                        const exc = new Error(msg);
                        exc.data = {messageType, messageData};
                        reject(exc);
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

const WorkerManager = ({compilerOptions}) => {
    const fetchModuleSrc = (url) => {
        // typescript does not allow specifying extension in the import, but react
        // files may have .tsx extension rather than .ts, so have to check both
        const urlOptions = [];
        if (EXPLICIT_EXTENSIONS.some(ext => url.endsWith('.' + ext))) {
            urlOptions.push(url);
        } else {
            urlOptions.push(url + '.ts');
            if (compilerOptions.jsx) {
                urlOptions.push(url + '.tsx');
            }
        }
        return oneSuccess(
            urlOptions.map(fullUrl => fetch(fullUrl)
                .then(rs => {
                    if (rs.status === 200) {
                        return rs.text().then(tsCode => ({fullUrl, tsCode}));
                    } else {
                        const msg = 'Failed to fetch module file ' + rs.status + ': ' + fullUrl;
                        return Promise.reject(new Error(msg));
                    }
                }))
        );
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
