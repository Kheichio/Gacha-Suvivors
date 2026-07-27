// The ability registry table itself.
//
// This lives in its own module for a specific ES-module reason: `import` is
// HOISTED. If the table were declared in index.js, index.js's own
// `import './star3.js'` would run star3's body — and its `registerAll(...)` call
// — BEFORE index.js's `const AbilityRegistry = ...` had initialized, throwing
// "Cannot access 'AbilityRegistry' before initialization" from the temporal dead
// zone.
//
// With the table in a leaf module that index.js re-exports first, registry.js is
// fully evaluated before any content module runs, and the circular
// star3 -> index -> star3 edge resolves to a live, initialized binding.

/** id -> ability implementation. Populated by the per-rarity content modules. */
export const AbilityRegistry = Object.create(null);

/**
 * Register one ability.
 *
 * A duplicate id is a hard error, not a silent overwrite: two characters
 * accidentally sharing an ability id would mean one of them quietly inherits
 * the other's kit, which is exactly the failure the one-to-one rule exists to
 * prevent and exactly the kind that produces no error at runtime.
 */
export function register(id, impl) {
  if (AbilityRegistry[id]) {
    throw new Error(`[abilities] duplicate registration for "${id}"`);
  }
  AbilityRegistry[id] = impl;
  return impl;
}

/** Register several at once — the shape every content module uses. */
export function registerAll(map) {
  for (const id in map) register(id, map[id]);
  return map;
}
