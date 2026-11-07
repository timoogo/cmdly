# Cmdly — Agent instructions

## Mission
Build a working proof of concept for **Cmdly**, a reusable, open-source-friendly command and interactive workflow library for React. Start from a clean project, independent of Xi or any existing application.

## Non-negotiable product constraints
- The public API must be exceptionally simple and intuitive. A developer should be able to implement a first command in under five minutes.
- Support ordinary commands, async option loading, and optional multi-step flows, including conditional steps.
- Be headless: do not impose Tailwind, shadcn/ui, or another styling framework on consumers.
- Work in standard React applications; do not depend on Next.js.
- TypeScript-first, with useful inference and minimal boilerplate.
- Accessible keyboard interaction, focus management, and sensible ARIA semantics.
- Keep the library lean. Avoid unnecessary abstractions and dependencies.

## Architectural freedom
You choose the API shape (declarative objects, hooks, components, or hybrid), package structure, build tools, and testing stack. Compare at least two API approaches briefly before committing. Optimize for consumer ergonomics over internal cleverness. Do not treat examples in this brief as prescribed API syntax.

## POC acceptance criteria
1. A clean, installable library package with documented exports.
2. A runnable playground demonstrating: a simple command; searchable commands; async choices; a multi-step flow; a conditional step; back/cancel navigation; loading and error states.
3. Keyboard support: open/close, arrow navigation, Enter, Escape; no keyboard traps.
4. Automated tests for core flow transitions, async failures, and keyboard behavior.
5. README with installation, quick start, examples, API rationale, and limitations.
6. Commands and instructions to install, run, test, and build locally.

## Working rules
- Inspect the environment before selecting tooling.
- Work incrementally, validate with tests/typecheck/build, and report results accurately.
- You may create local commits, but **do not push, publish to npm, deploy, or perform destructive operations without explicit approval**.
- Do not modify `~/.config/herdr-app/AGENTS.md` or Herdr itself unless separately requested.
- If a design decision adds complexity to the public API, explain why it is justified.
- Before implementation, show a concise proposed public API and the smallest useful POC scope; then proceed unless a genuinely blocking question remains.
