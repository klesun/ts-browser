import {tryEvalLegacyJsModule} from "../sideEffectModules/sideEffectUtils.js";

let whenLib = null;

/** @return {Promise<ts>} */
const get = () => {
    if (!whenLib) {
        if (window.md5) {
            whenLib = Promise.resolve(window.md5);
        } else {
            const url = 'https://cdnjs.cloudflare.com/ajax/libs/blueimp-md5/2.12.0/js/md5.js';
            whenLib = fetch(url)
                .then(rs => rs.text())
                .then(jsCode => {
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