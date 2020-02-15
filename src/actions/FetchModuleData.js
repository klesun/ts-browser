
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
export const IMPORT_DYNAMIC = 'ts-browser-import-dynamic';

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
            const staticDependencies = [];

            const getNodeText = node => {
                const {pos, end} = node;
                return tsCode.slice(pos, end);
            };

            const transformStatement = (statement) => {
                const resultParts = [];
                /** @param {ts.Node} node */
                const consumeAst = (node) => {
                    if (ts.SyntaxKind[node.kind] === 'CallExpression' &&
                        ts.SyntaxKind[(node.expression || {}).kind] === 'ImportKeyword' &&
                        (node.arguments || []).length === 1
                    ) {
                        const ident = 'window[' + JSON.stringify(IMPORT_DYNAMIC) + ']';
                        // the leading space is important, cuz transpiler glues `await` to `window` otherwise
                        const newCallCode = ' ' + ident + '(' + getNodeText(node.arguments[0]) + ')';
                        resultParts.push(newCallCode);
                        return;
                    }
                    const childCount = node.getChildCount(sourceFile);
                    let hasChildren = childCount > 0;
                    if (!hasChildren) { // leaf node
                        resultParts.push(getNodeText(node));
                    } else {
                        let started = false;
                        for (let i = 0; i < childCount; ++i) {
                            const child = node.getChildAt(i, sourceFile);
                            if (!started && child.pos > node.pos) {
                                // following JSDOC node contents are duplicated here for some
                                // reason, hope this check will cover all similar cases
                            } else {
                                started = true;
                                consumeAst(child);
                            }
                        }
                    }
                };
                //resultParts.push(getNodeText(statement));
                consumeAst(statement);
                return resultParts.join('');
            };

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
                    staticDependencies.push({url: depUrl});
                } else {
                    tsCodeAfterImports += transformStatement(statement) + '\n';
                }
            }
            const isJsSrc = extension === 'js';
            const jsCodeAfterImports = isJsSrc ? tsCodeAfterImports :
                ts.transpile(tsCodeAfterImports, {
                    module: 5, // es6 imports
                    ...compilerOptions,
                });
            const jsCode = jsCodeImports + jsCodeAfterImports;

            return {url, isJsSrc, staticDependencies, jsCode};
        });
};

export default FetchModuleData;