// Verifies the real npm archives in an isolated project outside the monorepo.
// Runtime scenarios run with the current Node, or with every binary listed in
// CMDLY_NODE_BINARIES (comma-separated paths), e.g. to validate minimum versions.
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'cmdly-pack-'));
const packs = join(temp, 'packs'), consumer = join(temp, 'consumer');
const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm', pnpm = win ? 'pnpm.cmd' : 'pnpm';
const bin = name => join(consumer, 'node_modules', '.bin', win ? `${name}.cmd` : name);
const nodes = (process.env.CMDLY_NODE_BINARIES || process.execPath).split(',').map(value => value.trim()).filter(Boolean);
const names = ['core', 'react'];

function spawn(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'pipe', shell: win && command.endsWith('.cmd') });
  if (result.error) throw result.error;
  return result;
}
function run(command, args, cwd) {
  const result = spawn(command, args, cwd);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}${result.stderr}`);
  return result.stdout;
}
const file = (name, content) => writeFile(join(consumer, name), content);

// Shared by the runtime scenarios: public exports and registry composition across module instances.
const helpers = `
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const coreExports = ['createCommandEngine', 'createCommandRegistry', 'CommandUnavailableError'];
const reactExports = [...coreExports, 'useCommandEngine', 'CommandPalette'];
function checkExports(label, module, expected) {
  for (const name of expected) assert(typeof module[name] === 'function', label + ' is missing export ' + name);
}
function checkSame(a, b, label) {
  for (const name of a.coreExports) assert(a.core[name] === b.core[name] && a.core[name] === a.react[name] && a.core[name] === b.react[name], label + ': ' + name + ' has several instances');
  assert(new a.core.CommandUnavailableError('x') instanceof b.core.CommandUnavailableError, label + ': CommandUnavailableError identity');
  // Registries rely on a module-level WeakMap: mounting fails when two engine instances exist.
  const rootRegistry = a.core.createCommandRegistry(), child = b.core.createCommandRegistry(), grandchild = a.react.createCommandRegistry();
  grandchild.register({ id: 'leaf', label: 'Leaf', run: () => 'ok' });
  child.mount('grand', grandchild);
  rootRegistry.mount('child', child);
  rootRegistry.register({ id: 'top', label: 'Top', run: () => 'ok' });
  assert(rootRegistry.resolve('child.grand.leaf'), label + ': mounted registry entry not resolved');
  const engine = b.react.createCommandEngine({ registry: rootRegistry });
  assert(engine.getSnapshot().items.length === 2, label + ': engine does not read the composed registry');
  engine.destroy();
}
`;

try {
  await mkdir(packs); await mkdir(consumer);
  const licenseText = await readFile(join(root, 'LICENSE'), 'utf8');
  const archives = {}, versions = {};

  // 1. Archive contents, produced by the same pnpm pack used for publication.
  for (const name of names) {
    const expected = JSON.parse(await readFile(join(root, 'packages', name, 'package.json'), 'utf8'));
    const output = run(pnpm, ['pack', '--json', '--pack-destination', packs], join(root, 'packages', name));
    const info = JSON.parse(output.slice(output.indexOf('{\n  "name"')));
    if (info.name !== `@cmdly/${name}` || info.version !== expected.version) throw new Error(`Unexpected package: ${info.name}@${info.version}`);
    const files = info.files.map(entry => entry.path);
    for (const required of ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts']) if (!files.includes(required)) throw new Error(`${info.name} archive is missing ${required}`);
    const stray = files.filter(path => !['package.json', 'README.md', 'LICENSE'].includes(path) && !(path.startsWith('dist/') && /\.(js|d\.ts)$/.test(path) && !/\.test\./.test(path)));
    if (stray.length) throw new Error(`${info.name} archive contains unexpected files: ${stray.join(', ')}`);
    for (const path of files.filter(path => path.endsWith('.js'))) if (!files.includes(path.replace(/\.js$/, '.d.ts'))) throw new Error(`${info.name} archive is missing declarations for ${path}`);
    archives[name] = info.filename.startsWith(packs) ? info.filename : join(packs, info.filename);
    versions[name] = expected.version;
  }
  if (versions.core !== versions.react) throw new Error(`Package versions differ: core ${versions.core}, react ${versions.react}`);

  await file('package.json', JSON.stringify({ name: 'cmdly-package-consumer', private: true }));
  const install = (...args) => run(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts', ...args], consumer);

  // 2. Core alone must not need React.
  install(archives.core);
  run(process.execPath, ['--input-type=module', '-e', `import {createCommandRegistry} from '@cmdly/core'; import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); try { require.resolve('react'); throw Error('core unexpectedly installed React'); } catch (e) { if(e.code !== 'MODULE_NOT_FOUND') throw e; } createCommandRegistry();`], consumer);

  // 3. Both packages installed together from the archives.
  install(archives.react, 'react@19.3.1');
  if (existsSync(join(consumer, 'node_modules', '@cmdly', 'react', 'node_modules', '@cmdly'))) throw new Error('@cmdly/react installed a nested @cmdly/core instead of the packed archive');
  for (const name of names) {
    const manifest = JSON.parse(await readFile(join(consumer, 'node_modules', '@cmdly', name, 'package.json'), 'utf8'));
    for (const key of ['dependencies', 'peerDependencies', 'optionalDependencies']) for (const value of Object.values(manifest[key] || {})) if (/^(workspace:|file:|link:)/.test(value)) throw new Error(`Unresolved ${key} in @cmdly/${name}: ${value}`);
    if (manifest.license !== 'MIT') throw new Error(`Unexpected license in @cmdly/${name}`);
    if (await readFile(join(consumer, 'node_modules', '@cmdly', name, 'LICENSE'), 'utf8') !== licenseText) throw new Error(`License mismatch in @cmdly/${name}`);
  }
  // Resolution must land on real files of the installed archives, identically for import and require.
  const installed = realpathSync(join(consumer, 'node_modules')) + sep;
  const resolved = JSON.parse(run(process.execPath, ['--input-type=module', '-e', `import {createRequire} from 'node:module'; import {fileURLToPath} from 'node:url'; const require=createRequire(import.meta.url); const out={}; for (const n of ['@cmdly/core','@cmdly/react']) out[n]={require:require.resolve(n), import:fileURLToPath(import.meta.resolve(n))}; console.log(JSON.stringify(out));`], consumer));
  for (const [name, paths] of Object.entries(resolved)) {
    if (paths.require !== paths.import) throw new Error(`${name} resolves differently for require (${paths.require}) and import (${paths.import})`);
    const real = realpathSync(paths.import);
    if (!real.startsWith(installed)) throw new Error(`${name} resolves outside the consumer: ${real}`);
    if (!existsSync(real.replace(/\.js$/, '.d.ts'))) throw new Error(`${name} entry point has no declarations`);
  }

  // 4. Runtime scenarios for each Node version.
  await file('esm.mjs', `${helpers}
const core = await import('@cmdly/core'), react = await import('@cmdly/react');
checkExports('import(@cmdly/core)', core, coreExports);
checkExports('import(@cmdly/react)', react, reactExports);
checkSame({ core, react, coreExports }, { core, react }, 'ESM');
`);
  await file('cjs.cjs', `${helpers}
const core = require('@cmdly/core'), react = require('@cmdly/react');
for (const name of ['@cmdly/core', '@cmdly/react']) assert(require.resolve(name).endsWith('index.js'), 'require.resolve(' + name + ')');
checkExports('require(@cmdly/core)', core, coreExports);
checkExports('require(@cmdly/react)', react, reactExports);
checkSame({ core, react, coreExports }, { core, react }, 'CommonJS');
`);
  await file('identity.cjs', `${helpers}
const required = { core: require('@cmdly/core'), react: require('@cmdly/react'), coreExports };
(async () => {
  const imported = { core: await import('@cmdly/core'), react: await import('@cmdly/react'), coreExports };
  checkSame(required, imported, 'require then import');
  checkSame(imported, required, 'import into require');
})().catch(error => { console.error(error); process.exit(1); });
`);
  await file('identity.mjs', `${helpers}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const imported = { core: await import('@cmdly/core'), react: await import('@cmdly/react'), coreExports };
const required = { core: require('@cmdly/core'), react: require('@cmdly/react'), coreExports };
checkSame(imported, required, 'import then require');
`);
  await file('unsupported.cjs', `
try { require('@cmdly/core'); } catch (error) { if (error.code === 'ERR_REQUIRE_ESM') process.exit(0); throw error; }
throw new Error('require() unexpectedly succeeded');
`);
  const report = [];
  for (const node of nodes) {
    const [version, requireModule] = run(node, ['-p', 'process.version + " " + (process.features.require_module === true)'], consumer).trim().split(' ');
    run(node, ['esm.mjs'], consumer);
    if (requireModule === 'true') {
      for (const script of ['cjs.cjs', 'identity.cjs', 'identity.mjs']) run(node, [script], consumer);
      report.push(`${version}: ESM, require(), import/require identity`);
    } else {
      // Documented limitation: Cmdly is ESM-only, and this Node cannot require() ES modules.
      run(node, ['unsupported.cjs'], consumer);
      report.push(`${version}: ESM only (require() fails with ERR_REQUIRE_ESM as documented)`);
    }
  }

  // 5. TypeScript consumers. TypeScript 7 removed node10, which is checked with TypeScript 5.9.
  install('--save-dev', 'typescript@7.0.2', 'typescript5@npm:typescript@5.9.3', 'vite@8.3.5', '@types/react@19.3.0', '@types/react-dom@19.3.0', 'react-dom@19.3.1');
  const typeUse = `const registry: CommandRegistry<{ name: string }, undefined, false> = createCommandRegistry({ shared: { name: 'x' } });
registry.register({ id: 'x', label: 'X', run: (_answers, context) => context.shared.name });
const engine = createCommandEngine({ registry });
const palette: typeof CommandPalette = CommandPalette;
const hook: typeof useCommandEngine = useCommandEngine;
const error: CommandUnavailableError = new CommandUnavailableError('x');
console.log(engine.getSnapshot().items.length, typeof palette, typeof hook, error.qualifiedId);`;
  const typeImports = `import { createCommandEngine, createCommandRegistry, CommandUnavailableError, type CommandRegistry } from '@cmdly/core';
import { CommandPalette, useCommandEngine } from '@cmdly/react';`;
  await mkdir(join(consumer, 'types'));
  await file('types/esm.mts', `${typeImports}\n${typeUse}\n`);
  await file('types/cjs.cts', `${typeImports}\n${typeUse}\n`);
  await file('types/node10.ts', `${typeImports}\n${typeUse}\n`);
  await file('types/node16-dynamic.cts', `import type { CommandRegistry } from '@cmdly/core' with { 'resolution-mode': 'import' };
export async function load(): Promise<CommandRegistry> { const { createCommandRegistry } = await import('@cmdly/core'); await import('@cmdly/react'); return createCommandRegistry(); }
`);
  const base = { target: 'ES2022', strict: true, skipLibCheck: false, types: [] };
  const tsconfig = (name, options, include) => file(name, JSON.stringify({ compilerOptions: { ...base, ...options }, include }));
  await tsconfig('tsconfig.nodenext.json', { module: 'nodenext', moduleResolution: 'nodenext', rootDir: 'types', outDir: 'out' }, ['types/esm.mts', 'types/cjs.cts']);
  await tsconfig('tsconfig.node16.json', { module: 'node16', moduleResolution: 'node16', noEmit: true }, ['types/node16-dynamic.cts']);
  await tsconfig('tsconfig.node16-static.json', { module: 'node16', moduleResolution: 'node16', noEmit: true }, ['types/cjs.cts']);
  await tsconfig('tsconfig.node10.json', { module: 'commonjs', moduleResolution: 'node10', esModuleInterop: true, noEmit: true }, ['types/node10.ts']);
  await file('main.tsx', `import React from 'react';
import {createCommandEngine, createCommandRegistry, type CommandContext} from '@cmdly/core';
import {useCommandEngine, CommandPalette, createCommandRegistry as fromReact} from '@cmdly/react';
const registry=createCommandRegistry<{name:string},{id:number}>({shared:{name:'x'},runtimeRequired:true});
registry.register({id:'x',label:'X',run:(_a,ctx)=>{const value: CommandContext<{name:string},{id:number}>=ctx; return value.runtime.id;}});
const engine=createCommandEngine({registry,runtime:()=>({id:1})});
function App(){const {state}=useCommandEngine(engine); return <><span>{state.phase}</span><CommandPalette commands={[]} open={false} onOpenChange={()=>{}} /></>;}
console.log(App,fromReact);
`);
  await file('index.html', '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Consumer</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
  await tsconfig('tsconfig.json', { module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', skipLibCheck: true, noEmit: true }, ['main.tsx']);

  const tsc = bin('tsc');
  run(tsc, ['-p', 'tsconfig.json'], consumer);
  run(tsc, ['-p', 'tsconfig.nodenext.json'], consumer);
  run(tsc, ['-p', 'tsconfig.node16.json'], consumer);
  run(join(consumer, 'node_modules', 'typescript5', 'bin', 'tsc'), ['-p', 'tsconfig.node10.json'], consumer);
  // Expected restriction: node16 forbids a static import of an ES module from CommonJS.
  const node16 = spawn(tsc, ['-p', 'tsconfig.node16-static.json'], consumer);
  if (node16.status === 0 || !/TS1479/.test(node16.stdout + node16.stderr)) throw new Error(`Expected TS1479 for a static import in a node16 CommonJS file:\n${node16.stdout}${node16.stderr}`);
  // The CommonJS emitted by TypeScript nodenext must run, using require().
  for (const node of nodes) {
    run(node, [join('out', 'esm.mjs')], consumer);
    if (run(node, ['-p', 'process.features.require_module === true'], consumer).trim() === 'true') run(node, [join('out', 'cjs.cjs')], consumer);
  }
  run(bin('vite'), ['build'], consumer);

  console.log(`Real pnpm archives (@cmdly/core@${versions.core}, @cmdly/react@${versions.react}) verified outside the monorepo:`);
  for (const line of report) console.log(`  Node ${line}`);
  console.log('  TypeScript: bundler, nodenext (ESM and CommonJS, emitted and run), node16 (dynamic import; static import rejected with TS1479), node10 (TypeScript 5.9)');
  console.log('  Vite production bundle');
} finally { await rm(temp, { recursive: true, force: true }); }
