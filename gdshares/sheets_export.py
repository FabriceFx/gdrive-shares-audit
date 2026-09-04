"""Export direct du rapport vers un classeur Google Sheets (option --to-sheets).

Trois feuilles : Synthèse, Éléments, Permissions. Les valeurs sont écrites en RAW,
donc aucune cellule n'est interprétée comme une formule — un nom de fichier
commençant par « = » reste du texte.
"""
from __future__ import annotations

from .classify import BY_KEY

ITEM_HEADERS = ["Élément", "Type", "Chemin", "Périmètre", "Exposition", "Score",
                "Bénéficiaires", "Rôles", "Propriétaire", "Dernier contributeur",
                "Contributeur interne", "Modifié", "Taille (o)", "Lien"]
PERM_HEADERS = ["Élément", "Chemin", "Périmètre", "Bénéficiaire", "Type", "Rôle",
                "Exposition", "Trouvable en recherche", "Origine", "Expiration", "Lien"]
CHUNK = 2000


def _summary_rows(meta: dict, summary: dict, n_records: int) -> list[list]:
    rows: list[list] = [
        ["Audit des partages Google Drive"], [],
        ["Compte", meta["user"]], ["Généré le", meta["generated"]],
        ["Version", meta.get("version", "n/d")],
        ["Périmètre", meta["scopeLabel"]], ["Éléments analysés", n_records], [],
        ["Indicateurs", "Valeur", "Précision"],
    ]
    rows += [[k["label"], k["value"], k["sub"]] for k in summary["kpis"]]
    rows += [[], ["Niveau d'exposition", "Éléments", "Mon Drive", "Drives partagés", "Description"]]
    rows += [[f"{e['icon']} {e['label']}", e["total"], e["mydrive"], e["shared"], e["hint"]]
             for e in summary["exposure"]]
    if summary["extDomains"]:
        rows += [[], ["Domaine externe", "Éléments", "Comptes", "Droits en modification"]]
        rows += [[f"@{d['domain']}", d["files"], d["accounts"], d["write"]] for d in summary["extDomains"]]
    if summary["extAccounts"]:
        rows += [[], ["Compte externe", "Éléments", "Droit le plus élevé", "Dont en modification"]]
        rows += [[a["email"], a["files"], a["role"], a["write"]] for a in summary["extAccounts"]]
    if summary["drives"]:
        rows += [[], ["Drive partagé", "Éléments", "Membres", "Membres externes",
                      "Éléments hors organisation", "Dont lien public"]]
        rows += [[d["name"], d["files"], d["members"], d["extMembers"], d["external"], d["public"]]
                 for d in summary["drives"]]
    return rows


def _item_rows(records: list[dict]) -> list[list]:
    return [[
        r["name"], "Dossier" if r["folder"] else (r["mime"] or "").rsplit(".", 1)[-1],
        r["path"], r["container"], BY_KEY[r["level"]].label, r["score"],
        " | ".join(p["principal"] for p in r["perms"]),
        " | ".join(dict.fromkeys(p["roleLabel"] for p in r["perms"])),
        r["owner"], r.get("lastEditor", ""), "oui" if r.get("lastEditorInternal") else "non",
        r["modified"], r["size"], r["link"],
    ] for r in records]


def _perm_rows(records: list[dict]) -> list[list]:
    return [[
        r["name"], r["path"], r["container"], p["principal"], p["type"], p["roleLabel"],
        BY_KEY[p["level"]].label, "oui" if p["discoverable"] else "non",
        "hérité" if p["inherited"] else "partage direct",
        (p["expires"] or "")[:10], r["link"],
    ] for r in records for p in r["perms"]]


def export(creds, meta: dict, summary: dict, records: list[dict]) -> str:
    """Crée le classeur et renvoie son URL."""
    from googleapiclient.discovery import build

    svc = build("sheets", "v4", credentials=creds, cache_discovery=False)
    title = f"Audit des partages Drive — {meta['generated'].replace('/', '-').replace(':', '-')}"
    book = svc.spreadsheets().create(body={
        "properties": {"title": title, "locale": "fr_FR"},
        "sheets": [{"properties": {"title": t}} for t in ("Synthèse", "Éléments", "Permissions")],
    }, fields="spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title))").execute()
    book_id = book["spreadsheetId"]
    sheet_ids = {s["properties"]["title"]: s["properties"]["sheetId"] for s in book["sheets"]}

    def write(sheet: str, start: int, rows: list[list]) -> int:
        for i in range(0, len(rows), CHUNK):
            part = rows[i:i + CHUNK]
            svc.spreadsheets().values().update(
                spreadsheetId=book_id, range=f"'{sheet}'!A{start + i}",
                valueInputOption="RAW", body={"values": part}).execute()
        return start + len(rows)

    write("Synthèse", 1, _summary_rows(meta, summary, len(records)))
    write("Éléments", 1, [ITEM_HEADERS] + _item_rows(records))
    write("Permissions", 1, [PERM_HEADERS] + _perm_rows(records))

    reqs = []
    for name, cols in (("Éléments", len(ITEM_HEADERS)), ("Permissions", len(PERM_HEADERS))):
        sid = sheet_ids[name]
        reqs += [
            {"repeatCell": {
                "range": {"sheetId": sid, "startRowIndex": 0, "endRowIndex": 1},
                "cell": {"userEnteredFormat": {
                    "textFormat": {"bold": True},
                    "backgroundColorStyle": {"rgbColor": {"red": .94, "green": .94, "blue": .92}}}},
                "fields": "userEnteredFormat(textFormat,backgroundColorStyle)"}},
            {"updateSheetProperties": {
                "properties": {"sheetId": sid, "gridProperties": {"frozenRowCount": 1}},
                "fields": "gridProperties.frozenRowCount"}},
            {"setBasicFilter": {"filter": {"range": {"sheetId": sid}}}},
            {"autoResizeDimensions": {"dimensions": {
                "sheetId": sid, "dimension": "COLUMNS", "startIndex": 0, "endIndex": cols}}},
        ]
    reqs.append({"repeatCell": {
        "range": {"sheetId": sheet_ids["Synthèse"], "startRowIndex": 0, "endRowIndex": 1},
        "cell": {"userEnteredFormat": {"textFormat": {"bold": True, "fontSize": 13}}},
        "fields": "userEnteredFormat.textFormat"}})
    reqs.append({"autoResizeDimensions": {"dimensions": {
        "sheetId": sheet_ids["Synthèse"], "dimension": "COLUMNS", "startIndex": 0, "endIndex": 6}}})
    svc.spreadsheets().batchUpdate(spreadsheetId=book_id, body={"requests": reqs}).execute()

    return book.get("spreadsheetUrl", f"https://docs.google.com/spreadsheets/d/{book_id}")
