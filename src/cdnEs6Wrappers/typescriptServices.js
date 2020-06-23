import {tryEvalLegacyJsModule} from "../sideEffectModules/sideEffectUtils.js";

let whenLib = null;

/** @return {Promise<ts>} */
const get = () => {
    if (!whenLib) {
        if (window.ts) {
            whenLib = Promise.resolve(window.ts);
        } else {
            //const url = 'https://klesun-misc.github.io/TypeScript/lib/typescriptServices.js';
            const url = 'https://unpkg.com/typescript@latest/lib/typescriptServices.js';
            whenLib = fetch(url)
                .then(rs => rs.text())
                .then(jsCode => {
                    jsCode += '\nwindow.ts = ts;';
                    jsCode += '\n//# sourceURL=' + url;
                    const module = tryEvalLegacyJsModule(jsCode, false);
                    if (module) {
                        return module.ts;
                    } else {
                        return Promise.reject(new Error('Failed to load ' + url));
                    }
                });
        }
    }
    return whenLib;
};

export default {
    get: get,
};