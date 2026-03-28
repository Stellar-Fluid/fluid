/**
 * Plugin marketplace — unit tests
 * Run with: node --test plugins.test.mjs
 * Requires Node.js 18+, zero extra dependencies.
 */

import { readFileSync } from "node:fs";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { describe, it } from "node:test";

// ── Pure logic (mirrors lib/plugins.ts) ────────────────────────────────────

function getAllTags(plugins) {
  const set = new Set();
  for (const p of plugins) for (const tag of p.tags) set.add(tag);
  return Array.from(set).sort();
}

function filterByTag(plugins, tag) {
  if (!tag) return plugins;
  return plugins.filter((p) => p.tags.includes(tag));
}

// ── Load manifest ──────────────────────────────────────────────────────────

const manifest = JSON.parse(readFileSync("./public/plugins.json", "utf-8"));
const plugins = manifest.plugins;

// ── Schema tests ───────────────────────────────────────────────────────────

describe("plugins.json schema", () => {
  it("has at least one plugin", () => {
    ok(plugins.length > 0, "manifest must contain plugins");
  });

  it("every plugin has required string fields", () => {
    for (const p of plugins) {
      ok(typeof p.id === "string" && p.id.length > 0, `${p.id}: id must be a non-empty string`);
      ok(typeof p.name === "string" && p.name.length > 0, `${p.id}: name required`);
      ok(typeof p.author === "string" && p.author.length > 0, `${p.id}: author required`);
      ok(typeof p.authorUrl === "string" && p.authorUrl.startsWith("https://"), `${p.id}: authorUrl must be https`);
      ok(typeof p.description === "string" && p.description.length > 0, `${p.id}: description required`);
      ok(typeof p.installCommand === "string" && p.installCommand.length > 0, `${p.id}: installCommand required`);
      ok(typeof p.githubUrl === "string" && p.githubUrl.startsWith("https://"), `${p.id}: githubUrl must be https`);
    }
  });

  it("every plugin has a non-negative stars count", () => {
    for (const p of plugins) {
      ok(typeof p.stars === "number" && p.stars >= 0, `${p.id}: stars must be >= 0`);
    }
  });

  it("every plugin has at least one tag", () => {
    for (const p of plugins) {
      ok(Array.isArray(p.tags) && p.tags.length > 0, `${p.id}: tags must be a non-empty array`);
    }
  });

  it("every plugin has a boolean featured field", () => {
    for (const p of plugins) {
      strictEqual(typeof p.featured, "boolean", `${p.id}: featured must be boolean`);
    }
  });

  it("all plugin ids are unique", () => {
    const ids = plugins.map((p) => p.id);
    strictEqual(new Set(ids).size, ids.length, "duplicate plugin ids found");
  });

  it("has at least one featured plugin", () => {
    ok(plugins.some((p) => p.featured), "at least one plugin must be featured");
  });
});

// ── getAllTags tests ────────────────────────────────────────────────────────

describe("getAllTags()", () => {
  it("returns sorted unique tags", () => {
    const sample = [
      { tags: ["React", "Go"] },
      { tags: ["React", "Python"] },
    ];
    deepStrictEqual(getAllTags(sample), ["Go", "Python", "React"]);
  });

  it("returns empty array for empty plugin list", () => {
    deepStrictEqual(getAllTags([]), []);
  });

  it("extracts all tags from the real manifest", () => {
    const tags = getAllTags(plugins);
    ok(tags.includes("React"), 'manifest tags must include "React"');
    ok(tags.includes("Python"), 'manifest tags must include "Python"');
    ok(tags.includes("Go"), 'manifest tags must include "Go"');
    ok(tags.includes("Soroban"), 'manifest tags must include "Soroban"');
  });

  it("deduplicates tags that appear in multiple plugins", () => {
    const tags = getAllTags(plugins);
    const reactCount = tags.filter((t) => t === "React").length;
    strictEqual(reactCount, 1, '"React" must appear exactly once');
  });
});

// ── filterByTag tests ───────────────────────────────────────────────────────

describe("filterByTag()", () => {
  it("returns all plugins when tag is null", () => {
    strictEqual(filterByTag(plugins, null).length, plugins.length);
  });

  it("returns only plugins matching the given tag", () => {
    const result = filterByTag(plugins, "React");
    ok(result.length > 0, "expected at least one React plugin");
    ok(result.every((p) => p.tags.includes("React")), "all results must have React tag");
  });

  it("returns empty array when no plugins match", () => {
    deepStrictEqual(filterByTag(plugins, "NONEXISTENT_TAG_XYZ"), []);
  });

  it("filters correctly for Python tag", () => {
    const result = filterByTag(plugins, "Python");
    ok(result.length > 0, "expected at least one Python plugin");
    ok(result.every((p) => p.tags.includes("Python")));
  });

  it("does not mutate the original array", () => {
    const original = [...plugins];
    filterByTag(plugins, "Go");
    strictEqual(plugins.length, original.length);
  });
});
