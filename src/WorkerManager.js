import {oneSuccess} from "./utils.js";
import ParseTsModule from "./actions/ParseTsModule.js";


const EXPLICIT_EXTENSIONS = ['ts', 'js', 'tsx', 'jsx'];

const WorkerManager = ({ts, compilerOptions}) => {
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
        // TODO: actual workers!
        const {isJsSrc, staticDependencies, jsCode} =
            ParseTsModule({fullUrl, ts, tsCode, compilerOptions});
        return {url, isJsSrc, staticDependencies, jsCode};
    };

    return {
        fetchModuleData: url => fetchModuleSrc(url)
            .then(({fullUrl, tsCode}) => parseInWorker({url, fullUrl, tsCode})),
    };
};

export default WorkerManager;