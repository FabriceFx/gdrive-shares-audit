"""Génération du rapport HTML autonome (aucune dépendance réseau)."""
from __future__ import annotations

import json
import os

from .classify import LEVELS

TEMPLATE = os.path.join(os.path.dirname(__file__), "template.html")


def render(outdir: str, records: list[dict], summary: dict, meta: dict) -> str:
    payload = {
        "meta": meta,
        "summary": summary,
        "levels": [{"key": l.key, "rank": l.rank, "label": l.label, "short": l.short,
                    "icon": l.icon, "status": l.status, "hint": l.hint} for l in LEVELS],
        "files": [{k: v for k, v in r.items() if k != "mime"} | {"mime": r["mime"]} for r in records],
    }
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    with open(TEMPLATE, encoding="utf-8") as fh:
        html = fh.read()
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, "rapport.html")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html.replace("__DATA__", data))
    return path
