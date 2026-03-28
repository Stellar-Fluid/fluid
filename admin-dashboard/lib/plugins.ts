export interface Plugin {
  id: string;
  name: string;
  author: string;
  authorUrl: string;
  description: string;
  installCommand: string;
  githubUrl: string;
  stars: number;
  tags: string[];
  featured: boolean;
}

export interface PluginManifest {
  plugins: Plugin[];
}

/** All unique tags across the plugin list, sorted alphabetically. */
export function getAllTags(plugins: Plugin[]): string[] {
  const set = new Set<string>();
  for (const p of plugins) {
    for (const tag of p.tags) {
      set.add(tag);
    }
  }
  return Array.from(set).sort();
}

/** Filter plugins by tag. Returns all plugins when tag is null. */
export function filterByTag(plugins: Plugin[], tag: string | null): Plugin[] {
  if (!tag) return plugins;
  return plugins.filter((p) => p.tags.includes(tag));
}

import manifest from "../public/plugins.json";

/** Load the plugin manifest. */
export function loadPlugins(): Plugin[] {
  return (manifest as PluginManifest).plugins;
}
