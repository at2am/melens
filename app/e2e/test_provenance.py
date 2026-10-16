import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import build
import provenance


class BuildProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.app = Path(self.temporary.name)
        (self.app / "config").mkdir()
        for mode in ("live", "sample"):
            (self.app / "config" / f"local-e2e-{mode}.json").write_text(json.dumps({
                "MELENS_ENV": "dev", "MAP_DATA_MODE": mode,
            }))
        self.stamp = {"sourceCommit": "current-commit", "appSourceSha256": "current-source"}
        for target, value in (("build.APP", self.app), ("provenance.APP", self.app),
                              ("build.source_stamp", None), ("provenance.source_stamp", None)):
            mocked = patch(target, value) if value is not None else patch(target, return_value=self.stamp)
            self.addCleanup(mocked.stop)
            mocked.start()
        runner_patch = patch("build.subprocess.run", side_effect=self.fake_flutter)
        self.runner = runner_patch.start()
        self.addCleanup(runner_patch.stop)

    def fake_flutter(self, command, **options):
        self.assertFalse(any(argument.startswith("--output") for argument in command))
        config = Path(next(argument.split("=", 1)[1] for argument in command
                           if argument.startswith("--dart-define-from-file=")))
        mode = json.loads(config.read_text())["MAP_DATA_MODE"]
        output = self.app / "build" / "web"
        files = {
            "index.html": "<html></html>", "main.dart.js": mode,
            "flutter_bootstrap.js": "bootstrap", "assets/AssetManifest.bin": "binary",
            "assets/AssetManifest.bin.json": '"binary"',
            "assets/fonts/Roboto.ttf": "roboto", "assets/fonts/MaterialIcons-Regular.otf": "icons",
            "assets/packages/cupertino_icons/assets/CupertinoIcons.ttf": "cupertino",
        }
        for relative, contents in files.items():
            path = output / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(contents)
        (output / "assets" / "FontManifest.json").write_text(json.dumps([
            {"family": "Roboto", "fonts": [{"asset": "fonts/Roboto.ttf"}]},
            {"family": "MaterialIcons", "fonts": [{"asset": "fonts/MaterialIcons-Regular.otf"}]},
            {"family": "CupertinoIcons", "fonts": [{"asset": "packages/cupertino_icons/assets/CupertinoIcons.ttf"}]},
        ]))

    def test_modes_keep_complete_independent_current_bundles(self):
        stale = self.app / "build" / "web" / "obsolete-file"
        stale.parent.mkdir(parents=True)
        stale.write_text("old artifact")
        for mode in ("live", "sample"):
            build.build_variant(mode)
        for mode in ("live", "sample"):
            directory = self.app / "build" / f"web-e2e-{mode}"
            self.assertEqual((directory / "main.dart.js").read_text(), mode)
            self.assertFalse((directory / "obsolete-file").exists())
            self.assertEqual(provenance.validate_build(directory, mode)["dataMode"], mode)

    def test_incomplete_font_output_cannot_replace_a_valid_mode(self):
        build.build_variant("live")
        directory = self.app / "build" / "web-e2e-live"
        original = provenance.bundle_files(directory)
        def incomplete(command, **options):
            self.fake_flutter(command, **options)
            (self.app / "build" / "web" / "assets" / "fonts" / "MaterialIcons-Regular.otf").unlink()
        self.runner.side_effect = incomplete
        with self.assertRaisesRegex(ValueError, "font asset is missing"):
            build.build_variant("live")
        self.assertEqual(provenance.bundle_files(directory), original)

    def font_paths(self, directory):
        manifest = json.loads((directory / "assets" / "FontManifest.json").read_text())
        return {family["family"]: directory / "assets" / family["fonts"][0]["asset"] for family in manifest}

    def test_fonts_are_served_under_content_hashed_names(self):
        build.build_variant("live")
        directory = self.app / "build" / "web-e2e-live"
        fonts = self.font_paths(directory)
        icons = fonts["MaterialIcons"]
        self.assertRegex(icons.name, r"^MaterialIcons-Regular\.[0-9a-f]{16}\.otf$")
        self.assertEqual(icons.read_text(), "icons")
        self.assertRegex(fonts["Roboto"].name, r"^Roboto\.[0-9a-f]{16}\.ttf$")
        self.assertFalse((directory / "assets" / "fonts" / "MaterialIcons-Regular.otf").exists())

        def new_icons(command, **options):
            self.fake_flutter(command, **options)
            (self.app / "build" / "web" / "assets" / "fonts" / "MaterialIcons-Regular.otf").write_text("more icons")
        self.runner.side_effect = new_icons
        build.build_variant("live")
        self.assertNotEqual(self.font_paths(directory)["MaterialIcons"].name, icons.name)

    def test_serving_rejects_removed_fonts_and_tampered_assets(self):
        build.build_variant("sample")
        directory = self.app / "build" / "web-e2e-sample"
        font = self.font_paths(directory)["MaterialIcons"]
        font.write_text("tampered")
        with self.assertRaisesRegex(ValueError, "files differ"):
            provenance.validate_build(directory, "sample")
        font.unlink()
        with self.assertRaisesRegex(ValueError, "font asset is missing"):
            provenance.validate_build(directory, "sample")

    def test_source_changes_during_compilation_do_not_get_current_provenance(self):
        with patch("build.source_stamp", side_effect=[self.stamp, {**self.stamp, "appSourceSha256": "edited"}]):
            with self.assertRaisesRegex(ValueError, "changed during the build"):
                build.build_variant("live")
        self.assertFalse((self.app / "build" / "web-e2e-live").exists())


if __name__ == "__main__":
    unittest.main()
