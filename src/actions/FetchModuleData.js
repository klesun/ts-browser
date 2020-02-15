
import {oneSuccess} from "../utils.js";
import ParseTsModule from "./ParseTsModule.js";

const EXPLICIT_EXTENSIONS = ['ts', 'js', 'tsx', 'jsx'];

/**
 * @param {ts} ts
 * @param {ts.CompilerOptions} compilerOptions
 */
const FetchModuleData = ({ts, url, compilerOptions}) => {
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
    const whenResource = oneSuccess(urlOptions.map(fullUrl => fetch(fullUrl)
        .then(rs => {
            if (rs.status === 200) {
                return rs.text().then(tsCode => ({fullUrl, tsCode}));
            } else {
                const msg = 'Failed to fetch module file ' + rs.status + ': ' + fullUrl;
                return Promise.reject(new Error(msg));
            }
        })));
    return whenResource
        .then(async ({fullUrl, tsCode}) => {
            const {isJsSrc, staticDependencies, jsCode} =
                ParseTsModule({fullUrl, ts, tsCode, compilerOptions});
            return {url, isJsSrc, staticDependencies, jsCode};
        });
};

export default FetchModuleData;