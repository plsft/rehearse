import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Exclude the runner's clone cache; @rehearse/runner stores remote-action
    // checkouts under .runner/actions/<slug>/ which can include their own
    // test files (e.g. actions/checkout has tests that import @actions/core).
    exclude: ['node_modules', 'dist', '.runner/**', 'coverage'],
  },
});
