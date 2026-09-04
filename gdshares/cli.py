"""Point d'entrée : audit des partages Google Drive, en lecture seule."""
from __future__ import annotations

import argparse
import datetime as dt
import os
import subprocess
import sys
import time

from . import __version__
from .aggregate import build_summary, pct
from .classify import (BY_KEY, DRIVE_ROLE_LABELS, LEVELS, Identity, drive_ownership,
                       my_role)

SCOPE_LABELS = {"all": "Mon Drive + Drives partagés", "mydrive": "Mon Drive uniquement",
                "shared": "Drives partagés uniquement"}


def parse_domains(value: str | None) -> list[str]:
    """Accepte « a.fr,b.com » ou un chemin de fichier (un domaine par ligne, # en commentaire).

    Une organisation peut avoir des dizaines de domaines : les passer en ligne de
    commande devient vite impraticable.
    """
    if not value:
        return []
    path = os.path.expanduser(value)
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            items = [line.split("#", 1)[0] for line in fh]
    else:
        items = value.split(",")
    return [d.strip() for d in items if d.strip()]


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        prog="audit_drive",
        description="Vue macroscopique puis détaillée de tous vos partages Google Drive "
                    "(Mon Drive et Drives partagés), avec le niveau de partage et le droit associé.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Exemples :\n"
               "  python3 audit_drive.py --demo            # rapport de démonstration, sans compte\n"
               "  python3 audit_drive.py                   # audit de votre compte (OAuth navigateur)\n"
               "  python3 audit_drive.py --scope shared    # seulement les Drives partagés\n"
               "  python3 audit_drive.py --list-targets    # voir les dossiers et Drives disponibles\n"
               "  python3 audit_drive.py --folders 'Contrats,RH' --drives Direction\n"
               "  python3 audit_drive.py --sa-key sa.json --impersonate agent@societe.fr\n")
    p.add_argument("--scope", choices=["all", "mydrive", "shared"], default="all",
                   help="périmètre analysé (défaut : all)")
    p.add_argument("--include-shared-with-me", action="store_true",
                   help="inclure aussi les éléments que d'autres partagent avec vous")
    p.add_argument("--folders", metavar="A,B",
                   help="n'analyser que ces dossiers de Mon Drive (noms ou identifiants, "
                        "séparés par des virgules) ; sous-dossiers inclus")
    p.add_argument("--drives", metavar="A,B",
                   help="n'analyser que ces Drives partagés (noms ou identifiants) ; "
                        "« none » pour n'en analyser aucun")
    p.add_argument("--include-unmanaged", action="store_true",
                   help="analyser aussi les Drives partagés dont vous n'êtes pas gestionnaire "
                        "(par défaut ignorés : vous ne pouvez pas y modifier les partages)")
    p.add_argument("--list-targets", action="store_true",
                   help="lister les dossiers de Mon Drive et les Drives partagés, puis quitter")
    p.add_argument("--max-files", type=int, default=0,
                   help="limiter le nombre d'éléments analysés (0 = pas de limite)")
    p.add_argument("--out", default="rapports", help="dossier de sortie (défaut : ./rapports)")
    p.add_argument("--credentials", default="credentials.json", help="ID client OAuth (application de bureau)")
    p.add_argument("--token", default="token.json", help="cache du jeton utilisateur")
    p.add_argument("--sa-key", help="clé JSON d'un compte de service (délégation domaine)")
    p.add_argument("--impersonate", help="utilisateur à auditer avec --sa-key")
    p.add_argument("--internal-domains", metavar="A,B|FICHIER",
                   help="domaines secondaires et alias de votre organisation (console "
                        "d'administration > Compte > Domaines) : liste séparée par des "
                        "virgules, ou chemin d'un fichier à raison d'un domaine par ligne "
                        "(voir domaines-internes.txt)")
    p.add_argument("--partner-domains", metavar="A,B|FICHIER",
                   help="liste blanche : domaines extérieurs approuvés (clients, prestataires). "
                        "Leurs accès restent externes mais sont classés « Partenaire référencé » "
                        "et sortent de l'indicateur « hors organisation ». Liste ou fichier "
                        "(voir domaines-partenaires.txt)")
    p.add_argument("--metadata-only", action="store_true",
                   help="portée minimale drive.metadata.readonly : aucun droit de lecture du "
                        "contenu, mais les Drives partagés ne sont pas énumérables (Mon Drive seul)")
    p.add_argument("--workers", type=int, default=8, help="appels permissions en parallèle (défaut : 8)")
    p.add_argument("--to-sheets", action="store_true",
                   help="créer aussi un classeur Google Sheets (Synthèse, Éléments, Permissions) "
                        "dans votre Drive ; ajoute la portée drive.file, limitée aux fichiers "
                        "créés par l'outil")
    p.add_argument("--open", dest="open_report", action="store_true", help="ouvrir le rapport à la fin")
    p.add_argument("--demo", action="store_true", help="générer un rapport sur des données fictives")
    p.add_argument("--quiet", action="store_true", help="pas de barre de progression")
    return p.parse_args(argv)


def collect(args) -> tuple[list[dict], Identity, list[dict], dict, dict]:
    """Renvoie (records, identité, drives, drive_perms, meta partielle)."""
    if args.demo:
        from .demo import build
        records, me, drives, drive_perms = build()
        return records, me, drives, drive_perms, {"apiCalls": 0, "partial": False,
                                                  "scopeLabel": SCOPE_LABELS[args.scope]}

    try:
        from googleapiclient.errors import HttpError

        from .auth import get_credentials
        from .scan import DriveScanner, build_records
    except ModuleNotFoundError as exc:
        raise SystemExit(
            f"Dépendance manquante ({exc.name}). Installez-les d'abord :\n"
            "    python3 -m venv .venv && source .venv/bin/activate\n"
            "    pip install -r requirements.txt\n"
            "(ou lancez « python3 audit_drive.py --demo » pour voir le rapport sans compte)") from None

    from .auth import SCOPES_FULL, SCOPES_METADATA, SCOPES_SHEETS
    scopes = list(SCOPES_METADATA if args.metadata_only else SCOPES_FULL)
    suffix = "-metadata" if args.metadata_only else ""
    if args.to_sheets:
        scopes += SCOPES_SHEETS
        suffix += "-sheets"
    token_path = args.token
    if suffix and token_path == "token.json":
        token_path = f"token{suffix}.json"     # un jeton par jeu de portées
    creds = get_credentials(args.credentials, token_path, args.sa_key, args.impersonate, scopes)
    sc = DriveScanner(creds, workers=args.workers, quiet=args.quiet)
    me = Identity.from_about(sc.about(), parse_domains(args.internal_domains),
                             parse_domains(args.partner_domains))
    doms = sorted(me.domains)
    if me.consumer:
        print(f"Compte audité : {me.email}  (compte personnel : tout tiers est externe)")
    elif len(doms) > 4:
        print(f"Compte audité : {me.email}  ({len(doms)} domaines internes : "
              f"{', '.join(doms[:3])}, …)")
    else:
        print(f"Compte audité : {me.email}  (domaines internes : "
              f"{', '.join('@' + d for d in doms)})")
    if me.partners:
        print(f"  Liste blanche : {len(me.partners)} domaine(s) partenaire(s) approuvé(s)")
    if not me.consumer and len(me.domains) == 1:
        print("  ⓘ Un seul domaine interne connu. Si votre organisation a des domaines "
              "secondaires,\n    ajoutez-les avec --internal-domains, sinon vos collègues "
              "y seront comptés externes.")

    root_id = sc.root_id()

    if args.list_targets:
        print("\nDossiers de premier niveau de Mon Drive :")
        for f in sc.list_top_folders():
            print(f"  {f['name']:<40} {f['id']}")
        print("\nDrives partagés accessibles :")
        for d in sc.list_shared_drives():
            print(f"  {d['name']:<40} {d['id']}")
        print("\nUtilisez --folders et/ou --drives avec ces noms ou identifiants.")
        raise SystemExit(0)

    drives, drive_perms = [], {}
    wanted_drives = None
    if args.drives is not None:
        wanted = {w.strip().lower() for w in args.drives.split(",") if w.strip()}
        wanted_drives = set() if wanted <= {"none", "aucun"} else wanted

    if args.metadata_only and args.scope in ("all", "shared"):
        print("  ⚠︎ --metadata-only : l'API Drive exige drive.readonly pour drives.list,\n"
              "    les Drives partagés sont donc ignorés. Retirez l'option pour les inclure.")
    elif args.scope in ("all", "shared"):
        drives = sc.list_shared_drives()
        if wanted_drives is not None:
            drives = [d for d in drives
                      if d["name"].lower() in wanted_drives or d["id"].lower() in wanted_drives]
            missing = wanted_drives - {d["name"].lower() for d in drives} - {d["id"].lower() for d in drives}
            if missing:
                print(f"  ⚠︎ Drive(s) partagé(s) introuvable(s) : {', '.join(sorted(missing))}")
        for d in drives:
            try:
                drive_perms[d["id"]] = sc.list_permissions(d["id"])
            except HttpError:
                drive_perms[d["id"]] = []
    drive_names = {d["id"]: d["name"] for d in drives}

    raw: list[tuple[list[dict], str]] = []
    selected_folders: list[dict] = []
    if args.folders and args.scope in ("all", "mydrive"):
        wanted = {w.strip().lower() for w in args.folders.split(",") if w.strip()}
        available = sc.list_top_folders()
        selected_folders = [f for f in available
                            if f["name"].lower() in wanted or f["id"].lower() in wanted]
        missing = wanted - {f["name"].lower() for f in selected_folders} - {f["id"].lower() for f in selected_folders}
        if missing:
            print(f"  ⚠︎ Dossier(s) introuvable(s) : {', '.join(sorted(missing))}")
        if not selected_folders:
            raise SystemExit("Aucun dossier ne correspond à --folders. "
                             "Utilisez --list-targets pour voir les noms disponibles.")
        # les dossiers choisis comptent eux-mêmes comme éléments analysés
        files = sc.get_files([f["id"] for f in selected_folders])
        for f in selected_folders:
            print(f"Analyse du dossier « {f['name']} » (sous-dossiers inclus)…")
            files.extend(sc.folder_tree_files(f["id"], f"Dossier « {f['name']} »"))
            sc.progress.done(f"Dossier « {f['name']} »")
        raw.append((files, "Mon Drive"))
    elif args.scope in ("all", "mydrive"):
        print("Analyse de Mon Drive…")
        raw.append((sc.my_drive_files(), "Mon Drive"))
        sc.progress.done("Mon Drive")
    skipped = []
    if not args.include_unmanaged:
        keep = []
        for d in drives:
            if (d.get("capabilities") or {}).get("canManageMembers"):
                keep.append(d)
            else:
                skipped.append(d)
        drives = keep
    if skipped:
        print("  ⓘ Drives ignorés : vous n'y êtes pas gestionnaire, vous ne pouvez pas y "
              "modifier les partages (--include-unmanaged pour les inclure) :")
        for d in skipped:
            role = DRIVE_ROLE_LABELS.get(my_role(drive_perms.get(d["id"], []), me), "accès indirect")
            managers = [p.get("emailAddress", "?") for p in drive_perms.get(d["id"], [])
                        if p.get("role") == "organizer"]
            print(f"    {d['name']:<30} votre rôle : {role:<24} "
                  f"gestionnaire(s) : {', '.join(managers[:2]) or 'non lisibles'}")

    for d in drives:
        owner = drive_ownership(drive_perms.get(d["id"], []), me)
        foreign = owner == "external"
        print(f"Analyse du Drive partagé « {d['name']} »…" +
              ("  (appartient à une autre organisation : hors statistiques)" if foreign else ""))
        raw.append((sc.drive_files(d["id"], d["name"]),
                    "Drive externe" if foreign else "Drive partagé"))
        sc.progress.done(f"Drive « {d['name']} »")
    if args.include_shared_with_me:
        print("Analyse des éléments partagés avec vous…")
        raw.append((sc.shared_with_me_files(), "Partagé avec moi"))
        sc.progress.done("Partagés avec moi")

    partial = False
    if args.max_files:
        budget, capped = args.max_files, []
        for files, scope in raw:
            capped.append((files[:budget], scope))
            budget -= min(budget, len(files))
            partial = partial or budget <= 0
        raw = capped

    all_files = [f for files, _ in raw for f in files]
    print(f"Récupération des permissions ({len(all_files)} éléments)…")
    sc.hydrate_permissions(all_files, drive_perms)

    records, seen = [], set()
    for files, scope in raw:
        recs = build_records(files, sc, me, root_id, drive_names, scope)
        if scope == "Partagé avec moi":
            for r in recs:
                r["container"] = "Partagé avec moi"
        for r in recs:   # un élément atteint par deux chemins ne compte qu'une fois
            if r["id"] not in seen:
                seen.add(r["id"])
                records.append(r)

    label_parts = []
    if selected_folders:
        label_parts.append(f"{len(selected_folders)} dossier(s) de Mon Drive")
    elif args.scope in ("all", "mydrive"):
        label_parts.append("tout Mon Drive")
    if drives:
        label_parts.append(f"{len(drives)} Drive(s) partagé(s)")
    if args.include_shared_with_me:
        label_parts.append("partagés avec moi")

    return records, me, drives, drive_perms, {
        "apiCalls": sc.api_calls, "partial": partial, "_creds": creds,
        "scopeLabel": " + ".join(label_parts) or SCOPE_LABELS[args.scope]}


def print_macro(summary: dict, me: Identity) -> None:
    t = summary["totals"]
    print("\n" + "─" * 68)
    print(f"VUE MACRO — {t['files']} éléments  ({t['mydrive']} Mon Drive · "
          f"{t['shared']} Drives partagés)" +
          (f"\n  + {t['foreign']} éléments dans des Drives d'autres organisations, "
           f"hors statistiques" if t.get("foreign") else ""))
    print("─" * 68)
    width = max(len(l.short) for l in LEVELS)
    for row in summary["exposure"]:
        bar = "█" * round(28 * row["total"] / max(1, t["files"]))
        print(f"  {row['icon']} {row['short']:<{width}}  {row['total']:>5}  "
              f"{pct(row['total'], t['files']):>7}  {bar}")
    if summary["extDomains"]:
        print("\n  Domaines externes destinataires :")
        for d in summary["extDomains"][:8]:
            print(f"    @{d['domain']:<28} {d['files']:>4} élément(s), {d['accounts']} compte(s)")
    if summary["foreignDrives"]:
        print("\n  Drives d'autres organisations (vous y êtes invité) :")
        for d in summary["foreignDrives"]:
            print(f"    {d['name']:<28} {d['files']:>4} élém. · gestionnaires : "
                  f"{', '.join(d['managers'][:2]) or 'non lisibles'}")
    if summary["drives"]:
        print("\n  Drives partagés :")
        for d in summary["drives"]:
            print(f"    {d['name']:<28} {d['files']:>4} élém. · {d['members']} membres "
                  f"({d['extMembers']} externes) · {d['external']} élém. hors org.")
    print("─" * 68)


def main(argv=None) -> int:
    args = parse_args(argv)
    started = time.time()

    records, me, drives, drive_perms, extra = collect(args)
    summary = build_summary(records, me, drives, drive_perms, SCOPE_LABELS[args.scope])

    stamp = dt.datetime.now()
    outdir = os.path.join(args.out, stamp.strftime("audit-%Y%m%d-%H%M%S") + ("-demo" if args.demo else ""))
    meta = {
        "version": __version__,
        "user": me.email, "domain": me.domain, "consumer": me.consumer,
        "domains": sorted(me.domains),
        "generated": stamp.strftime("%d/%m/%Y à %H:%M"),
        "scopeLabel": extra.pop("scopeLabel", SCOPE_LABELS[args.scope])
                      + (" — DONNÉES DE DÉMONSTRATION" if args.demo else ""),
        "duration": f"{time.time() - started:.0f} s", **extra,
    }
    creds = meta.pop("_creds", None)

    from .export import write_all
    from .report import render
    paths = write_all(outdir, records, summary, meta)
    html = render(outdir, records, summary, meta)

    print_macro(summary, me)
    sheets_url = None
    if args.to_sheets:
        if args.demo:
            print("\n  ⚠︎ --to-sheets est ignoré en mode --demo (aucun compte connecté).")
        else:
            print("\nCréation du classeur Google Sheets…")
            try:
                from .sheets_export import export as export_sheets
                sheets_url = export_sheets(creds, meta, summary, records)
            except Exception as err:                      # API désactivée, quota, droits
                print(f"  ⚠︎ Export Sheets impossible : {err}\n"
                      "    Vérifiez que « Google Sheets API » est activée dans votre projet Cloud.")

    print(f"\nRapport HTML   : {html}")
    print(f"Détail fichiers: {paths['files_csv']}")
    print(f"Détail droits  : {paths['perms_csv']}")
    print(f"Données brutes : {paths['json']}")

    if sheets_url:
        print(f"Google Sheets  : {sheets_url}")

    if args.open_report:
        opener = {"darwin": "open", "win32": "start"}.get(sys.platform, "xdg-open")
        subprocess.run([opener, html], check=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
