"""Inject a typed-text test notebook into the reMarkable desktop store."""
import json
import time
import uuid
from pathlib import Path

from rmscene import simple_text_document, write_blocks, read_blocks, RootTextBlock
from rmscene.text import TextDocument

STORE = Path.home() / "Library/Containers/com.remarkable.desktop/Data/Library/Application Support/remarkable/desktop"

TEXT = (
    "Hello from Obsidian!\n"
    "This notebook was created on the Mac, outside the reMarkable app.\n"
    "If you can read this on your Paper Pro, the local-store bridge works.\n"
    "Type a reply below this line with the Folio, then let it sync:\n"
)

doc_id = str(uuid.uuid4())
page_id = str(uuid.uuid4())
now_ms = str(int(time.time() * 1000))

doc_dir = STORE / doc_id
doc_dir.mkdir()

# page .rm with typed text
rm_path = doc_dir / f"{page_id}.rm"
with rm_path.open("wb") as f:
    write_blocks(f, simple_text_document(TEXT))

# verify round-trip before writing sidecars
with rm_path.open("rb") as f:
    blocks = list(read_blocks(f))
tb = next(b for b in blocks if isinstance(b, RootTextBlock))
extracted = "\n".join(str(p) for p in TextDocument.from_scene_item(tb.value).contents)
assert "Hello from Obsidian!" in extracted, extracted
print("round-trip OK:", extracted.splitlines()[0])

content = {
    "cPages": {
        "lastOpened": {"timestamp": "0:0", "value": page_id},
        "original": {"timestamp": "0:0", "value": 0},
        "pages": [{"id": page_id, "idx": {"timestamp": "0:1", "value": "aa"}}],
        "uuids": [],
    },
    "coverPageNumber": 0,
    "documentMetadata": {},
    "dummyDocument": False,
    "extraMetadata": {},
    "fileType": "notebook",
    "fontName": "",
    "formatVersion": 2,
    "lineHeight": 0,
    "orientation": "portrait",
    "pageCount": 1,
    "pageTags": [],
    "sizeInBytes": "0",
    "tags": [],
    "textAlignment": "justify",
    "textScale": 0,
    "zoomMode": "bestFit",
}
metadata = {
    "createdTime": now_ms,
    "deleted": False,
    "lastModified": now_ms,
    "lastOpened": "0",
    "lastOpenedPage": 0,
    "metadatamodified": False,
    "modified": False,
    "new": False,
    "parent": "",
    "pinned": False,
    "source": "",
    "synced": False,
    "type": "DocumentType",
    "version": 0,
    "visibleName": "Obsidian test",
}
(STORE / f"{doc_id}.content").write_text(json.dumps(content, indent=4))
(STORE / f"{doc_id}.metadata").write_text(json.dumps(metadata, indent=4))
(STORE / f"{doc_id}.local").write_text(json.dumps({"contentFormatVersion": 2}, indent=4))
(STORE / f"{doc_id}.pagedata").write_text("Blank\n")

print("injected doc:", doc_id)
print("page:", page_id)
