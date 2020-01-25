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
];

const test = async ({input, output}) => {
    const actual = addPathToUrl(input.path, input.baseUrl);
    if (actual === output) {
        return Promise.resolve();
    } else {
        const msg = 'Expected result:\n' + output +
            '\ndoes not match actual:\n' + actual;
        const exc = new Error(msg);
        return Promise.reject(exc);
    }
};

export {
    testCases,
    test,
};