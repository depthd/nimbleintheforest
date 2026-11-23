"""Measure every RGB change against the archived normal-camera captures."""

import argparse
import io
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageChops


def compare(previous, current):
    delta = ImageChops.difference(previous, current)
    r, g, b = delta.split()
    maximum = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return {"changedPixels": sum(maximum.histogram()[1:]), "bbox": maximum.getbbox(),
            "maxChannelDelta": maximum.getextrema()[1]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", type=Path)
    parser.add_argument("result", type=Path)
    parser.add_argument("--archive", default="caaffff")
    parser.add_argument("--base-source", default="d21ec23")
    parser.add_argument("--new-source", default="dbe4a81")
    args = parser.parse_args()
    ref = lambda rev: subprocess.check_output(["git", "rev-parse", rev], text=True).strip()
    records = []
    captures = json.loads((args.images / "no-shadow" / "materials.json").read_text())
    for item in captures:
        name = f"{item['family']}-{item['preset']}-{item['seed']}.png"
        record = {**item, "filename": name}
        if item["family"] == "angular" and item["material"] != {"factor": -2, "units": -1}:
            raise ValueError("Expected the repaired angular material")
        for mode in ["withShadows", "noShadows"]:
            if mode == "noShadows" and item["seed"] != 42:
                continue
            path = Path(name) if mode == "withShadows" else Path("no-shadow") / name
            object_id = f"{args.archive}:docs/mountains-slice/integration/final-walls/{path}"
            baseline = subprocess.check_output(["git", "show", object_id])
            with Image.open(io.BytesIO(baseline)) as old, Image.open(args.images / path) as new:
                if old.size != (800, 450) or new.size != old.size:
                    raise ValueError(f"Unexpected viewport for {name}")
                record[mode] = compare(old.convert("RGB"), new.convert("RGB"))
        records.append(record)
    result = {"previousSource": ref(args.base_source), "previousFrames": ref(args.archive),
              "currentSource": ref(args.new_source), "viewport": [800, 450], "records": records}
    args.result.write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
