import {tryEvalLegacyJsModule} from "../sideEffectModules/sideEffectUtils.js";

let whenLib = null;

/** @return {Promise<ts>} */
const get = () => {
    if (!whenLib) {
        if (window.ts) {
            whenLib = Promise.resolve(window.ts);
        } else {
            // kind of lame that typescript does not provide it's own CDN
            const url = 'https://klesun-misc.github.io/TypeScript/lib/typescriptServices.js';
            whenLib = fetch(url)
                .then(rs => rs.text())
                .then(jsCode => {
                    jsCode += '\nwindow.ts = ts;';
                    jsCode += '\n//# sourceURL=' + url;
                    const module = tryEvalLegacyJsModule(jsCode, false);
                    if (module) {
                        return module.default;
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