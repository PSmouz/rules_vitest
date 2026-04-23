# Troubleshooting

## Configuration loading

`rules_vitest` generates a Bazel-specific overlay config and then loads your user config through Vite's config loader. That gives TypeScript Vitest configs first-class support without requiring a separate transpilation step.

Supported user config extensions are:

- `.js`
- `.cjs`
- `.mjs`
- `.ts`
- `.cts`
- `.mts`

JSON configs are not supported.

## Reporters

By default `vitest_test` appends:

- `default` for terminal output
- `junit` for Bazel XML test logs

If you need full control, set `auto_configure_reporters = False`.

## Coverage

`bazel coverage` enables Vitest's V8 coverage provider and writes an `lcov` report where Bazel expects it. Your linked `node_modules` must contain both `vitest` and `@vitest/coverage-v8`.

## Sharding

Vitest has native sharding support through `--shard=index/count`. `rules_vitest` maps Bazel sharding environment variables to that CLI and advertises sharding support by touching `TEST_SHARD_STATUS_FILE`.

## Filtering

Bazel's `--test_filter` is mapped to Vitest's file-path filter behavior, not to test-name regex matching. Use it to select matching test files by substring.

## Snapshots

Snapshot updates are supported for external `.snap` files and snapshot directories.

Inline snapshot rewriting is intentionally not supported in v1 because updating source files from Bazel runfiles is a different problem than synchronizing external snapshot artifacts.
