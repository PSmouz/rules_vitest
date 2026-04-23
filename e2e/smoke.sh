#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

bazel test //...
bazel test --test_filter=alpha //example/filtering:test
bazel test //example/sharding:test --test_sharding_strategy=explicit
bazel coverage //example/simple:test
(
  cd e2e/bzlmod
  bazel test //...
)
