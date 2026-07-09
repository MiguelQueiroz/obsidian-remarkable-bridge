"""Read back the typed text of the injected 'Obsidian test' document."""
import json
from pathlib import Path

from rmscene import read_blocks, RootTextBlock
from rmscene.text import TextDocument

STORE = Path.home() / "Library/Containers/com.remarkable.desktop/Data/Library/Application Support/remarkable/desktop"
DOC_ID = "ae7e0c59-9689-460a-a6e3-acdb3672204b"

meta = json.loads((STORE / f"{DOC_ID}.metadata").read_text())
content = json.loads((STORE / f"{DOC_ID}.content").read_text())
print("name:", meta["visibleName"], "| lastModified:", meta["lastModified"])
print("pages:", [p["id"] for p in content["cPages"]["pages"]])
print()

for page in content["cPages"]["pages"]:
    rm_file = STORE / DOC_ID / f"{page['id']}.rm"
    if not rm_file.exists():
        print(f"[page {page['id']}: no .rm file]")
        continue
    with rm_file.open("rb") as f:
        blocks = list(read_blocks(f))
    for b in blocks:
        if isinstance(b, RootTextBlock):
            doc = TextDocument.from_scene_item(b.value)
            print("\n".join(str(p) for p in doc.contents))
    strokes = sum(1 for b in blocks if type(b).__name__ == "SceneLineItemBlock")
    if strokes:
        print(f"[+ {strokes} pen strokes on this page]")
