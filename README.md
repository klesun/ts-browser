# ts-browser
Run typescript files on the fly with dependencies. Like [ts-node](https://www.npmjs.com/package/ts-node), but for browser.

Perfect fallback solution for environments that are only supposed to host source files, not compiled ones (like [GitHub Pages](https://help.github.com/en/github/working-with-github-pages/about-github-pages)).

Usage: ([sample project](https://github.com/klesun/klesun.github.io/tree/master/entry/midiana))
```html
<script src="https://klesun-misc.github.io/TypeScript/lib/typescriptServices.js"></script>
<script type="module">
    import {loadModule} from 'https://klesun.github.io/ts-browser/src/ts-browser.js';
    loadModule('./index.ts').then(Handler => {
        return Handler.Handler(document.getElementById('composeCont'));
    });
</script>
```

The script uses [`typescriptServices.js`](https://github.com/microsoft/TypeScript/blob/master/lib/typescriptServices.d.ts) to parse ts file for dependencies and transpile it to js.

Each file loads about 10-50 milliseconds, not sure if

The behaviour on circular dependencies may be not what you expect: I tried to mimick typescript's behaviour (which allows circular dependencies) by creating a [`Proxy` object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) for the module which throws errors if you attempt to access a field before module fully loaded. If this appears to be inconsistent, you can file an issue with minimal example - I'll think of a better way to implement circular dependencies then.

There was a similar project once, called [typescript-script](https://github.com/basarat/typescript-script), but it was last updated 5 years ago, did not manage to get it working.
