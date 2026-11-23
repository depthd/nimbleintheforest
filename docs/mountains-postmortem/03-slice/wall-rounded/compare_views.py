"""Compare the archived wall-camera frames against the original scene."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont


FAMILIES = (
    ("rounded", "Округлые блоки", (4, 7, 10)),
    ("angular", "Угловатые глыбы", (5, 8, 12)),
)
FRAME_SIZE = (800, 450)


def frame(directory, family, preset):
    filename = directory / f"{family}-{preset}-42.png"
    with Image.open(filename) as source:
        if source.size != FRAME_SIZE:
            raise ValueError(f"{filename}: expected {FRAME_SIZE}, found {source.size}")
        return source.convert("RGB")


def changed_pixels(before, after):
    reds, greens, blues = ImageChops.difference(before, after).split()
    return ImageChops.lighter(ImageChops.lighter(reds, greens), blues).point(
        lambda value: 255 if value else 0
    )


def compare(directory, masks):
    before = frame(directory, "original", 0)
    rows = []
    for family, _, counts in FAMILIES:
        for preset, count in enumerate(counts):
            changed = changed_pixels(before, frame(directory, family, preset))
            mask_path = masks / f"{family}-{preset}.png"
            with Image.open(mask_path) as source:
                if source.size != FRAME_SIZE:
                    raise ValueError(f"{mask_path}: unexpected size")
                silhouette = source.convert("L").point(lambda value: 255 if value else 0)
            # MSAA coverage plus a two-pixel margin for raster rounding. This
            # dilates the independently generated mesh silhouette. It does not
            # use the changed pixels themselves to choose the allowed region.
            silhouette = silhouette.filter(ImageFilter.MaxFilter(5))
            outside = ImageChops.multiply(changed, ImageChops.invert(silhouette))
            rows.append({
                "family": family,
                "count": count,
                "changedPixels": changed.histogram()[255],
                "outsideCompared": silhouette.histogram()[0],
                "outsideChanged": outside.histogram()[255],
                "outsideBBox": outside.getbbox(),
            })
    return rows


def make_sheet(directory, destination):
    width, height = FRAME_SIZE
    caption_height = 46
    sheet = Image.new("RGB", (width * 3, 2 * (height + caption_height)), "#202b37")
    draw = ImageDraw.Draw(sheet)
    face = ImageFont.truetype("DejaVuSans.ttf", 22)
    for row, (family, label, counts) in enumerate(FAMILIES):
        y = row * (height + caption_height)
        for preset, count in enumerate(counts):
            x = preset * width
            sheet.paste(frame(directory, family, preset), (x, y))
            draw.text((x + 16, y + height + 8), f"{label} · {count} · сид 42",
                      font=face, fill="#f4f6f8")
    sheet.save(destination)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("masks", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--no-shadows", type=Path)
    parser.add_argument("--base", type=Path, help="Original f79fcb7 camera capture directory")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    result = {"viewport": FRAME_SIZE, "seed": 42, "silhouetteMarginPixels": 2,
              "withShadows": compare(args.frames, args.masks)}
    if args.base:
        changed = changed_pixels(frame(args.base, "original", 0), frame(args.frames, "original", 0))
        result["baseAgainstDefault"] = {"changedPixels": changed.histogram()[255],
                                        "changedBBox": changed.getbbox()}
    if args.no_shadows:
        normal_base = frame(args.frames, "original", 0)
        control_base = frame(args.no_shadows, "original", 0)
        changed = changed_pixels(normal_base, control_base)
        count = changed.histogram()[255]
        if count == 0:
            raise ValueError("The no-shadow control is pixel-identical to the lit base")
        result["noShadowControlAgainstDefault"] = {"changedPixels": count,
                                                   "changedBBox": changed.getbbox()}
        result["withoutShadows"] = compare(args.no_shadows, args.masks)
    (args.output / "outside-wall.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    make_sheet(args.frames, args.output / "walls-seed42.png")
