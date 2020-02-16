
export const tryEvalLegacyJsModule = (jsCode, silent = true) => {
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
            return {warning: msg, self};
        } else {
            return result;
        }
    } catch (exc) {
        if (silent) {
            // Unexpected token 'import/export' - means it is a es6 module
            return null;
        } else {
            throw exc;
        }
    }
};