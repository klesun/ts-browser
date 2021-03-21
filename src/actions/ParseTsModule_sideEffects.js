
var org = org || {};
org.klesun = org.klesun || {};
org.klesun.tsBrowser = org.klesun.tsBrowser || {};

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
            // `import {A, B, C as Cc} from './module';`
            let items = [];
            for (let el of elements) {
                if (el.propertyName) {
                    // name as propertyName
                    items.push(el.propertyName.escapedText + ": " + el.name.escapedText);
                } else {
                    // just name
                    items.push(el.name.escapedText);
                }
            }
            return 'const {' + items.join(", ") + "}";
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

const CACHE_LOADED = 'ts-browser-loaded-modules';
const IMPORT_DYNAMIC = 'ts-browser-import-dynamic';

const transformStatement = ({statement, sourceFile, baseUrl, ts}) => {
    const dynamicDependencies = [];

    const getNodeText = node => {
        return node.getFullText(sourceFile);
    };

    const resultParts = [];
    /** @param {ts.Node} node */
    const consumeAst = (node) => {
        if (ts.SyntaxKind[node.kind] === 'CallExpression' &&
            ts.SyntaxKind[(node.expression || {}).kind] === 'ImportKeyword' &&
            (node.arguments || []).length === 1
        ) {
            const ident = 'window[' + JSON.stringify(IMPORT_DYNAMIC) + ']';
            const arg = node.arguments[0];
            // the leading space is important, cuz transpiler glues `await` to `window` otherwise
            const newCallCode = ' ' + ident + '(' +
                getNodeText(arg) + ', ' +
                JSON.stringify(baseUrl) +
            ')';
            resultParts.push(newCallCode);
            const url = ts.SyntaxKind[arg.kind] !== 'StringLiteral' ? null :
                org.klesun.tsBrowser.addPathToUrl(arg.text, baseUrl);
            dynamicDependencies.push({
                url: url,
                ...(url ? {} : {
                    raw: getNodeText(arg),
                    kind: ts.SyntaxKind[arg.kind],
                }),
            });
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
    const nodeText = getNodeText(statement);
    let tsCode;
    // processing the syntax tree here is awfully slow - about
    // same time as how long typescript takes to transpile it
    if (nodeText.match(/\bimport\(/)) {
        consumeAst(statement);
        tsCode = resultParts.join('');
    } else {
        tsCode = nodeText;
    }
    return {tsCode, dynamicDependencies};
};

/**
 * @param {ts} ts
 * @param {ts.CompilerOptions} compilerOptions
 */
org.klesun.tsBrowser.ParseTsModule_sideEffects = ({
    fullUrl, tsCode, compilerOptions, ts, addPathToUrl,
}) => {
    const extension = fullUrl.replace(/^.*\./, '');
    const sourceFile = ts.createSourceFile(
        'ololo.' + extension, tsCode, compilerOptions.target
    );
    let jsCodeImports = '';
    let tsCodeAfterImports = '';
    const staticDependencies = [];
    const dynamicDependencies = [];

    for (const statement of sourceFile.statements) {
        const kindName = ts.SyntaxKind[statement.kind];
        if (kindName === 'ImportDeclaration') {
            const relPath = statement.moduleSpecifier.text;
            const {importClause = null} = statement;
            const depUrl = addPathToUrl(relPath, fullUrl);
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
            const transformed = transformStatement({
                statement, baseUrl: fullUrl, sourceFile, ts,
            });
            dynamicDependencies.push(...transformed.dynamicDependencies);
            tsCodeAfterImports += transformed.tsCode + '\n';
        }
    }
    const isJsSrc = extension === 'js';
    const getJsCodeAfterImports = () => isJsSrc
        ? tsCodeAfterImports
        : ts.transpile(tsCodeAfterImports, {
            module: 5, // es6 imports
            ...compilerOptions,
        });
    const getJsCode = () => {
        const afterImports = getJsCodeAfterImports();
        return jsCodeImports + afterImports;
    };

    return {isJsSrc, staticDependencies, dynamicDependencies, getJsCode};
};

