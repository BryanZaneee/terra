"""
extract_metadata.py -- extract EXIF/video metadata via exiftool.

Usage:
    Single file:  python3 scripts/extract_metadata.py <path>
    Batch (JSONL): python3 scripts/extract_metadata.py --batch
                   (reads one path per line from stdin)

Dependencies: stdlib only (subprocess, json, sys).
Requires: exiftool in PATH -- install with `brew install exiftool`.
"""

import json
import subprocess
import sys


def _run_exiftool(path):
    """Run exiftool -j -n -d %s on a single path; return parsed list or raise."""
    result = subprocess.run(
        ["exiftool", "-j", "-n", "-d", "%s", path],
        capture_output=True,
        text=True,
        timeout=30,
    )
    return json.loads(result.stdout)


def _int_or_none(value):
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _float_or_none(value):
    if value is None:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _resolve_lens(tags):
    """Return lens_model from LensModel, falling back to LensMake+LensInfo combo."""
    lens_model = tags.get("LensModel")
    if lens_model:
        return lens_model
    parts = []
    make = tags.get("LensMake")
    info = tags.get("LensInfo")
    if make:
        parts.append(make)
    if info:
        parts.append(str(info))
    return " ".join(parts) if parts else None


def _resolve_codec(tags):
    """Return first available codec tag."""
    for key in ("VideoCodec", "CompressorID", "CompressorName"):
        val = tags.get(key)
        if val:
            return str(val)
    return None


def _resolve_date_taken(tags):
    """Return Unix int seconds from DateTimeOriginal or CreateDate (already unix via -d %s)."""
    for key in ("DateTimeOriginal", "CreateDate"):
        raw = tags.get(key)
        if raw is not None:
            val = _int_or_none(raw)
            if val is not None and val > 0:
                return val
    return None


def extract(path):
    """
    Extract metadata for a single path.
    Returns a dict matching Terra's output schema.
    ok=True on success, ok=False on any error.
    """
    try:
        data = _run_exiftool(path)
    except FileNotFoundError:
        return {
            "path": path,
            "ok": False,
            "error": "exiftool not found in PATH; install with `brew install exiftool`",
        }
    except subprocess.TimeoutExpired:
        return {"path": path, "ok": False, "error": "exiftool timed out"}
    except Exception as exc:
        return {"path": path, "ok": False, "error": str(exc)}

    if not data:
        return {"path": path, "ok": False, "error": "exiftool returned no data"}

    tags = data[0]

    exposure_time = tags.get("ExposureTime")
    shutter_us = None
    if exposure_time is not None:
        try:
            shutter_us = int(float(exposure_time) * 1_000_000)
        except (ValueError, TypeError):
            pass

    duration_raw = tags.get("Duration")
    duration_ms = None
    if duration_raw is not None:
        try:
            duration_ms = int(float(duration_raw) * 1000)
        except (ValueError, TypeError):
            pass

    video_width = _int_or_none(tags.get("ImageWidth")) or _int_or_none(tags.get("SourceImageWidth"))
    video_height = _int_or_none(tags.get("ImageHeight")) or _int_or_none(tags.get("SourceImageHeight"))

    return {
        "path": path,
        "ok": True,
        "camera_make": tags.get("Make"),
        "camera_model": tags.get("Model"),
        "lens_model": _resolve_lens(tags),
        "iso": _int_or_none(tags.get("ISO")),
        "aperture": _float_or_none(tags.get("FNumber")),
        "shutter_us": shutter_us,
        "focal_length_mm": _float_or_none(tags.get("FocalLength")),
        "orientation": _int_or_none(tags.get("Orientation")),
        "duration_ms": duration_ms,
        "codec": _resolve_codec(tags),
        "video_width": video_width,
        "video_height": video_height,
        "date_taken_unix": _resolve_date_taken(tags),
    }


def main():
    args = sys.argv[1:]

    if args == ["--batch"]:
        for line in sys.stdin:
            path = line.rstrip("\n")
            if not path:
                continue
            result = extract(path)
            sys.stdout.write(json.dumps(result) + "\n")
            sys.stdout.flush()
    elif len(args) == 1:
        result = extract(args[0])
        print(json.dumps(result))
    else:
        print(json.dumps({
            "path": "",
            "ok": False,
            "error": "Usage: extract_metadata.py <path> | --batch",
        }))
        sys.exit(0)


if __name__ == "__main__":
    main()
