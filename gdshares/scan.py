"""Parcours de Google Drive : Mon Drive, Drives partagés, et permissions associées."""
from __future__ import annotations

import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from googleapiclient.errors import HttpError

from .auth import ServicePool
from .classify import FOLDER_MIME, Identity, summarize_file

FILE_FIELDS = (
    "nextPageToken, files(id,name,mimeType,driveId,parents,shared,trashed,starred,"
    "webViewLink,createdTime,modifiedTime,size,quotaBytesUsed,hasAugmentedPermissions,"
    "owners(emailAddress,displayName),lastModifyingUser(emailAddress,displayName),"
    "permissions(id,type,role,emailAddress,domain,displayName,allowFileDiscovery,deleted,"
    "expirationTime,pendingOwner,permissionDetails(permissionType,role,inherited,inheritedFrom)))"
)
PERM_FIELDS = (
    "nextPageToken, permissions(id,type,role,emailAddress,domain,displayName,"
    "allowFileDiscovery,deleted,expirationTime,pendingOwner,"
    "permissionDetails(permissionType,role,inherited,inheritedFrom))"
)
SINGLE_FILE_FIELDS = FILE_FIELDS.replace("nextPageToken, files(", "", 1).rstrip()[:-1]
RETRIABLE = {403, 429, 500, 502, 503, 504}


def _execute(request, tries: int = 6):
    """Exécute un appel API avec backoff exponentiel (quotas Drive, coupures réseau)."""
    for attempt in range(tries):
        try:
            return request.execute()
        except OSError:                # socket, TLS, connexion réinitialisée
            if attempt == tries - 1:
                raise
            time.sleep(min(2 ** attempt + random.random(), 32))
        except HttpError as err:
            status = getattr(err.resp, "status", 0)
            if status not in RETRIABLE or attempt == tries - 1:
                raise
            reason = str(err)
            if status == 403 and not any(k in reason for k in
                                         ("rateLimit", "userRateLimit", "quotaExceeded", "sharingRateLimit")):
                raise
            time.sleep(min(2 ** attempt + random.random(), 32))
    return None


class Progress:
    def __init__(self, enabled: bool = True):
        self.enabled = enabled and sys.stderr.isatty()
        self.n = 0

    def tick(self, label: str, inc: int = 1):
        self.n += inc
        if self.enabled:
            sys.stderr.write(f"\r  … {label} : {self.n} éléments   ")
            sys.stderr.flush()

    def done(self, label: str):
        if self.enabled:
            sys.stderr.write(f"\r  ✓ {label} : {self.n} éléments        \n")
        else:
            print(f"  ✓ {label} : {self.n} éléments")
        self.n = 0


class DriveScanner:
    def __init__(self, creds, workers: int = 8, quiet: bool = False):
        self.pool = ServicePool(creds)
        self.workers = workers
        self.progress = Progress(not quiet)
        self.nodes: dict[str, dict] = {}      # id -> {name, parents, driveId} (cache de chemins)
        self.api_calls = 0
        self._lock = threading.Lock()         # hydrate_permissions incrémente depuis plusieurs threads

    def _bump(self) -> None:
        with self._lock:
            self.api_calls += 1

    # ------------------------------------------------------------------ helpers
    @property
    def svc(self):
        return self.pool.svc

    def about(self) -> dict:
        return _execute(self.svc.about().get(fields="user(emailAddress,displayName),storageQuota"))

    def root_id(self) -> str:
        return _execute(self.svc.files().get(fileId="root", fields="id"))["id"]

    def _list_files(self, **kwargs) -> list[dict]:
        out, token = [], None
        while True:
            resp = _execute(self.svc.files().list(
                pageSize=1000, fields=FILE_FIELDS, pageToken=token,
                supportsAllDrives=True, includeItemsFromAllDrives=True, **kwargs))
            self._bump()
            batch = resp.get("files", [])
            out.extend(batch)
            for f in batch:
                self.nodes[f["id"]] = {"name": f.get("name", ""), "parents": f.get("parents") or [],
                                       "driveId": f.get("driveId")}
            self.progress.tick(kwargs.get("_label", "fichiers"), len(batch))
            token = resp.get("nextPageToken")
            if not token:
                return out

    def list_permissions(self, file_id: str) -> list[dict]:
        out, token = [], None
        while True:
            resp = _execute(self.pool.svc.permissions().list(
                fileId=file_id, pageSize=100, fields=PERM_FIELDS, pageToken=token,
                supportsAllDrives=True))
            self._bump()
            out.extend(resp.get("permissions", []))
            token = resp.get("nextPageToken")
            if not token:
                return out

    # ------------------------------------------------------------------- drives
    def list_shared_drives(self) -> list[dict]:
        drives, token = [], None
        try:
            while True:
                resp = _execute(self.svc.drives().list(
                    pageSize=100, pageToken=token,
                    fields="nextPageToken, drives(id,name,createdTime,restrictions,"
                       "capabilities(canManageMembers,canShare,canEdit))"))
                self.api_calls += 1
                drives.extend(resp.get("drives", []))
                token = resp.get("nextPageToken")
                if not token:
                    return drives
        except HttpError:
            return []

    # -------------------------------------------------------------------- files
    def my_drive_files(self) -> list[dict]:
        return self._list_files(q="'me' in owners and trashed = false", corpora="user",
                                spaces="drive", _label="Mon Drive")

    def shared_with_me_files(self) -> list[dict]:
        return self._list_files(q="sharedWithMe and trashed = false", corpora="user",
                                spaces="drive", _label="Partagés avec moi")

    def list_top_folders(self) -> list[dict]:
        """Dossiers de premier niveau de Mon Drive, proposés à la sélection."""
        out, token = [], None
        while True:
            resp = _execute(self.svc.files().list(
                q=f"'root' in parents and mimeType = '{FOLDER_MIME}' and trashed = false",
                pageSize=200, pageToken=token, orderBy="name", corpora="user", spaces="drive",
                fields="nextPageToken, files(id,name)"))
            self._bump()
            out.extend(resp.get("files", []))
            token = resp.get("nextPageToken")
            if not token:
                return out

    def folder_tree_files(self, folder_id: str, label: str) -> list[dict]:
        """Tous les éléments d'un dossier, à tous les niveaux (parcours en largeur)."""
        out, queue, seen = [], [folder_id], set()
        while queue:
            fid = queue.pop(0)
            if fid in seen:
                continue
            seen.add(fid)
            batch = self._list_files(q=f"'{fid}' in parents and trashed = false",
                                     corpora="user", spaces="drive", _label=label)
            out.extend(batch)
            queue.extend(f["id"] for f in batch
                         if f.get("mimeType") == FOLDER_MIME and f["id"] not in seen)
        return out

    def get_files(self, ids: list[str]) -> list[dict]:
        """Éléments précis (les dossiers choisis comptent eux-mêmes dans l'audit)."""
        out = []
        for fid in ids:
            try:
                f = _execute(self.svc.files().get(fileId=fid, fields=SINGLE_FILE_FIELDS,
                                                  supportsAllDrives=True))
                self._bump()
                out.append(f)
            except (HttpError, OSError):
                continue
        return out

    def drive_files(self, drive_id: str, name: str) -> list[dict]:
        return self._list_files(q="trashed = false", corpora="drive", driveId=drive_id,
                                _label=f"Drive « {name} »")

    # ------------------------------------------------------------------- chemins
    def path_of(self, f: dict, root_id: str, drive_names: dict[str, str]) -> str:
        """Chemin lisible « Mon Drive / Dossier / Sous-dossier »."""
        parts, seen = [], set()
        cur = (f.get("parents") or [None])[0]
        while cur and cur not in seen and len(parts) < 25:
            seen.add(cur)
            if cur == root_id:
                parts.append("Mon Drive")
                break
            if cur in drive_names:
                parts.append(drive_names[cur])
                break
            node = self.nodes.get(cur)
            if node is None:
                try:
                    node = _execute(self.svc.files().get(fileId=cur, fields="id,name,parents,driveId",
                                                         supportsAllDrives=True))
                    self._bump()
                    self.nodes[cur] = node = {"name": node.get("name", ""),
                                              "parents": node.get("parents") or [],
                                              "driveId": node.get("driveId")}
                except (HttpError, OSError):
                    parts.append("…")
                    break
            parts.append(node["name"])
            cur = (node["parents"] or [None])[0]
        else:
            if not parts:
                parts.append("Mon Drive" if not f.get("driveId") else drive_names.get(f.get("driveId"), "Drive partagé"))
        return " / ".join(reversed(parts)) or "—"

    # --------------------------------------------------- permissions manquantes
    def hydrate_permissions(self, files: list[dict], drive_perms: dict[str, list[dict]]) -> None:
        """files.list ne renvoie pas les permissions des éléments de Drive partagé.

        Stratégie : si l'élément porte des permissions propres (hasAugmentedPermissions),
        on interroge permissions.list ; sinon il hérite simplement des membres du Drive,
        que l'on injecte tels quels en les marquant « hérité ».
        """
        need = []
        for f in files:
            # L'héritage de Drive partagé est testé EN PREMIER : files.list peut renvoyer
            # une liste vide pour ces éléments, et un test de longueur placé avant les
            # ferait passer pour « Non partagé » sans jamais hériter des membres du Drive.
            if f.get("driveId") and not f.get("hasAugmentedPermissions"):
                inherited = []
                for p in drive_perms.get(f["driveId"], []):
                    q = dict(p)
                    q["permissionDetails"] = [{"inherited": True, "inheritedFrom": f["driveId"],
                                               "permissionType": "member", "role": p.get("role")}]
                    inherited.append(q)
                f["permissions"] = inherited
                continue
            perms = f.get("permissions")
            if perms and len(perms) < 100:
                continue
            if f.get("shared") or f.get("driveId") or perms is None:
                need.append(f)

        if not need:
            return
        total = len(need)
        done = 0

        def work(f):
            try:
                return f, self.list_permissions(f["id"])
            except Exception:   # droit refusé, quota épuisé, réseau : on garde ce qu'on a
                return f, f.get("permissions") or []

        with ThreadPoolExecutor(max_workers=self.workers) as ex:
            for f, perms in ex.map(work, need):
                f["permissions"] = perms
                done += 1
                if self.progress.enabled and done % 10 == 0:
                    import sys as _s
                    _s.stderr.write(f"\r  … permissions détaillées : {done}/{total}   ")
                    _s.stderr.flush()
        if self.progress.enabled:
            import sys as _s
            _s.stderr.write(f"\r  ✓ permissions détaillées : {total}/{total}        \n")


def build_records(files: list[dict], scanner: DriveScanner, me: Identity,
                  root_id: str, drive_names: dict[str, str], scope: str) -> list[dict]:
    """Transforme les fichiers bruts en enregistrements prêts pour le rapport."""
    records = []
    for f in files:
        perms = f.get("permissions") or []
        is_folder = f.get("mimeType") == FOLDER_MIME
        level, score, rows = summarize_file(perms, me, is_folder)
        owners = f.get("owners") or []
        owner = owners[0].get("emailAddress", "") if owners else ""
        # Dans un Drive partagé, les fichiers appartiennent au Drive : `owners` est vide.
        # Le dernier contributeur est alors le seul indice de qui, chez vous, y travaille.
        editor = (f.get("lastModifyingUser") or {}).get("emailAddress", "") or ""
        location = drive_names.get(f.get("driveId")) if f.get("driveId") else "Mon Drive"
        records.append({
            "id": f["id"],
            "name": f.get("name", "(sans nom)"),
            "mime": f.get("mimeType", ""),
            "folder": is_folder,
            "scope": scope if scope != "auto" else ("Drive partagé" if f.get("driveId") else "Mon Drive"),
            "container": location or "Mon Drive",
            "path": scanner.path_of(f, root_id, drive_names),
            "owner": owner,
            "ownerIsMe": me.is_self(owner),
            "lastEditor": editor,
            "lastEditorInternal": bool(editor) and (me.is_self(editor) or me.is_internal(editor)),
            "level": level.key,
            "score": score,
            "modified": (f.get("modifiedTime") or "")[:10],
            "size": int(f.get("size") or f.get("quotaBytesUsed") or 0),
            "link": f.get("webViewLink", ""),
            "perms": rows,
        })
    return records
