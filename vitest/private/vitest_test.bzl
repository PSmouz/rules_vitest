"""Implementation details for vitest_test."""

load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_file_to_bin_action")
load("@aspect_rules_js//js:libs.bzl", "js_binary_lib", "js_lib_helpers")
load("@bazel_skylib//lib:dicts.bzl", "dicts")
load("@bazel_skylib//lib:paths.bzl", "paths")

_attrs = dicts.add(js_binary_lib.attrs, {
    "config": attr.label(allow_single_file = [".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"]),
    "auto_configure_reporters": attr.bool(default = True),
    "auto_configure_coverage": attr.bool(default = True),
    "run_in_band": attr.bool(default = True),
    "colors": attr.bool(default = True),
    "update_snapshots": attr.bool(default = False),
    "quiet_snapshot_updates": attr.bool(default = False),
    "entry_point": attr.label(mandatory = True),
    "vitest_cli_runfiles_path": attr.string(mandatory = True),
    "vite_runfiles_path": attr.string(mandatory = True),
    "snapshot_dirs": attr.string_list(),
    "snapshot_files": attr.string_list(),
    "snapshot_ext": attr.string(default = ".snap"),
    "package": attr.string(mandatory = True),
    "env_inherit": attr.string_list(
        doc = "Environment variables to inherit from the external environment.",
    ),
    "_config_template": attr.label(
        allow_single_file = True,
        default = Label("//vitest/private:vitest_config_template.mjs"),
    ),
    "_config_helper": attr.label(
        allow_single_file = True,
        default = Label("//vitest/private:vitest_config_helper.mjs"),
    ),
    "_snapshot_sync_helper": attr.label(
        allow_single_file = True,
        default = Label("//vitest/private:snapshot_sync.mjs"),
    ),
    "_lcov_merger": attr.label(
        executable = True,
        default = Label("@aspect_rules_js//js/private/coverage:merger"),
        cfg = "exec",
    ),
})

def _impl(ctx):
    providers = []
    generated_config = ctx.actions.declare_file("%s__vitest.config.mjs" % ctx.label.name)
    user_config = copy_file_to_bin_action(ctx, ctx.file.config) if ctx.attr.config else None

    snapshot_manifest = ctx.actions.declare_file("%s__vitest.snapshots.json" % ctx.label.name)
    ctx.actions.write(
        output = snapshot_manifest,
        content = json.encode({
            "dirs": ctx.attr.snapshot_dirs,
            "ext": ctx.attr.snapshot_ext,
            "files": ctx.attr.snapshot_files,
            "package": ctx.attr.package,
        }),
        is_executable = False,
    )

    ctx.actions.expand_template(
        template = ctx.file._config_template,
        output = generated_config,
        substitutions = {
            "{{AUTO_CONFIGURE_COVERAGE}}": "true" if ctx.attr.auto_configure_coverage else "false",
            "{{AUTO_CONFIGURE_REPORTERS}}": "true" if ctx.attr.auto_configure_reporters else "false",
            "{{CONFIG_HELPER_SHORT_PATH}}": ctx.file._config_helper.short_path,
            "{{USER_CONFIG_SHORT_PATH}}": user_config.short_path if user_config else "",
        },
    )

    unwind_chdir_prefix = ""
    if ctx.attr.chdir:
        unwind_chdir_prefix = "/".join([".."] * len(ctx.attr.chdir.split("/"))) + "/"

    fixed_args = []
    if hasattr(ctx.attr, "fixed_args"):
        fixed_args.extend(ctx.attr.fixed_args)
    fixed_args.extend([
        "run",
        "--config",
        "'" + paths.join(unwind_chdir_prefix, generated_config.short_path) + "'",
        "--configLoader",
        "runner",
    ])
    if ctx.attr.run_in_band:
        fixed_args.append("--no-file-parallelism")
    if not ctx.attr.colors:
        fixed_args.append("--no-color")
    if ctx.attr.update_snapshots:
        fixed_args.append("--update=all")

    fixed_env = {
        "CI": "true",
        "VITEST_BAZEL__QUIET_SNAPSHOT_UPDATES": "1" if ctx.attr.quiet_snapshot_updates else "",
        "VITEST_BAZEL__SNAPSHOT_MANIFEST_SHORT_PATH": snapshot_manifest.short_path,
        "VITEST_BAZEL__SNAPSHOT_SYNC_HELPER_SHORT_PATH": ctx.file._snapshot_sync_helper.short_path,
        "VITEST_BAZEL__UPDATE_SNAPSHOTS": "1" if ctx.attr.update_snapshots else "",
        "VITEST_BAZEL__VITEST_CLI_RUNFILES_PATH": ctx.attr.vitest_cli_runfiles_path,
        "VITEST_BAZEL__VITE_RUNFILES_PATH": ctx.attr.vite_runfiles_path,
        "VITEST_SKIP_INSTALL_CHECKS": "1",
    }
    if ctx.attr.colors:
        fixed_env["FORCE_COLOR"] = "1"

    launcher = js_binary_lib.create_launcher(
        ctx,
        log_prefix_rule_set = "rules_vitest",
        log_prefix_rule = "vitest_test",
        fixed_args = fixed_args,
        fixed_env = fixed_env,
    )

    files = ctx.files.data[:]
    if user_config:
        files.append(user_config)
    files.append(generated_config)
    files.append(snapshot_manifest)
    files.append(ctx.file._config_helper)
    files.append(ctx.file._snapshot_sync_helper)

    runfiles = ctx.runfiles(
        files = files,
        transitive_files = js_lib_helpers.gather_files_from_js_infos(
            targets = ctx.attr.data + [ctx.attr.config] if ctx.attr.config else ctx.attr.data,
            include_sources = ctx.attr.include_sources,
            include_types = ctx.attr.include_types,
            include_transitive_sources = ctx.attr.include_transitive_sources,
            include_transitive_types = ctx.attr.include_transitive_types,
            include_npm_sources = ctx.attr.include_npm_sources,
        ),
    ).merge(launcher.runfiles).merge_all([
        target[DefaultInfo].default_runfiles
        for target in ctx.attr.data
    ])

    if ctx.attr.config and ctx.attr.config[DefaultInfo]:
        runfiles = runfiles.merge(ctx.attr.config[DefaultInfo].default_runfiles)

    if ctx.configuration.coverage_enabled:
        if hasattr(ctx.attr, "_lcov_merger"):
            runfiles = runfiles.merge(ctx.attr._lcov_merger[DefaultInfo].default_runfiles)
        providers.append(coverage_common.instrumented_files_info(
            ctx,
            source_attributes = ["data"],
            extensions = [
                "cjs",
                "cts",
                "js",
                "jsx",
                "mjs",
                "mts",
                "ts",
                "tsx",
            ],
        ))

    providers.append(DefaultInfo(
        executable = launcher.executable,
        runfiles = runfiles,
    ))

    env_inherit = list(ctx.attr.env_inherit) if ctx.attr.env_inherit else []
    if "TESTBRIDGE_TEST_ONLY" not in env_inherit:
        env_inherit.append("TESTBRIDGE_TEST_ONLY")

    providers.append(testing.TestEnvironment(fixed_env, env_inherit))
    return providers

lib = struct(
    attrs = _attrs,
    implementation = _impl,
)

vitest_test = rule(
    attrs = lib.attrs,
    implementation = lib.implementation,
    test = True,
    toolchains = js_binary_lib.toolchains,
)
