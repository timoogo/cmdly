import type { Route } from './+types/home';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Link } from 'react-router';
import { baseOptions } from '@/lib/layout.shared';

export function meta({}: Route.MetaArgs) { return [{ title: 'Cmdly — Command workflows for TypeScript' }, { name: 'description', content: 'Build command menus and interactive workflows with a headless TypeScript engine and React integration.' }]; }
export default function Home() {
  return <HomeLayout {...baseOptions()}><div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
    <span className="rounded-full border px-3 py-1 text-xs text-fd-muted-foreground">HEADLESS · TYPESCRIPT · REACT</span>
    <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">Commands that go further.</h1>
    <p className="mt-6 max-w-xl text-lg text-fd-muted-foreground">Compose command menus and guided workflows with a small, framework-independent engine. Bring your own interface or start with React.</p>
    <div className="mt-8 flex flex-wrap justify-center gap-3"><Link className="rounded-full bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground" to="/docs">Get started</Link><a className="rounded-full border px-6 py-3 text-sm font-medium" href="https://github.com/timoogo/cmdly">View on GitHub</a></div>
    <div className="mt-20 grid max-w-4xl gap-8 text-left sm:grid-cols-3"><section><h2 className="font-semibold">Headless core</h2><p className="mt-2 text-sm text-fd-muted-foreground">Own the UI while the engine handles navigation and execution.</p></section><section><h2 className="font-semibold">Composable registries</h2><p className="mt-2 text-sm text-fd-muted-foreground">Mount commands from independent parts of your application.</p></section><section><h2 className="font-semibold">React ready</h2><p className="mt-2 text-sm text-fd-muted-foreground">Subscribe to the engine or use the unstyled palette.</p></section></div>
  </div></HomeLayout>;
}
