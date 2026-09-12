#!/usr/bin/env python3
"""Assemble apps-script/Index.html à partir du gabarit commun.

Le tableau de bord (CSS + rendu) est partagé entre la version Python et la version
Apps Script : il vit dans gdshares/template.html. Ce script y ajoute l'écran de
balayage et le code d'amorçage propres à Apps Script.

    python3 build_apps_script.py
"""
from __future__ import annotations

import datetime
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
TEMPLATE = ROOT / "gdshares" / "template.html"
BOOTSTRAP = ROOT / "apps-script" / "parts" / "bootstrap.html"
OUT = ROOT / "apps-script" / "Index.html"

PAYLOAD_TAG = '<script id="payload" type="application/json">__DATA__</script>\n'
CODE_GS = ROOT / "apps-script" / "Code.gs"
DOMAIN_FILES = {"INTERNAL_DOMAINS": ROOT / "domaines-internes.txt",
                "PARTNER_DOMAINS": ROOT / "domaines-partenaires.txt"}


def read_domains(path: pathlib.Path) -> list[str]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        d = line.split("#", 1)[0].strip().lstrip("@").strip().lower()
        if d and d not in out:
            out.append(d)
    return out


def sync_version() -> str:
    """Reporte le numéro de version dans Code.gs, avec l'horodatage du build.

    La version vient de VERSION (modifiée à la main à chaque livraison) ; l'empreinte de
    build est automatique, pour que le pied de page change même si le numéro n'a pas bougé.
    """
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip().splitlines()[0].strip()
    build = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    code = CODE_GS.read_text(encoding="utf-8")
    for name, value in (("APP_VERSION", version), ("APP_BUILD", build)):
        # Tolérant en lecture (const ou var), toujours const en écriture : une copie
        # ancienne de Code.gs se construit encore, et le code produit reste en ES6+.
        code, n = re.subn(rf"(?:const|var) {name} = '[^']*';", f"const {name} = '{value}';", code, count=1)
        assert n == 1, f"constante {name} introuvable dans Code.gs"
    CODE_GS.write_text(code, encoding="utf-8")
    print(f"  version : {version} (build {build})")
    return version


def sync_domains() -> None:
    """Réinjecte les listes de domaines dans Code.gs depuis leurs fichiers de référence.

    Éviter la recopie manuelle : les fichiers .txt font foi, la constante en est générée.
    """
    code = CODE_GS.read_text(encoding="utf-8")
    lists = {name: read_domains(path) for name, path in DOMAIN_FILES.items()}

    both = set(lists["INTERNAL_DOMAINS"]) & set(lists["PARTNER_DOMAINS"])
    if both:
        print(f"  ⚠︎ domaine(s) à la fois interne et partenaire, traité(s) comme internes : "
              f"{', '.join(sorted(both))}")
    guest = [d for d in lists["INTERNAL_DOMAINS"] if d.endswith(".guest.google")]
    if guest:
        raise SystemExit(f"Refus : {guest} sont des domaines d'identités invitées ; "
                         "les compter comme internes masquerait des accès externes.")

    for name, domains in lists.items():
        block = f"const {name} = [\n" + "".join(f"  '{d}',\n" for d in domains) + "];"
        code, n = re.subn(rf"(?:const|var) {name} = \[\n(?:.*?\n)*?\];", block, code, count=1)
        assert n == 1, f"constante {name} introuvable dans Code.gs"
        print(f"  {name} : {len(domains)} domaine(s)")
    CODE_GS.write_text(code, encoding="utf-8")


def main() -> None:
    sync_version()
    sync_domains()
    html = TEMPLATE.read_text(encoding="utf-8")
    boot = BOOTSTRAP.read_text(encoding="utf-8")

    assert PAYLOAD_TAG in html, "balise payload introuvable dans le gabarit"
    html = html.replace(PAYLOAD_TAG, "")          # aucune donnée embarquée : elle vient du scan
    # Pas de <base target="_top"> : il ferait sortir les ancres de navigation de
    # l'iframe Apps Script. Les liens sortants portent déjà leur propre target="_blank".
    html = html.replace("</body>", boot.rstrip() + "\n</body>")
    html = ("<!-- FICHIER GÉNÉRÉ — ne pas éditer directement.\n"
            "     Source : gdshares/template.html + apps-script/parts/bootstrap.html\n"
            "     Régénérer avec : python3 build_apps_script.py -->\n") + html
    OUT.write_text(html, encoding="utf-8")
    print(f"écrit : {OUT}  ({len(html.splitlines())} lignes)")


if __name__ == "__main__":
    main()
