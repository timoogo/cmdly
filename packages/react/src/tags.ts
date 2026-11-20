import type { CommandView, ResolvedTagDefinition, TagDefinition } from '@cmdly/core';

/**
 * Resolve the display definition for a tag on a command view.
 * Merges command-level `tagOverrides` over the provided catalog entry.
 *
 * @example
 * const def = resolveTagDisplay('search', command, registry.tagCatalog);
 */
export function resolveTagDisplay(
  tag: string,
  command: CommandView,
  catalog: Readonly<Record<string, TagDefinition>>,
): ResolvedTagDefinition {
  const catalogDef: TagDefinition = catalog[tag] ?? {};
  const override = (command as CommandView & { tagOverrides?: Record<string, Partial<TagDefinition>> }).tagOverrides?.[tag] ?? {};
  return { key: tag, ...catalogDef, ...override };
}
