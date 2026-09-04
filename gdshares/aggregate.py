"""Agrégations macro à partir des enregistrements de fichiers."""
from __future__ import annotations

from collections import defaultdict

from .classify import (BY_KEY, DRIVE_ROLE_LABELS, LEVELS, ROLE_LABELS, ROLE_RANK,
                        Identity, email_domain, my_role)

EXPOSED_RANK = 15          # à partir de « partagé en interne »
PARTNER_RANK = 38          # partenaire référencé : externe, mais approuvé
EXTERNAL_RANK = 40         # externe ou pire
PUBLIC_RANK = 50           # lien public ou pire


FOREIGN = "Drive externe"


def build_summary(records: list[dict], me: Identity, drives: list[dict],
                  drive_perms: dict[str, list[dict]], scope_label: str) -> dict:
    lv = lambda r: BY_KEY[r["level"]]

    # Les Drives appartenant à une autre organisation ne sont pas votre exposition :
    # leurs éléments restent consultables dans le détail, mais ne comptent ni dans les
    # indicateurs ni dans la répartition, qu'ils fausseraient massivement.
    foreign_records = [r for r in records if r["scope"] == FOREIGN]
    records = [r for r in records if r["scope"] != FOREIGN]

    exposure = {l.key: {"key": l.key, "label": l.label, "short": l.short, "icon": l.icon,
                        "status": l.status, "hint": l.hint, "rank": l.rank,
                        "mydrive": 0, "shared": 0, "swm": 0, "total": 0} for l in LEVELS}
    roles = defaultdict(int)
    ext_domains: dict[str, dict] = defaultdict(
        lambda: {"files": set(), "accounts": set(), "write": 0, "approved": False})
    ext_accounts: dict[str, dict] = defaultdict(
        lambda: {"files": set(), "role": "", "level": "private", "write": 0, "approved": False})
    per_drive: dict[str, dict] = defaultdict(lambda: {"files": 0, "exposed": 0, "external": 0,
                                                      "public": 0, "own_perms": 0})
    folders_exposed = []
    totals = {"files": 0, "folders": 0, "mydrive": 0, "shared": 0, "swm": 0,
              "foreign": len(foreign_records), "bytes_exposed": 0}

    for r in records:
        level = lv(r)
        totals["files"] += 1
        totals["folders"] += 1 if r["folder"] else 0
        # « Partagé avec moi » a son propre compteur : le mélanger à Mon Drive fausserait les KPI
        bucket = {"Drive partagé": "shared", "Mon Drive": "mydrive"}.get(r["scope"], "swm")
        totals[bucket] += 1
        e = exposure[level.key]
        e[bucket] += 1
        e["total"] += 1

        if r["scope"] == "Drive partagé":
            d = per_drive[r["container"]]
            d["files"] += 1
            d["exposed"] += 1 if level.rank >= EXPOSED_RANK else 0
            d["external"] += 1 if level.rank >= EXTERNAL_RANK else 0
            d["public"] += 1 if level.rank >= PUBLIC_RANK else 0
            d["own_perms"] += 1 if any(not p["inherited"] for p in r["perms"]) else 0

        if level.rank >= EXPOSED_RANK:
            totals["bytes_exposed"] += r["size"]
        if r["folder"] and level.rank >= EXTERNAL_RANK:
            folders_exposed.append(r)

        seen_roles = set()
        for p in r["perms"]:
            key = (p["role"], p["principal"])
            if key not in seen_roles:
                roles[p["role"]] += 1
                seen_roles.add(key)
            prank = BY_KEY[p["level"]].rank
            approved = p["level"] == "partner"
            if prank >= PARTNER_RANK and p["type"] in ("user", "group"):
                email = p["principal"].lower()
                dom = email_domain(email) or "(sans domaine)"
                ext_domains[dom]["files"].add(r["id"])
                ext_domains[dom]["accounts"].add(email)
                ext_domains[dom]["approved"] = approved
                a = ext_accounts[email]
                a["approved"] = approved
                a["files"].add(r["id"])
                if ROLE_RANK.get(p["role"], 0) > ROLE_RANK.get(a["role"], 0):
                    a["role"] = p["role"]
                if prank > BY_KEY[a["level"]].rank:
                    a["level"] = p["level"]
                if p["role"] in ("writer", "fileOrganizer", "organizer", "owner"):
                    a["write"] += 1
                    ext_domains[dom]["write"] += 1
            elif prank >= PARTNER_RANK and p["type"] == "domain":
                dom = p["principal"].lstrip("@").lower()
                ext_domains[dom]["approved"] = approved
                ext_domains[dom]["files"].add(r["id"])

    drive_rows = []
    drive_by_name = {d["name"]: d for d in drives}
    for name, stats in sorted(per_drive.items(), key=lambda kv: -kv[1]["external"]):
        did = drive_by_name.get(name, {}).get("id")
        members = drive_perms.get(did, []) if did else []
        ext_members = [p for p in members
                       if p.get("type") in ("user", "group") and not me.is_internal(p.get("emailAddress"))
                       and not me.is_self(p.get("emailAddress"))]
        managers = [p for p in members if p.get("role") in ("organizer", "fileOrganizer")]
        restrictions = drive_by_name.get(name, {}).get("restrictions", {}) or {}
        caps = drive_by_name.get(name, {}).get("capabilities", {}) or {}
        role = my_role(members, me)
        drive_rows.append({
            "name": name, "id": did, **stats,
            # sans le rôle de gestionnaire, vous ne pouvez pas agir sur ces partages :
            # la remédiation passe par les gestionnaires nommés
            "manageable": bool(caps.get("canManageMembers")),
            "myRole": DRIVE_ROLE_LABELS.get(role, "") if role else "",
            "managerList": [p.get("emailAddress", "?") for p in members
                            if p.get("role") == "organizer"][:10],
            "members": len(members), "extMembers": len(ext_members),
            "managers": len(managers),
            "extMemberList": [p.get("emailAddress", "?") for p in ext_members][:25],
            "restrictExternal": bool(restrictions.get("domainUsersOnly")),
            "restrictSharing": bool(restrictions.get("driveMembersOnly")),
        })

    foreign_by_drive: dict[str, dict] = defaultdict(
        lambda: {"files": 0, "external": 0, "public": 0, "internalEdits": 0,
                 "contributors": defaultdict(int)})
    for r in foreign_records:
        f = foreign_by_drive[r["container"]]
        f["files"] += 1
        rank = lv(r).rank
        f["external"] += 1 if rank >= EXTERNAL_RANK else 0
        f["public"] += 1 if rank >= PUBLIC_RANK else 0
        # Ce que vos collaborateurs déposent dans un Drive tiers sort de votre patrimoine :
        # le fichier appartient au Drive, donc à l'organisation propriétaire.
        if r.get("lastEditorInternal"):
            f["internalEdits"] += 1
            f["contributors"][r["lastEditor"].lower()] += 1
    foreign_rows = []
    for name, stats in sorted(foreign_by_drive.items(), key=lambda kv: -kv[1]["files"]):
        did = drive_by_name.get(name, {}).get("id")
        members = drive_perms.get(did, []) if did else []
        managers = [p.get("emailAddress", "?") for p in members if p.get("role") == "organizer"]
        contribs = sorted(stats.pop("contributors").items(), key=lambda kv: -kv[1])
        foreign_rows.append({"name": name, "id": did, **stats, "members": len(members),
                             "managers": managers[:10],
                             "contributors": [{"email": e, "files": n} for e, n in contribs[:10]]})

    exposed = sum(v["total"] for k, v in exposure.items() if BY_KEY[k].rank >= EXPOSED_RANK)
    external = sum(v["total"] for k, v in exposure.items() if BY_KEY[k].rank >= EXTERNAL_RANK)
    public = sum(v["total"] for k, v in exposure.items() if BY_KEY[k].rank >= PUBLIC_RANK)
    org = sum(v["total"] for k, v in exposure.items() if 25 <= BY_KEY[k].rank <= 30)

    kpis = [
        {"label": "Éléments analysés", "value": totals["files"] + totals["foreign"],
         "sub": f"{totals['mydrive']} dans Mon Drive · {totals['shared']} dans les Drives partagés"
                + (f" · {totals['swm']} partagés avec moi" if totals["swm"] else "")
                + (f" · {totals['foreign']} dans des Drives d'autres organisations, "
                   f"hors statistiques" if totals["foreign"] else "")},
        {"label": "Éléments partagés", "value": exposed, "status": "good" if not exposed else "",
         "sub": f"{pct(exposed, totals['files'])} de vos {totals['files']} éléments"},
        {"label": "Partagés hors organisation", "value": external,
         "status": "serious" if external else "good",
         "sub": f"{len(ext_accounts)} comptes · {len(ext_domains)} domaines"},
        {"label": "Accessibles par lien public", "value": public,
         "status": "critical" if public else "good",
         "sub": "Aucune authentification requise" if public else "Aucun lien public"},
        {"label": "Ouverts à toute l'organisation", "value": org,
         "status": "warning" if org else "good",
         "sub": "Visibles par tout le domaine" if org else "Aucun partage domaine"},
        {"label": "Vers des partenaires référencés", "value": exposure["partner"]["total"],
         "status": "good",
         "sub": f"{len(me.partners)} domaines en liste blanche"} if me.partners else None,
        # cohérent avec « hors organisation » : un partenaire référencé n'est pas un signal
        {"label": "Droits d'écriture externes",
         "value": sum(a["write"] for a in ext_accounts.values() if not a["approved"]),
         "status": "serious" if any(a["write"] for a in ext_accounts.values()
                                    if not a["approved"]) else "good",
         "sub": "Permissions en modification hors organisation"
                + (", partenaires référencés exclus" if me.partners else "")},
    ]

    return {
        "totals": totals,
        "kpis": [k for k in kpis if k],
        "partnerDomains": sorted(me.partners),
        "exposure": [exposure[l.key] for l in LEVELS],
        "roles": [{"role": k, "label": ROLE_LABELS.get(k, k), "count": v}
                  for k, v in sorted(roles.items(), key=lambda kv: -kv[1])],
        "extDomains": [{"domain": d, "files": len(v["files"]), "accounts": len(v["accounts"]),
                        "write": v["write"], "approved": v["approved"]}
                       for d, v in sorted(ext_domains.items(), key=lambda kv: -len(kv[1]["files"]))][:15],
        "extAccounts": [{"email": e, "files": len(v["files"]), "role": ROLE_LABELS.get(v["role"], v["role"]),
                         "level": v["level"], "write": v["write"], "approved": v["approved"]}
                        for e, v in sorted(ext_accounts.items(), key=lambda kv: -len(kv[1]["files"]))][:30],
        "drives": drive_rows,
        "foreignDrives": foreign_rows,
        "foreignCount": len(foreign_records),
        "foreignInternalEdits": sum(f["internalEdits"] for f in foreign_rows),
        "topFolders": [{"name": f["name"], "path": f["path"], "level": f["level"],
                        "score": f["score"], "link": f["link"],
                        "grantees": len(f["perms"])}
                       for f in sorted(folders_exposed, key=lambda x: -x["score"])[:15]],
        "scopeLabel": scope_label,
    }


def pct(part: int, whole: int) -> str:
    return f"{(100.0 * part / whole):.1f} %".replace(".", ",") if whole else "0 %"
