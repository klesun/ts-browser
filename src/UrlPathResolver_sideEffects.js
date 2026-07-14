
var org = org || {};
org.klesun = org.klesun || {};
org.klesun.tsBrowser = org.klesun.tsBrowser || {};

/**
 * @param {string} path
 * @param {string} baseUrl
 * @param {import("./ImportMap").ImportMap} importMap
 * @returns {string}
 */
org.klesun.tsBrowser.addPathToUrl = (path, baseUrl, importMap = {}) => {
    let result;
    if (path.startsWith('/') || path.match(/^https?:\/\//)) {
        // full path from the site root
        result = path;
    } else if (!path.startsWith('.')) {
        if (importMap.imports[path]) return importMap.imports[path];
        throw new Error(
            `Cannot resolve bare import "${path}" — ` +
            `you can use <script type="importmap"> or use a relative/absolute path.`
        );
    } else {
        const urlParts = baseUrl.split('/');
        const pathParts = path.split('/');

        if (urlParts.slice(-1)[0] !== '') {
            // does not end with a slash - script, not directory
            urlParts.pop();
        }

        // getting rid of trailing slashes if any
        while (pathParts[0] === '') pathParts.shift();
        while (urlParts.slice(-1)[0] === '') urlParts.pop();

        const resultParts = [...urlParts];
        for (const pathPart of pathParts) {
            if (pathPart === '..' && resultParts.slice(-1)[0] !== '..') {
                while (resultParts.slice(-1)[0] === '.') resultParts.pop();
                if (resultParts.length > 0) {
                    resultParts.pop();
                } else {
                    resultParts.push('..');
                }
            } else if (pathPart !== '.') {
                resultParts.push(pathPart);
            }
        }
        result = resultParts.join('/') || '.';
    }

    return result;
};

const isWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
if (isWorker) {
    self.org = org;
} else {
    window.org = org;
}