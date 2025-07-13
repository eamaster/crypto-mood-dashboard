// @ts-nocheck
// This file is intentionally left minimal.
// Data loading is now handled by the Svelte store in src/lib/stores.js
// This ensures that the data is loaded on the client-side,
// and the store can be used by multiple components.

/** */
export async function load() {
    // You can add any other data loading logic here if needed.
    // For now, we'll return an empty object.
    return {};
}