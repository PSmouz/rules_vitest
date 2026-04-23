# Bazel rules for Vitest

Runs tests with the [Vitest](https://vitest.dev) test runner under Bazel.

`rules_vitest` is shaped after [`aspect-build/rules_jest`](https://github.com/aspect-build/rules_jest), but leans on Vitest-native features for sharding, JUnit reporting, coverage, and file filtering.

## Status

This repository is intentionally bootstrapped as a full ruleset:

- Bzlmod-first, for Bazel 9.x
- Built on [`rules_js`](https://github.com/aspect-build/rules_js)
- Cross-platform CI
- Example targets covering common Vitest modes
- E2E consumer test using `local_path_override`

## Installation

Add the module to `MODULE.bazel`:

```starlark
bazel_dep(name = "rules_vitest", version = "<release>")
```

Then load the macro:

```starlark
load("@rules_vitest//vitest:defs.bzl", "vitest_test")
```

## Usage

```starlark
load("@npm//:defs.bzl", "npm_link_all_packages")
load("@rules_vitest//vitest:defs.bzl", "vitest_test")

npm_link_all_packages(name = "node_modules")

vitest_test(
    name = "unit_test",
    node_modules = ":node_modules",
    data = [
        "src/math.js",
        "src/math.test.js",
    ],
)
```

Run all Vitest tests:

```bash
bazel test //...
```

By default, `vitest_test` uses Bazel's standard test working directory. If your tests need a package-relative working directory, opt in explicitly:

```starlark
vitest_test(
    name = "unit_test",
    node_modules = ":node_modules",
    chdir = native.package_name(),
    data = [
        "src/math.js",
        "src/math.test.js",
    ],
)
```

Filter by file path substring:

```bash
bazel test --test_filter=math //example/simple:test
```

Update snapshots:

```bash
bazel run //example/snapshots:test_update_snapshots
```

See the packages in [`example`](/Users/psmouz/rules_vitest/example) for working configurations and [`docs/troubleshooting.md`](/Users/psmouz/rules_vitest/docs/troubleshooting.md) for common pitfalls.
