import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'cmdly-pack-'));
const packs = join(temp, 'packs'), consumer = join(temp, 'consumer');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || ''}`);
  return result.stdout;
}
try {
  await mkdir(packs); await mkdir(consumer);
  const archives = {};
  const licenseText = await readFile(join(root, 'LICENSE'), 'utf8');
  for (const name of ['core', 'react']) {
    const output = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', packs], join(root, 'packages', name), true));
    const info = Array.isArray(output) ? output[0] : output[`@cmdly/${name}`];
    if (info.name !== `@cmdly/${name}` || info.version !== '0.1.0') throw new Error(`Unexpected package: ${info.name}@${info.version}`);
    const files = new Set(info.files.map(file => file.path));
    for (const file of ['package.json', 'dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE']) if (!files.has(file)) throw new Error(`${info.name} missing ${file}`);
    archives[name] = join(packs, info.filename);
  }
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'cmdly-package-consumer', private: true, type: 'module' }));
  const install = (...args) => run(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts', ...args], consumer);
  install(archives.core);
  run(process.execPath, ['--input-type=module', '-e', `import {createCommandRegistry} from '@cmdly/core'; import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); try { require.resolve('react'); throw Error('core unexpectedly installed React'); } catch (e) { if(e.code !== 'MODULE_NOT_FOUND') throw e; } createCommandRegistry();`], consumer);
  install(archives.react, 'react@19.3.1');
  for (const name of ['core', 'react']) {
    const manifest = JSON.parse(await readFile(join(consumer, 'node_modules', '@cmdly', name, 'package.json'), 'utf8'));
    for (const key of ['dependencies','peerDependencies','optionalDependencies']) for (const value of Object.values(manifest[key] || {})) if (/^(workspace:|file:|link:)/.test(value)) throw new Error(`Unresolved ${key} in @cmdly/${name}: ${value}`);
    if (manifest.license !== 'MIT') throw new Error(`Unexpected license in @cmdly/${name}`);
    if (await readFile(join(consumer, 'node_modules', '@cmdly', name, 'LICENSE'), 'utf8') !== licenseText) throw new Error(`License mismatch in @cmdly/${name}`);
    if (manifest.types !== './dist/index.d.ts' || manifest.exports?.['.']?.import !== './dist/index.js') throw new Error(`Unexpected exports for @cmdly/${name}`);
  }
  run(process.execPath, ['--input-type=module', '-e', `import {createCommandRegistry as a,createCommandEngine} from '@cmdly/core'; import {createCommandRegistry as b,useCommandEngine,CommandPalette} from '@cmdly/react'; if(a!==b||typeof useCommandEngine!=='function'||typeof CommandPalette!=='function')throw Error('public exports');const root=a();root.mount('child',b());createCommandEngine({registry:root}).destroy();`], consumer);
  install('--save-dev', 'typescript@7.0.2', 'vite@8.3.5', '@types/react@19.3.0', '@types/react-dom@19.3.0', 'react-dom@19.3.1');
  await writeFile(join(consumer, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Consumer</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>');
  await writeFile(join(consumer, 'main.tsx'), `import React from 'react';
import {createCommandEngine, createCommandRegistry, type CommandContext} from '@cmdly/core';
import {useCommandEngine, CommandPalette, createCommandRegistry as fromReact} from '@cmdly/react';
const registry=createCommandRegistry<{name:string},{id:number}>({shared:{name:'x'},runtimeRequired:true});
registry.register({id:'x',label:'X',run:(_a,ctx)=>{const value: CommandContext<{name:string},{id:number}>=ctx; return value.runtime.id;}});
const engine=createCommandEngine({registry,runtime:()=>({id:1})});
function App(){const {state}=useCommandEngine(engine); return <><span>{state.phase}</span><CommandPalette commands={[]} open={false} onOpenChange={()=>{}} /></>;}
console.log(App,fromReact);
`);
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,skipLibCheck:true,noEmit:true},include:['main.tsx']}));
  run(join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'), ['--noEmit'], consumer);
  run(join(consumer, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite'), ['build'], consumer);
  console.log('Real npm tarballs: standalone core, React, shared registry identity, types and Vite bundle verified.');
} finally { await rm(temp, { recursive: true, force: true }); }
