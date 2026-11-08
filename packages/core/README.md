# @cmdly/core

Headless TypeScript engine for command menus and interactive workflows.

```ts
import { createCommandEngine } from '@cmdly/core';
const engine = createCommandEngine({ commands: [{ id: 'hello', label: 'Hello', run: () => console.log('Hello') }] });
engine.select(0);
```

See the [repository](https://github.com/timoogo/cmdly) for documentation and examples.

## License

MIT. See [LICENSE](LICENSE).
