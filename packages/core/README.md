# @cmdly/core

Headless TypeScript engine for command menus and interactive workflows.

```ts
import { createCommandEngine } from '@cmdly/core';
const engine = createCommandEngine({ commands: [{ id: 'hello', label: 'Hello', run: () => console.log('Hello') }] });
engine.select(0);
```

See the [repository](https://github.com/timoogo/cmdly) for documentation and examples.

## Compatibility

ESM-only. `import` works on Node.js 18 and later and in bundlers. `require()` works from Node.js 20.19.0 or 22.12.0 through native `require(esm)`; older versions throw `ERR_REQUIRE_ESM`. See [Compatibility](https://github.com/timoogo/cmdly#compatibility) for TypeScript details.

## License

MIT. See [LICENSE](LICENSE).
