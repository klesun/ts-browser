
importScripts(
    'typescriptServices.js',
    'UrlPathResolver_sideEffects.js',
    'actions/ParseTsModule_sideEffects.js'
);

onmessageint = (evt) => {
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

onmessage = evt => {
    try {
        onmessageint(evt);
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