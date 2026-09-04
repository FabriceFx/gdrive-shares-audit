"""Jeu de données de démonstration : permet de voir le rapport sans connecter de compte."""
from __future__ import annotations

import random

from .classify import Identity, drive_ownership, summarize_file

FOLDER = "application/vnd.google-apps.folder"
DOC = "application/vnd.google-apps.document"
SHEET = "application/vnd.google-apps.spreadsheet"
PDF = "application/pdf"

FOLDERS_MY = ["Contrats", "RH", "Factures 2026", "Photos", "Projets/Refonte site", "Notes"]
FOLDERS_SD = ["Appels d'offres", "Marketing", "Livrables client", "Archives"]
NAMES = ["Budget prévisionnel", "Compte rendu", "Contrat cadre", "Plan de charge", "Roadmap",
         "Bulletin de paie", "Devis", "Cahier des charges", "Support de présentation",
         "Liste des contacts", "Politique de sécurité", "Facture", "Note de frais", "Audit"]
EXT_DOMAINS = ["client-alpha.com", "agence-beta.fr", "partenaire-gamma.eu", "gmail.com", "freelance-delta.io"]
# Deux domaines internes : le principal et un domaine secondaire déclaré dans la console
INT_USERS = ["marie.durand@exemple-corp.fr", "paul.martin@exemple-corp.fr",
             "sophie.leroy@exemple-corp.fr", "ahmed.benali@exemple-group.com",
             "clara.nguyen@exemple-group.com"]


def _perm(t, role, **kw):
    return {"id": str(random.random()), "type": t, "role": role, **kw}


def build(seed: int = 7) -> tuple[list[dict], Identity, list[dict], dict[str, list[dict]]]:
    rnd = random.Random(seed)
    me = Identity(email="vous@exemple-corp.fr", domain="exemple-corp.fr",
                  consumer=False, aliases={"vous@exemple-corp.fr"},
                  domains={"exemple-group.com"},   # domaine secondaire de l'organisation
                  partners={"agence-beta.fr"})     # liste blanche : prestataire approuvé
    # Direction : vous êtes gestionnaire · Commerce : simple contributeur · Alpha : Drive du client
    caps = [True, False, True, False]
    drives = [{"id": f"d{i}", "name": n, "restrictions": {"domainUsersOnly": i == 2},
               "capabilities": {"canManageMembers": caps[i], "canShare": True}}
              for i, n in enumerate(["Direction", "Commerce", "Projet Phoenix",
                                     "Alpha — projet commun"])]
    drive_perms = {
        "d0": [_perm("user", "organizer", emailAddress="vous@exemple-corp.fr"),
               _perm("user", "writer", emailAddress="marie.durand@exemple-corp.fr"),
               _perm("group", "reader", emailAddress="comex@exemple-corp.fr")],
        "d1": [_perm("user", "organizer", emailAddress="paul.martin@exemple-corp.fr"),
               _perm("user", "writer", emailAddress="vous@exemple-corp.fr"),
               _perm("user", "writer", emailAddress="contact@agence-beta.fr"),
               _perm("group", "reader", emailAddress="commerce@exemple-corp.fr")],
        "d2": [_perm("user", "organizer", emailAddress="vous@exemple-corp.fr"),
               _perm("user", "fileOrganizer", emailAddress="chef.projet@client-alpha.com"),
               _perm("user", "reader", emailAddress="sophie.leroy@exemple-corp.fr")],
        # Drive appartenant au client : aucun gestionnaire chez nous, nous y sommes invités
        "d3": [_perm("user", "organizer", emailAddress="dg@client-alpha.com"),
               _perm("user", "organizer", emailAddress="chef.projet@client-alpha.com"),
               _perm("user", "writer", emailAddress="vous@exemple-corp.fr")],
    }

    records = []

    EXT_EDITORS = ["dg@client-alpha.com", "chef.projet@client-alpha.com"]

    def add(name, mime, scope, container, path, perms, owner="vous@exemple-corp.fr"):
        is_folder = mime == FOLDER
        level, score, rows = summarize_file(perms, me, is_folder)
        # dans un Drive tiers, une partie des contenus est déposée par vos collaborateurs
        editor = (rnd.choice(INT_USERS) if scope != "Drive externe" or rnd.random() < .4
                  else rnd.choice(EXT_EDITORS))
        records.append({
            "id": f"id{len(records):04d}", "name": name, "mime": mime, "folder": is_folder,
            "scope": scope, "container": container, "path": path, "owner": owner,
            "ownerIsMe": me.is_self(owner), "level": level.key, "score": score,
            "lastEditor": editor, "lastEditorInternal": me.is_internal(editor),
            "modified": f"202{rnd.randint(4, 6)}-{rnd.randint(1, 12):02d}-{rnd.randint(1, 28):02d}",
            "size": rnd.randint(2_000, 40_000_000),
            "link": "https://drive.google.com/file/d/demo/view", "perms": rows,
        })

    def rand_perms(kind):
        base = [_perm("user", "owner", emailAddress="vous@exemple-corp.fr")]
        if kind == "private":
            return base
        if kind == "internal":
            return base + [_perm("user", rnd.choice(["reader", "commenter", "writer"]),
                                 emailAddress=u)
                           for u in rnd.sample(INT_USERS, rnd.randint(1, 3))]
        if kind == "domain":
            return base + [_perm("domain", "reader", domain="exemple-corp.fr",
                                 allowFileDiscovery=rnd.random() < .4)]
        if kind == "external":
            return base + [_perm("user", rnd.choice(["reader", "reader", "commenter", "writer"]),
                                 emailAddress=f"contact{rnd.randint(1, 3)}@{rnd.choice(EXT_DOMAINS)}")
                           for _ in range(rnd.randint(1, 3))]
        if kind == "ext_domain":
            return base + [_perm("domain", "reader", domain=rnd.choice(EXT_DOMAINS))]
        if kind == "link":
            return base + [_perm("anyone", rnd.choice(["reader", "reader", "writer"]),
                                 allowFileDiscovery=False)]
        return base + [_perm("anyone", "reader", allowFileDiscovery=True)]

    mix = (["private"] * 46 + ["internal"] * 22 + ["domain"] * 9 + ["external"] * 13 +
           ["link"] * 5 + ["ext_domain"] * 2 + ["public"] * 2)
    for i in range(150):
        kind = rnd.choice(mix)
        folder = rnd.random() < .12
        path = "Mon Drive / " + rnd.choice(FOLDERS_MY)
        name = rnd.choice(FOLDERS_MY) if folder else f"{rnd.choice(NAMES)} {rnd.randint(1, 99)}"
        add(name, FOLDER if folder else rnd.choice([DOC, SHEET, PDF]),
            "Mon Drive", "Mon Drive", path, rand_perms(kind))

    scope_of = {d["id"]: ("Drive externe"
                          if drive_ownership(drive_perms[d["id"]], me) == "external"
                          else "Drive partagé") for d in drives}
    for d in drives:
        for i in range(rnd.randint(25, 45)):
            kind = rnd.choice(["inherited"] * 12 + ["internal"] * 4 + ["external"] * 3 + ["link"])
            folder = rnd.random() < .1
            perms = list(drive_perms[d["id"]])
            for p in perms:
                p.setdefault("permissionDetails", [{"inherited": True, "inheritedFrom": d["id"],
                                                    "permissionType": "member", "role": p["role"]}])
            if kind != "inherited":
                perms = perms + [p for p in rand_perms(kind) if p["role"] != "owner"]
            add(rnd.choice(FOLDERS_SD) if folder else f"{rnd.choice(NAMES)} {rnd.randint(1, 99)}",
                FOLDER if folder else rnd.choice([DOC, SHEET, PDF]),
                scope_of[d["id"]], d["name"], f"{d['name']} / {rnd.choice(FOLDERS_SD)}",
                perms, owner="")
    return records, me, drives, drive_perms
