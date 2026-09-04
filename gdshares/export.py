"""Exports CSV / JSON pour retraitement (tableur, SIEM, ticket de remédiation)."""
from __future__ import annotations

import csv
import json
import os

from .classify import BY_KEY, ROLE_LABELS

FILE_COLUMNS = ["id", "nom", "type", "perimetre", "emplacement", "chemin", "proprietaire",
                "exposition", "score_risque", "nb_beneficiaires", "beneficiaires",
                "roles", "dernier_contributeur", "contributeur_interne",
                "derniere_modif", "taille_octets", "lien"]
PERM_COLUMNS = ["fichier_id", "fichier", "chemin", "perimetre", "proprietaire", "beneficiaire",
                "type_beneficiaire", "role", "exposition", "trouvable_en_recherche",
                "herite", "herite_de", "expire_le", "lien"]
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe(value) -> str:
    """Neutralise l'injection de formules (CWE-1236).

    Un nom de fichier Drive est choisi par celui qui partage : « =HYPERLINK(...) »
    serait interprété par Excel ou Sheets à l'ouverture du CSV.
    """
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in FORMULA_PREFIXES else text


def row(values) -> list:
    return [safe(v) for v in values]


def write_all(outdir: str, records: list[dict], summary: dict, meta: dict) -> dict[str, str]:
    os.makedirs(outdir, exist_ok=True)
    paths = {
        "files_csv": os.path.join(outdir, "fichiers.csv"),
        "perms_csv": os.path.join(outdir, "permissions.csv"),
        "json": os.path.join(outdir, "audit.json"),
    }

    with open(paths["files_csv"], "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(FILE_COLUMNS)
        for r in records:
            w.writerow(row([
                r["id"], r["name"], "Dossier" if r["folder"] else r["mime"].rsplit(".", 1)[-1],
                r["scope"], r["container"], r["path"], r["owner"],
                BY_KEY[r["level"]].label, r["score"], len(r["perms"]),
                " | ".join(p["principal"] for p in r["perms"]),
                " | ".join(sorted({p["roleLabel"] for p in r["perms"]})),
                r.get("lastEditor", ""), "oui" if r.get("lastEditorInternal") else "non",
                r["modified"], r["size"], r["link"],
            ]))

    with open(paths["perms_csv"], "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(PERM_COLUMNS)
        for r in records:
            for p in r["perms"]:
                w.writerow(row([
                    r["id"], r["name"], r["path"], r["scope"], r["owner"], p["principal"],
                    p["type"], ROLE_LABELS.get(p["role"], p["role"]), BY_KEY[p["level"]].label,
                    "oui" if p["discoverable"] else "non",
                    "oui" if p["inherited"] else "non", p["inheritedFrom"] or "",
                    (p["expires"] or "")[:10], r["link"],
                ]))

    with open(paths["json"], "w", encoding="utf-8") as fh:
        json.dump({"meta": meta, "summary": summary, "files": records}, fh,
                  ensure_ascii=False, indent=1)
    return paths
