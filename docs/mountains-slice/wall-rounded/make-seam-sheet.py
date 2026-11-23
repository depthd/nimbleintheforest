"""Create the visual seam check from native-size RGB camera crops."""

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont


FAMILIES = (
    ("rounded", "Округлые блоки · 7", (249, 230, 553, 414)),
    ("angular", "Угловатые глыбы · 8", (120, 196, 424, 380)),
)
TILE_WIDTH, TILE_HEIGHT, CAPTION = 304, 184, 24
HEADER = 32
FAMILY_HEIGHT = HEADER + 2 * (TILE_HEIGHT + CAPTION)


def read_frame(path):
    with Image.open(path) as source:
        return source.convert("RGB")


def changed_count(a, b):
    r, g, b = ImageChops.difference(a, b).split()
    return sum(ImageChops.lighter(ImageChops.lighter(r, g), b).histogram()[1:])


def compare_frames(frames, repeated):
    hashes = [hashlib.sha256(f.tobytes()).hexdigest() for f in frames]
    if len(set(hashes)) != len(frames):
        raise ValueError("The camera did not move between two poses")
    return {"viewport": frames[0].size, "uniqueViews": len(hashes),
            "repeatCentralViewChangedPixels": changed_count(frames[3], repeated),
            "rgbSha256": hashes}


def paste_row(sheet, draw, font, y, frames, crop, angles):
    # Keep every inspection crop at 1:1 pixels, with the full view first.
    overview = frames[3].copy()
    ImageDraw.Draw(overview).rectangle(crop, outline="#e9973d", width=4)
    overview.thumbnail((TILE_WIDTH, TILE_HEIGHT), Image.Resampling.LANCZOS)
    tiles = [overview] + [f.crop(crop) for f in frames]
    labels = ["Общий план · −117°"] + [f"{azimuth}°".replace("-", "−") for azimuth in angles]
    for i, (tile, label) in enumerate(zip(tiles, labels)):
        x = (i % 4) * TILE_WIDTH
        top = y + (i // 4) * (TILE_HEIGHT + CAPTION)
        sheet.paste(tile, (x, top + (TILE_HEIGHT - tile.height) // 2))
        draw.text((x + 8, top + TILE_HEIGHT + 2), label, font=font, fill="#e9eef1")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("frames", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--previous-frames", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    camera = json.loads((args.frames / "camera.json").read_text())
    sheet = Image.new("RGB", (4 * TILE_WIDTH, 2 * FAMILY_HEIGHT + 152), "#18222d")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("DejaVuSans.ttf", 16)
    results = []
    for i, (family, name, crop) in enumerate(FAMILIES):
        frames = [read_frame(args.frames / f"{family}-{j}.png") for j in range(7)]
        repeated = read_frame(args.frames / f"{family}-7.png")
        record = {"family": family, "crop": crop, **compare_frames(frames, repeated)}
        results.append(record)
        row = i * FAMILY_HEIGHT
        draw.text((8, row + 6), name, font=font, fill="white")
        paste_row(sheet, draw, font, row + HEADER, frames, crop, camera["azimuths"][:7])
    # Extra close-up of the angular cap, preserving individual pixel values.
    lit = read_frame(args.frames / "angular-3.png")
    control = read_frame(args.frames / "angular-no-shadow.png")
    changed = changed_count(lit, control)
    if not changed:
        raise ValueError("The shadow control did not change the image")
    detail = (139, 256, 271, 313)
    y = 2 * FAMILY_HEIGHT
    zoom = 2
    details = [(8, lit, "WB8 · −117° · после · 2×"),
               (395, control, "WB8 · −117° · после, без теней · 2×")]
    comparison = None
    if args.previous_frames:
        previous = read_frame(args.previous_frames / "angular-3.png")
        details = [(8, previous, "WB8 · −117° · до · 2×"),
                   (395, lit, "WB8 · −117° · после · 2×"),
                   (782, control, "WB8 · −117° · после, без теней · 2×")]
        comparison = []
        for i, azimuth in enumerate(camera["azimuths"][:7]):
            old = read_frame(args.previous_frames / f"angular-{i}.png")
            new = read_frame(args.frames / f"angular-{i}.png")
            comparison.append({"azimuth": azimuth, "changedPixels": changed_count(old, new)})
    for x, frame, label in details:
        draw.text((x, y + 3), label, font=font, fill="white")
        tile = frame.crop(detail)
        tile = tile.resize((tile.width * zoom, tile.height * zoom), Image.Resampling.NEAREST)
        sheet.paste(tile, (x, y + 30))
    sheet.save(args.output / "seams.jpg", quality=88, subsampling=1, optimize=True)
    report = {"seed": 42, "presetIndex": 1, "camera": camera, "results": results,
              "angularShadowControlChangedPixels": changed, "angularDetail": detail}
    if comparison is not None:
        report["angularBeforeAfter"] = comparison
    (args.output / "seams.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
