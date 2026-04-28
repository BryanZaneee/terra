"""
Tests for extract_metadata.py.

Run: python3 -m unittest scripts/test_extract_metadata.py

Subprocess calls to exiftool are mocked -- no exiftool or real photos required.
"""

import io
import json
import sys
import unittest
from unittest.mock import MagicMock, patch

# Allow importing the module regardless of working directory.
import importlib.util
import pathlib

_script_path = pathlib.Path(__file__).parent / "extract_metadata.py"
_spec = importlib.util.spec_from_file_location("extract_metadata", _script_path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
extract = _mod.extract
main = _mod.main


# ---------------------------------------------------------------------------
# Canned exiftool payloads
# ---------------------------------------------------------------------------

IMAGE_TAGS = {
    "SourceFile": "/photos/test.jpg",
    "Make": "Apple",
    "Model": "iPhone 15 Pro",
    "LensModel": "iPhone 15 Pro back triple camera 6.86mm f/1.78",
    "ISO": 64,
    "FNumber": 1.78,
    "ExposureTime": 0.016667,
    "FocalLength": 6.86,
    "Orientation": 1,
    "ImageWidth": 4032,
    "ImageHeight": 3024,
    "DateTimeOriginal": 1730000000,
}

VIDEO_TAGS = {
    "SourceFile": "/videos/clip.mov",
    "Make": "Apple",
    "Model": "iPhone 15 Pro",
    "Duration": 12.5,
    "VideoCodec": "H.264",
    "ImageWidth": 1920,
    "ImageHeight": 1080,
    "CreateDate": 1730001000,
}

MINIMAL_TAGS = {
    "SourceFile": "/photos/bare.jpg",
}


def _make_completed_process(tags):
    cp = MagicMock()
    cp.stdout = json.dumps([tags])
    return cp


class TestImageExtraction(unittest.TestCase):
    @patch("subprocess.run")
    def test_image_fields_mapped_correctly(self, mock_run):
        mock_run.return_value = _make_completed_process(IMAGE_TAGS)
        result = extract("/photos/test.jpg")

        self.assertTrue(result["ok"])
        self.assertEqual(result["path"], "/photos/test.jpg")
        self.assertEqual(result["camera_make"], "Apple")
        self.assertEqual(result["camera_model"], "iPhone 15 Pro")
        self.assertEqual(result["lens_model"], "iPhone 15 Pro back triple camera 6.86mm f/1.78")
        self.assertEqual(result["iso"], 64)
        self.assertAlmostEqual(result["aperture"], 1.78)
        # ExposureTime 0.016667s -> ~16667 us
        self.assertAlmostEqual(result["shutter_us"], 16667, delta=1)
        self.assertAlmostEqual(result["focal_length_mm"], 6.86)
        self.assertEqual(result["orientation"], 1)
        self.assertIsNone(result["duration_ms"])
        self.assertIsNone(result["codec"])
        self.assertEqual(result["date_taken_unix"], 1730000000)


class TestVideoExtraction(unittest.TestCase):
    @patch("subprocess.run")
    def test_video_fields_mapped_correctly(self, mock_run):
        mock_run.return_value = _make_completed_process(VIDEO_TAGS)
        result = extract("/videos/clip.mov")

        self.assertTrue(result["ok"])
        self.assertEqual(result["duration_ms"], 12500)
        self.assertEqual(result["codec"], "H.264")
        self.assertEqual(result["video_width"], 1920)
        self.assertEqual(result["video_height"], 1080)
        # Falls back to CreateDate when DateTimeOriginal absent
        self.assertEqual(result["date_taken_unix"], 1730001000)


class TestMissingFields(unittest.TestCase):
    @patch("subprocess.run")
    def test_all_optional_fields_are_none_when_absent(self, mock_run):
        mock_run.return_value = _make_completed_process(MINIMAL_TAGS)
        result = extract("/photos/bare.jpg")

        self.assertTrue(result["ok"])
        self.assertIsNone(result["camera_make"])
        self.assertIsNone(result["camera_model"])
        self.assertIsNone(result["lens_model"])
        self.assertIsNone(result["iso"])
        self.assertIsNone(result["aperture"])
        self.assertIsNone(result["shutter_us"])
        self.assertIsNone(result["focal_length_mm"])
        self.assertIsNone(result["orientation"])
        self.assertIsNone(result["duration_ms"])
        self.assertIsNone(result["codec"])
        self.assertIsNone(result["video_width"])
        self.assertIsNone(result["video_height"])
        self.assertIsNone(result["date_taken_unix"])


class TestExiftoolNotFound(unittest.TestCase):
    @patch("subprocess.run", side_effect=FileNotFoundError)
    def test_returns_error_json_not_exception(self, _mock):
        result = extract("/photos/any.jpg")

        self.assertFalse(result["ok"])
        self.assertIn("exiftool", result["error"])
        self.assertIn("brew install exiftool", result["error"])


class TestBatchMode(unittest.TestCase):
    @patch("subprocess.run")
    def test_batch_reads_stdin_outputs_jsonl(self, mock_run):
        mock_run.return_value = _make_completed_process(IMAGE_TAGS)

        fake_stdin = io.StringIO("/photos/test.jpg\n/photos/test2.jpg\n")
        captured = io.StringIO()

        original_argv = sys.argv
        original_stdin = sys.stdin
        original_stdout = sys.stdout
        try:
            sys.argv = ["extract_metadata.py", "--batch"]
            sys.stdin = fake_stdin
            sys.stdout = captured
            main()
        finally:
            sys.argv = original_argv
            sys.stdin = original_stdin
            sys.stdout = original_stdout

        lines = [l for l in captured.getvalue().splitlines() if l.strip()]
        self.assertEqual(len(lines), 2)
        for line in lines:
            obj = json.loads(line)
            self.assertTrue(obj["ok"])


class TestLensFallback(unittest.TestCase):
    @patch("subprocess.run")
    def test_lens_fallback_to_make_and_info(self, mock_run):
        tags = {**MINIMAL_TAGS, "LensMake": "Zeiss", "LensInfo": "24-70mm"}
        mock_run.return_value = _make_completed_process(tags)
        result = extract("/photos/zeiss.jpg")

        self.assertTrue(result["ok"])
        self.assertEqual(result["lens_model"], "Zeiss 24-70mm")

    @patch("subprocess.run")
    def test_lens_model_preferred_over_fallback(self, mock_run):
        tags = {**MINIMAL_TAGS, "LensModel": "Preferred Lens", "LensMake": "Other"}
        mock_run.return_value = _make_completed_process(tags)
        result = extract("/photos/pref.jpg")

        self.assertEqual(result["lens_model"], "Preferred Lens")


class TestCodecFallback(unittest.TestCase):
    @patch("subprocess.run")
    def test_compressor_id_used_when_no_video_codec(self, mock_run):
        tags = {**MINIMAL_TAGS, "CompressorID": "avc1"}
        mock_run.return_value = _make_completed_process(tags)
        result = extract("/photos/vid.mp4")

        self.assertEqual(result["codec"], "avc1")


if __name__ == "__main__":
    unittest.main()
