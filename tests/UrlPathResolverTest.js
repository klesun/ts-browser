import {addPathToUrl} from "../src/UrlPathResolver.js";

const testCases = [
    {
        title: 'Should not result in "/src/compose/Painter"',
        input: {
            baseUrl: './index.ts',
            path: '../../src/compose/Painter',
        },
        output: '../../src/compose/Painter',
    },
    {
        title: 'Should not result in "../../src/././synths/ISynth"',
        input: {
            baseUrl: '../../src/DataStructures',
            path: './synths/ISynth',
        },
        output: '../../src/synths/ISynth',
    },
    {
        title: 'Should not interpret links without "./" as "/..."',
        input: {
            baseUrl: "../../src/utils/YoutubeApi",
            path: "ServApi",
        },
        output: '../../src/utils/ServApi',
    },
    {
        title: 'without "..", example #1, from root file',
        input: {
            baseUrl: './index.ts',
            path: './some/path/SomeModule.ts',
        },
        output: './some/path/SomeModule.ts',
    },
    {
        title: 'without "..", example #2, sub-directory',
        input: {
            baseUrl: './subDir/index.ts',
            path: './some/path/SomeModule.ts',
        },
        output: './subDir/some/path/SomeModule.ts',
    },
    {
        title: 'To make a function reusable, had change it\' signature to always take both path and base url - the old usage should work same way by adding "." as base url parameter',
        input: {
            baseUrl: './',
            path: './index.ts',
        },
        output: './index.ts',
    },
    {
        title: 'Base url dot, path is sub-directory',
        input: {
            baseUrl: './',
            path: './sub/dir/index.ts',
        },
        output: './sub/dir/index.ts',
    },
    {
        title: 'Base url dot, path is parent directory',
        input: {
            baseUrl: './',
            path: '../../dir/index.ts',
        },
        output: '../../dir/index.ts',
    },
    {
        title: 'Take 2, non-root start script',
        input: {
            baseUrl: './somePath/index.ts',
            path: './doStuff.ts',
        },
        output: './somePath/doStuff.ts',
    },
    {
        title: 'Take 3, main script in parent directory',
        input: {
            baseUrl: '../../somePath/index.ts',
            path: '../stuffPackage/doStuff.ts',
        },
        output: '../../stuffPackage/doStuff.ts',
    },
];

const test = async ({title, input, output}) => {
    const actual = addPathToUrl(input.path, input.baseUrl);
    if (actual === output) {
        return Promise.resolve();
    } else {
        const msg = '#' + title + '\n' + 'Expected result:\n' + output +
            '\ndoes not match actual:\n' + actual;
        const exc = new Error(msg);
        return Promise.reject(exc);
    }
};

export {
    testCases,
    test,
};