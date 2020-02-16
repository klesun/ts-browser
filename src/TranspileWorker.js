//import ParseTsModule from "./actions/ParseTsModule.js";

const main = () => {
    self.importScripts(
        'https://klesun-misc.github.io/TypeScript/lib/typescriptServices.js',
        'https://klesun-productions.com/entry/ts-browser/src/UrlPathResolver_sideEffects.js',
        'https://klesun-productions.com/entry/ts-browser/src/actions/ParseTsModule_sideEffects.js'
    );
    const org = self.org;
    /** @type {ts} */
    const ts = self.ts;

    const onmessage = ({data}) => {
        if (data.messageType === 'parseTsModule') {
            const parsed = org.klesun.tsBrowser.ParseTsModule_sideEffects({
                ...data.messageData, ts: ts,
                addPathToUrl: org.klesun.tsBrowser.addPathToUrl,
            });
            self.postMessage({
                messageType: 'parseTsModule',
                messageData: parsed,
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