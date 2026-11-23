"""Join the six published chunks and verify the full ZIP."""
from hashlib import sha256
from pathlib import Path
from shutil import copyfileobj

directory = Path(__file__).resolve().parent
name = "Nimble-mountains-audit-full.zip"
checksum_file = directory / "SHA256SUMS.txt"
expected = next(line.split()[0] for line in checksum_file.read_text().splitlines() if line.split()[-1] == name)
parts = [directory / "full" / f"{name}.part-{index:02d}" for index in range(6)]
missing = [part.name for part in parts if not part.is_file()]
if missing:
    raise SystemExit("Missing parts: " + ", ".join(missing))
target = directory / name
temporary = directory / (name + ".joining")
with temporary.open("wb") as joined:
    for part in parts:
        with part.open("rb") as source:
            copyfileobj(source, joined, 1024 * 1024)
digest = sha256()
with temporary.open("rb") as joined:
    for block in iter(lambda: joined.read(1024 * 1024), b""):
        digest.update(block)
if digest.hexdigest() != expected:
    temporary.unlink()
    raise SystemExit("SHA-256 mismatch")
temporary.replace(target)
print(target)
