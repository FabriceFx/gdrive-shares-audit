"""Audit des partages Google Drive (Mon Drive + Drives partagés)."""
import pathlib

VERSION_FILE = pathlib.Path(__file__).resolve().parent.parent / "VERSION"


def read_version() -> str:
    """Numéro de licence / de livraison, tenu dans le fichier VERSION à la racine.

    Une seule valeur à modifier à chaque livraison : le CLI, le rapport HTML, les
    exports et la version Apps Script la reprennent tous d'ici.
    """
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip().splitlines()[0].strip()
    except (OSError, IndexError):
        return "n/d"


__version__ = read_version()
