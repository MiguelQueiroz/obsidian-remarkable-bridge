"""Scan the reMarkable desktop store for notebooks containing typed text."""
import json
import sys
from pathlib import Path

from rmscene import read_blocks, RootTextBlock
from rmscene.text import TextDocument

STORE = Path.home() / "Library/Containers/com.remarkable.desktop/Data/Library/Application Support/remarkable/desktop"

def doc_name(uuid: str) -> str:
    meta = STORE / f"{uuid}.metadata"
    try:
        return json.loads(meta.read_text()).get("visibleName", "?")
    except Exception:
        return "?"

found = 0
scanned = 0
for doc_dir in sorted(STORE.iterdir()):
    if not doc_dir.is_dir() or doc_dir.name.endswith(".thumbnails"):
        continue
    for rm_file in doc_dir.glob("*.rm"):
        scanned += 1
        try:
            with rm_file.open("rb") as f:
                blocks = list(read_blocks(f))
        except Exception:
            continue
        for b in blocks:
            if isinstance(b, RootTextBlock):
                try:
                    doc = TextDocument.from_scene_item(b.value)
                    txt = "\n".join(str(p) for p in doc.contents)
                except Exception as e:
                    txt = f"<extract error: {e}>"
                if txt.strip():
                    found += 1
                    print(f"=== {doc_name(doc_dir.name)}  [{doc_dir.name}/{rm_file.name}]")
                    print(txt[:400])
                    print()
                    if found >= 6:
                        print(f"(stopped early; scanned {scanned} pages)")
                        sys.exit(0)
print(f"done: scanned {scanned} pages, {found} with typed text")
