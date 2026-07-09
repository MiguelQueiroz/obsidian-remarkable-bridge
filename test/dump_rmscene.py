"""Dump typed text of sample .rm files as JSON, for cross-checking the TS codec.

Usage: python dump_rmscene.py FILE [FILE...]  -> JSON on stdout
"""
import json
import sys

from rmscene import read_blocks, RootTextBlock
from rmscene.text import TextDocument

out = {}
for path in sys.argv[1:]:
    try:
        with open(path, "rb") as f:
            blocks = list(read_blocks(f))
    except Exception as e:
        out[path] = {"error": str(e)}
        continue
    paragraphs = []
    for b in blocks:
        if isinstance(b, RootTextBlock):
            doc = TextDocument.from_scene_item(b.value)
            for p in doc.contents:
                paragraphs.append(
                    {
                        "style": int(p.style.value),
                        "spans": [
                            {
                                "text": s.s,
                                "bold": s.properties.get("font-weight") == "bold",
                                "italic": s.properties.get("font-style") == "italic",
                            }
                            for s in p.contents
                            if s.s
                        ],
                    }
                )
    out[path] = {"paragraphs": paragraphs}
print(json.dumps(out))
