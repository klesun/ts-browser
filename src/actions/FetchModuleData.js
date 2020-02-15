
import {oneSuccess} from "../utils.js";
import {addPathToUrl} from "../UrlPathResolver.js";

/**
 * @param {ts.ImportClause} importClause - `{Field1, Field2}`
 */
const es6ToDestr = (tsCode, importClause) => {
    const {pos, end} = importClause;
    const text = tsCode.slice(pos, end);
    const {namedBindings = null, name = null} = importClause;
    if (namedBindings) {
        const {elements = [], name = null} = namedBindings;
        if (elements.length > 0) {
            // `import {A, B, C} from './module';`
            return 'const ' + text;
        } else if (name && name.escapedText) {
            return 'const ' + name.escapedText;
        } else {
            const exc = new Error('Unsupported namedBindings');
            exc.data = {namedBindings, text};
            throw exc;
        }
    } else if (name && name.escapedText) {
        // `import DefaultClass from './module';`
        return 'const {default: ' + text + '}';
    } else {
        const exc = new Error('Unsupported importClause');
        exc.data = {importClause, text};
        throw exc;
    }
};

const EXPLICIT_EXTENSIONS = ['ts', 'js', 'tsx', 'jsx'];

export const CACHE_LOADED = 'ts-browser-loaded-modules';

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
            const extension = fullUrl.replace(/^.*\./, '');
            const sourceFile = ts.createSourceFile(
                'ololo.' + extension, tsCode, compilerOptions.target
            );
            let jsCodeImports = '';
            let tsCodeAfterImports = '';
            const dependencies = [];
            for (const statement of sourceFile.statements) {
                const kindName = ts.SyntaxKind[statement.kind];
                if (kindName === 'ImportDeclaration') {
                    const relPath = statement.moduleSpecifier.text;
                    const {importClause = null} = statement;
                    const depUrl = addPathToUrl(relPath, url);
                    if (importClause) {
                        // can be not set in case of side-effectish `import './some/url.css';`
                        const assignedValue = 'window[' + JSON.stringify(CACHE_LOADED) + '][' + JSON.stringify(depUrl) + ']';
                        jsCodeImports += es6ToDestr(tsCode, importClause) + ' = ' + assignedValue + ';\n';
                    } else {
                        // leaving a blank line so that stack trace matched original lines
                        tsCodeAfterImports += '\n';
                    }
                    dependencies.push({url: depUrl});
                } else {
                    const {pos, end} = statement;
                    tsCodeAfterImports += tsCode.slice(pos, end) + '\n';
                }
            }
            const isJsSrc = extension === 'js';
            const jsCodeAfterImports = isJsSrc ? tsCodeAfterImports :
                ts.transpile(tsCodeAfterImports, {
                    module: 5, // es6 imports
                    ...compilerOptions,
                });
            const jsCode = jsCodeImports + jsCodeAfterImports;

            return {url, isJsSrc, dependencies, jsCode};
        });
};

export default FetchModuleData;