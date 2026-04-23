"""Public API for Vitest rules."""

load("@aspect_bazel_lib//lib:copy_file.bzl", "copy_file")
load("@aspect_bazel_lib//lib:utils.bzl", "default_timeout", "to_label")
load("@aspect_tools_telemetry_report//:defs.bzl", "TELEMETRY")  # buildifier: disable=load
load("//vitest/private:vitest_test.bzl", vitest_test_rule = "vitest_test")

UPDATE_SNAPSHOTS_TARGET_SUFFIX = "_update_snapshots"

def _vitest_from_node_modules(vitest_rule, name, node_modules, auto_configure_reporters, auto_configure_coverage, **kwargs):
    data = kwargs.pop("data", [])

    vitest_dep = "{}/vitest".format(node_modules)
    vite_dep = "{}/vite".format(node_modules)
    coverage_dep = "{}/@vitest/coverage-v8".format(node_modules)

    for dep in [vitest_dep, vite_dep]:
        if dep not in data:
            data.append(dep)

    if auto_configure_coverage and coverage_dep not in data:
        data.append(coverage_dep)

    vitest_rule(
        name = name,
        enable_runfiles = select({
            Label("@aspect_bazel_lib//lib:enable_runfiles"): True,
            "//conditions:default": False,
        }),
        data = data,
        testonly = True,
        auto_configure_reporters = auto_configure_reporters,
        auto_configure_coverage = auto_configure_coverage,
        **kwargs
    )

def _collect_snapshot_inputs(name, snapshots, snapshots_ext):
    snapshot_data = []
    snapshot_dirs = []
    snapshot_files = []

    if snapshots == True:
        snapshots = native.glob(["**/__snapshots__"], exclude_directories = 0, allow_empty = True)

    if type(snapshots) == "string":
        snapshots = [snapshots]

    if type(snapshots) == "list":
        for snapshot in snapshots:
            snapshot_label = to_label(snapshot)
            if snapshot_label.package != native.package_name():
                fail("Expected vitest_test '{}' snapshots to stay in package '{}' but got '{}'".format(
                    name,
                    native.package_name(),
                    snapshot_label,
                ))
            if snapshot_label.name.endswith(snapshots_ext):
                snapshot_files.append(snapshot_label.name)
                snapshot_data.append(snapshot_label)
            else:
                snapshot_dirs.append(snapshot_label.name)
                snapshot_data.extend(native.glob(["{}/**".format(snapshot_label.name)], allow_empty = True))
    elif snapshots not in [False, None]:
        fail("snapshots must be a boolean, string, or list, got {}".format(type(snapshots)))

    return snapshot_data, snapshot_dirs, snapshot_files

def _linked_package_runfiles_path(link_target, package_name, path_in_package):
    link_label = to_label(link_target)
    prefix = "{}/".format(link_label.package) if link_label.package else ""
    return "{}{}/{}/{}".format(prefix, link_label.name, package_name, path_in_package)

def _merge_unique(items):
    result = []
    for item in items:
        if item not in result:
            result.append(item)
    return result

def vitest_test(
        name,
        node_modules,
        config = None,
        data = [],
        snapshots = False,
        run_in_band = True,
        colors = True,
        auto_configure_reporters = True,
        auto_configure_coverage = True,
        snapshots_ext = ".snap",
        quiet_snapshot_updates = False,
        timeout = None,
        size = None,
        **kwargs):
    """Runs Vitest under Bazel.

    Args:
        name: Target name.
        node_modules: Label pointing at a linked node_modules target.
        config: Optional Vitest config file.
        data: Runtime files for tests and code under test.
        snapshots: False, True, a snapshot directory, or a list of directories/files.
        run_in_band: When True, disable Vitest file parallelism.
        colors: When True, keep color output enabled.
        auto_configure_reporters: Append default + junit reporters for Bazel logs.
        auto_configure_coverage: Configure V8 coverage for bazel coverage.
        snapshots_ext: Expected snapshot file extension.
        quiet_snapshot_updates: Suppress snapshot update output on success.
        timeout: Standard Bazel test timeout.
        size: Standard Bazel test size.
        **kwargs: Passed through to the underlying rule.
    """
    tags = kwargs.pop("tags", [])
    chdir = kwargs.pop("chdir", native.package_name())
    preserve_symlinks_main = kwargs.pop("preserve_symlinks_main", False)

    snapshot_data, snapshot_dirs, snapshot_files = _collect_snapshot_inputs(
        name = name,
        snapshots = snapshots,
        snapshots_ext = snapshots_ext,
    )

    bazel_wrapper = "_{}_vitest_wrapper".format(name)
    copy_file(
        name = bazel_wrapper,
        src = Label("//vitest/private:vitest_wrapper.mjs"),
        out = "_{}_vitest_wrapper.mjs".format(name),
        visibility = ["//visibility:public"],
    )

    vitest_cli_runfiles_path = _linked_package_runfiles_path(
        node_modules,
        "vitest",
        "vitest.mjs",
    )
    vite_runfiles_path = _linked_package_runfiles_path(
        node_modules,
        "vite",
        "dist/node/index.js",
    )

    _vitest_from_node_modules(
        vitest_rule = vitest_test_rule,
        name = name,
        node_modules = node_modules,
        config = config,
        data = _merge_unique(data + snapshot_data),
        run_in_band = run_in_band,
        colors = colors,
        auto_configure_reporters = auto_configure_reporters,
        auto_configure_coverage = auto_configure_coverage,
        tags = tags,
        size = size,
        timeout = default_timeout(size, timeout),
        entry_point = bazel_wrapper,
        vitest_cli_runfiles_path = vitest_cli_runfiles_path,
        vite_runfiles_path = vite_runfiles_path,
        snapshot_dirs = snapshot_dirs,
        snapshot_files = snapshot_files,
        snapshot_ext = snapshots_ext,
        package = native.package_name(),
        preserve_symlinks_main = preserve_symlinks_main,
        chdir = chdir,
        **kwargs
    )

    if snapshots not in [False, None]:
        _vitest_from_node_modules(
            vitest_rule = vitest_test_rule,
            name = name + UPDATE_SNAPSHOTS_TARGET_SUFFIX,
            node_modules = node_modules,
            config = config,
            data = _merge_unique(data + snapshot_data),
            run_in_band = run_in_band,
            colors = colors,
            auto_configure_reporters = auto_configure_reporters,
            auto_configure_coverage = auto_configure_coverage,
            update_snapshots = True,
            quiet_snapshot_updates = quiet_snapshot_updates,
            entry_point = bazel_wrapper,
            vitest_cli_runfiles_path = vitest_cli_runfiles_path,
            vite_runfiles_path = vite_runfiles_path,
            snapshot_dirs = snapshot_dirs,
            snapshot_files = snapshot_files,
            snapshot_ext = snapshots_ext,
            package = native.package_name(),
            preserve_symlinks_main = preserve_symlinks_main,
            chdir = chdir,
            tags = tags + ["manual"],
            **kwargs
        )
