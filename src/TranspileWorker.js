
const workerPramsStr = location.hash.replace(/^#/, '');
const workerParams = workerPramsStr ? JSON.parse(workerPramsStr) : {};
const workerUrl = workerParams.workerUrl || 'https://klesun-productions.com/entry/ts-browser/src/TranspileWorker.js';
const workerPath = workerUrl.replace(/\/[^/]+$/, '/');

const main = () => {
    self.importScripts(
        //'https://unpkg.com/typescript@4.4.3/lib/typescriptServices.js',
        'https://typescriptservices-min-js-builds.github.io/v4.4.3/dist/typescriptServices.min.js',
        workerPath + '/UrlPathResolver_sideEffects.js',
        workerPath + '/actions/ParseTsModule_sideEffects.js'
    );
    const org = self.org;
    /** @type {ts} */
    const ts = self.ts;

    const onmessage = (evt) => {
        const {data} = evt;
        const {messageType, messageData, referenceId} = data;
        if (messageType === 'parseTsModule') {
            const {isJsSrc, staticDependencies, dynamicDependencies, getJsCode} =
                org.klesun.tsBrowser.ParseTsModule_sideEffects({
                    ...messageData, ts: ts,
                    addPathToUrl: org.klesun.tsBrowser.addPathToUrl,
                });
            self.postMessage({
                messageType: 'parseTsModule_deps',
                messageData: {isJsSrc, staticDependencies, dynamicDependencies},
                referenceId: referenceId,
            });
            const jsCode = getJsCode();
            self.postMessage({
                messageType: 'parseTsModule_code',
                messageData: {jsCode},
                referenceId: referenceId,
            });
        }
    };

    self.onmessage = evt => {
        try {
            onmessage(evt);
        } catch (exc) {
            self.postMessage({
                messageType: 'error',
                messageData: {
                    message: exc.message,
                    stack: exc.stack,
                },
            });
        }
    };
};

try {
    main();
} catch (exc) {
    self.postMessage('Failed to initialize worker - ' + exc + '\n' + exc.stack);
}
