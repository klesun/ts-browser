import {oneSuccess} from "./utils.js";
import {addPathToUrl} from "./UrlPathResolver.js";


const EXPLICIT_EXTENSIONS = ['ts', 'js', 'tsx', 'jsx'];

const NUM_OF_WORKERS = 2;

const workers = [...Array(NUM_OF_WORKERS).keys()].map(i => {
    const scriptUrl = import.meta.url;
    const workerUrl = addPathToUrl('./TranspileWorker.js', scriptUrl);
    const worker = new Worker(workerUrl);
    worker.onmessage = ({data}) => {
        console.log('Received event from worker #' + i, data);
    };
    return {
        parseTsModule: (params) => new Promise((ok, err) => {
            worker.postMessage({
                messageType: 'parseTsModule',
                messageData: params,
            });
            worker.onmessage = ({data}) => {
                if (data.messageType === 'parseTsModule') {
                    ok(data.messageData);
                } else {
                    const msg = 'Unexpected parseTsModule() worker response';
                    const exc = new Error(msg);
                    exc.data = data;
                    err(exc);
                }
            };
        }),
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
            callback(worker).finally(() => {
                freeWorkers.add(worker);
                checkFree();
            });
        }
    };
    checkFree();
});

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
        return withFreeWorker(worker => worker.parseTsModule({
            fullUrl, tsCode, compilerOptions,
        }).then(({isJsSrc, staticDependencies, jsCode}) => {
            return {url, isJsSrc, staticDependencies, jsCode};
        }));
    };

    return {
        fetchModuleData: url => fetchModuleSrc(url)
            .then(({fullUrl, tsCode}) => parseInWorker({url, fullUrl, tsCode})),
    };
};

export default WorkerManager;