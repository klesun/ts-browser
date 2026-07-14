/** @typedef {{ imports: Record<string, string>, integrity?: Record<string, string>, scopes?: Record<string, Record<string, string>> }} ImportMap */

/** @type {ImportMap} */
const defaultImportMap = {
    imports: {},
    integrity: {},
    scopes: {},
};

/**
 * @param {HTMLScriptElement} node
 * @returns {ImportMap} parsed import map object
 */
function parseImportMap(node) {
    try {
        const parsed = JSON.parse(node?.textContent || '{}');
        return {
            imports: parsed.imports || {},
            integrity: parsed.integrity || {},
            scopes: parsed.scopes || {}
        };
    } catch {
        return defaultImportMap;
    }
}

/**
 * @param {Array<ImportMap>} importMaps
 * @returns {ImportMap} merged import map object
 */
function mergeImportMaps(importMaps = []) {
    const mergedImportMap = importMaps.reduce((acc, curr) => {
        const mergedScopes = { ...acc.scopes };
        // first scope wins in case of key conflicts within a scope
        for (const [scopeKey, specifierMap] of Object.entries(curr.scopes || {})) {
            mergedScopes[scopeKey] = {
                ...specifierMap,
                ...((acc.scopes || {})[scopeKey] || {}),
            };
        }

        return {
            // first importmap has higher priority, later cannot override it
            imports: { ...curr.imports, ...acc.imports },
            integrity: { ...curr.integrity, ...acc.integrity },
            scopes: mergedScopes,
        };
    }, defaultImportMap);

    return mergedImportMap;
}


/**
 * @returns {ImportMap | null} parsed import map object or null if not found
 */
export const getImportMap = () => {
    if (typeof window === 'undefined' || typeof window.document === 'undefined') {
        return null;
    }

    // get all <script type="importmap"> nodes in the document
    const nodes = document.querySelectorAll('script[type="importmap"]');

    const parsedImportMaps = Array.from(nodes).map(parseImportMap);

    const mergedImportMap = mergeImportMaps(parsedImportMaps);

    window.ImportMap = mergedImportMap; // for debugging purposes

    return mergedImportMap;
};
