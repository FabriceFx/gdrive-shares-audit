"""Authentification Google Drive.

Deux modes :
  * OAuth utilisateur (par défaut) : chaque utilisateur consent lui-même, en lecture seule.
  * Compte de service avec délégation domaine (--sa-key / --impersonate) : un admin
    peut auditer un utilisateur donné sans son mot de passe.
"""
from __future__ import annotations

import os
import threading

from googleapiclient.discovery import build

# Deux portées possibles, toutes deux en LECTURE SEULE (aucune écriture, aucune
# modification de partage n'est possible avec l'une ou l'autre) :
#
#   SCOPES_FULL     drive.readonly          — imposé par l'API Drive pour énumérer les Drives
#                                             partagés : drives.list n'accepte que `drive` ou
#                                             `drive.readonly`. Cette portée donne le droit de
#                                             lire le contenu ; l'outil ne l'exerce jamais, il
#                                             ne demande que des champs de métadonnées.
#   SCOPES_METADATA drive.metadata.readonly — strictement métadonnées et permissions, mais les
#                                             Drives partagés deviennent inénumérables : l'audit
#                                             se limite alors à Mon Drive.
SCOPES_FULL = ["https://www.googleapis.com/auth/drive.readonly"]
SCOPES_METADATA = ["https://www.googleapis.com/auth/drive.metadata.readonly"]
# Ajoutée uniquement avec --to-sheets : donne accès aux SEULS fichiers créés par
# l'outil (le classeur d'export), à rien d'autre dans le Drive.
SCOPES_SHEETS = ["https://www.googleapis.com/auth/drive.file"]
SCOPES = SCOPES_FULL

MISSING_SECRETS = """\
Fichier d'identifiants OAuth introuvable : {path}

À faire une seule fois (console.cloud.google.com) :
  1. Créer / choisir un projet, puis activer « Google Drive API ».
  2. Écran de consentement OAuth : type « Interne » (Workspace) ou « Externe » + vous
     comme testeur, scope .../auth/drive.readonly (ou .../auth/drive.metadata.readonly
     si vous n'auditez que Mon Drive).
  3. Identifiants > Créer > ID client OAuth > Application de bureau.
  4. Télécharger le JSON et l'enregistrer sous : {path}
"""


def get_credentials(client_secrets: str, token_path: str,
                    sa_key: str | None = None, impersonate: str | None = None,
                    scopes: list[str] | None = None):
    """Renvoie des credentials Google valides (rafraîchies ou nouvellement obtenues)."""
    scopes = scopes or SCOPES
    if sa_key:
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_file(sa_key, scopes=scopes)
        if impersonate:
            creds = creds.with_subject(impersonate)
        return creds

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    creds = None
    if os.path.exists(token_path):
        try:
            creds = Credentials.from_authorized_user_file(token_path, scopes)
        except ValueError:
            creds = None

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    else:
        if not os.path.exists(client_secrets):
            raise SystemExit(MISSING_SECRETS.format(path=client_secrets))
        flow = InstalledAppFlow.from_client_secrets_file(client_secrets, scopes)
        creds = flow.run_local_server(port=0, prompt="consent",
                                      authorization_prompt_message="Ouverture du navigateur pour autoriser l'accès en lecture seule…")

    os.makedirs(os.path.dirname(os.path.abspath(token_path)) or ".", exist_ok=True)
    # descripteur ouvert directement en 0600 : pas de fenêtre où le jeton serait lisible
    fd = os.open(token_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with open(fd, "w", encoding="utf-8") as fh:
        fh.write(creds.to_json())
    return creds


class ServicePool:
    """Un client Drive par thread : httplib2 n'est pas thread-safe."""

    def __init__(self, creds):
        self._creds = creds
        self._local = threading.local()

    @property
    def svc(self):
        svc = getattr(self._local, "svc", None)
        if svc is None:
            svc = build("drive", "v3", credentials=self._creds, cache_discovery=False)
            self._local.svc = svc
        return svc
