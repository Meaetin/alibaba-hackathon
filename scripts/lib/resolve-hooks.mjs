/**
 * Lets a bare-Node script import from `src/`.
 *
 * Everything under `src/` is written for a bundler: `./presets` with no file
 * extension, and `@/lib/planner/knobs` through the tsconfig path alias. Node's
 * ESM resolver does neither, so a script that imports a module which imports
 * either one dies at resolution with `ERR_MODULE_NOT_FOUND` — and it dies on
 * the *inner* import, which makes it look like the inner file is missing.
 *
 * Type-only imports are erased before resolution, which is why some modules
 * import cleanly and others do not: `quiz.ts` only imports types, `profile.ts`
 * imports a real value from `./presets`. That difference is invisible until it
 * bites, so this hook covers both cases rather than the one that broke.
 *
 * Deliberately narrow. It only runs **after** Node's own resolution has already
 * failed, so nothing that resolves today changes behaviour, and it only ever
 * appends a TypeScript extension or expands `@/` — it will not invent a file.
 *
 * Scripts opt in with `node --import ./scripts/lib/resolve-hooks.mjs`. The hook
 * registers itself: `module.registerHooks` runs in this thread, unlike the
 * deprecated `module.register`, so no second file is needed to install it.
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Repo root — this file sits at `<root>/scripts/lib/`. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** What a bundler would try, in the order it would try them. */
function candidatesFor(base) {
  return [`${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts")];
}

function firstExisting(base) {
  for (const candidate of candidatesFor(base)) {
    if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }
  return undefined;
}

function resolve(specifier, context, nextResolve) {
  // `@/x` is the tsconfig alias for `src/x`, and Node has never heard of it.
  if (specifier.startsWith("@/")) {
    const resolved = firstExisting(path.join(ROOT, "src", specifier.slice(2)));
    if (resolved) return resolved;
  }

  try {
    return nextResolve(specifier, context);
  } catch (error) {
    // Only relative specifiers get a second chance; a bare one is a package,
    // and guessing at a file for it would hide a genuinely missing dependency.
    if (!specifier.startsWith(".")) throw error;
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
    const resolved = firstExisting(path.resolve(path.dirname(parent), specifier));
    if (resolved) return resolved;
    throw error;
  }
}

registerHooks({ resolve });
