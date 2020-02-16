
var org = org || {};
org.klesun = org.klesun || {};
org.klesun.tsBrowser = org.klesun.tsBrowser || {};

org.klesun.tsBrowser.addPathToUrl = (path, baseUrl) => {
    let result;
    if (path.startsWith('/') || path.match(/^https?:\/\//)) {
        // full path from the site root
        result = path;
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