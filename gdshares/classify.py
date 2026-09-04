"""Classification des partages : niveau d'exposition, rôle, score de risque."""
from __future__ import annotations

from dataclasses import dataclass, field

CONSUMER_DOMAINS = {"gmail.com", "googlemail.com"}

# --- Niveaux d'exposition, du plus ouvert au plus fermé -----------------------
# `status` suit la palette d'état (critical / serious / warning / good) ; l'icône
# et le libellé accompagnent toujours la couleur, jamais la couleur seule.


@dataclass(frozen=True)
class Level:
    key: str
    rank: int          # plus grand = plus exposé
    label: str
    short: str
    icon: str
    status: str
    hint: str


LEVELS = [
    Level("public_indexed", 60, "Public sur le web (indexable)", "Public web", "🌐", "critical",
          "Accessible à tout internaute, et référençable par les moteurs de recherche."),
    Level("public_link", 50, "Public : toute personne disposant du lien", "Lien public", "🔗", "critical",
          "Accessible sans authentification à quiconque possède l'URL."),
    Level("external_domain", 45, "Ouvert à un domaine externe entier", "Domaine externe", "🏢", "serious",
          "Tous les comptes d'une autre organisation y ont accès."),
    Level("external_user", 40, "Partagé hors de l'organisation", "Externe", "👤", "serious",
          "Des comptes extérieurs à votre organisation sont destinataires."),
    Level("partner", 38, "Partagé avec un partenaire référencé", "Partenaire", "🤝", "warning",
          "Destinataire hors organisation, mais figurant dans votre liste de domaines partenaires approuvés."),
    Level("domain_indexed", 30, "Toute l'organisation (trouvable en recherche)", "Org. trouvable", "🏛️", "warning",
          "Tout collaborateur du domaine peut le trouver et l'ouvrir."),
    Level("domain_link", 25, "Toute l'organisation via le lien", "Org. lien", "🏛️", "warning",
          "Tout collaborateur du domaine disposant du lien peut l'ouvrir."),
    Level("internal", 15, "Partagé en interne (personnes nommées)", "Interne", "👥", "good",
          "Partage nominatif avec des membres de l'organisation."),
    Level("private", 0, "Non partagé", "Privé", "🔒", "neutral",
          "Vous seul (et le cas échéant les membres du Drive partagé) y avez accès."),
]
BY_KEY = {lv.key: lv for lv in LEVELS}
PRIVATE = BY_KEY["private"]

ROLE_LABELS = {
    "owner": "Propriétaire",
    "organizer": "Gestionnaire",
    "fileOrganizer": "Gestionnaire de contenu",
    "writer": "Éditeur",
    "commenter": "Commentateur",
    "reader": "Lecteur",
}
# Google nomme les rôles différemment selon le contexte : « Éditeur » sur un fichier,
# « Contributeur » sur un Drive partagé. On respecte le vocabulaire vu par l'utilisateur.
DRIVE_ROLE_LABELS = {
    "organizer": "Gestionnaire",
    "fileOrganizer": "Gestionnaire de contenu",
    "writer": "Contributeur",
    "commenter": "Commentateur",
    "reader": "Lecteur",
}
ROLE_RANK = {"reader": 1, "commenter": 2, "writer": 3, "fileOrganizer": 4, "organizer": 5, "owner": 6}
WRITE_ROLES = {"writer", "fileOrganizer", "organizer", "owner"}

FOLDER_MIME = "application/vnd.google-apps.folder"


def _norm_domain(domain: str | None) -> str:
    """« @Marque.EU » et « marque.eu » désignent le même domaine."""
    return (domain or "").strip().lstrip("@").strip().lower()


def email_domain(email: str | None) -> str:
    return (email or "").rsplit("@", 1)[-1].lower() if email and "@" in email else ""


@dataclass
class Identity:
    """Qui suis-je, et qu'est-ce qui compte comme « interne » pour moi."""
    email: str
    domain: str = ""
    consumer: bool = False
    aliases: set[str] = field(default_factory=set)
    # Domaine principal + domaines secondaires et alias déclarés dans la console
    # d'administration : une collègue à @autre-domaine.fr n'est pas une externe.
    domains: set[str] = field(default_factory=set)
    # Liste blanche : domaines extérieurs dont l'accès est approuvé (clients, prestataires,
    # filiales hors périmètre). Ils restent externes, mais cessent d'être des signaux.
    partners: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        self.domains = {n for n in (_norm_domain(d) for d in self.domains) if n}
        if self.domain:
            self.domains.add(self.domain)
        # un domaine interne ne peut pas être « partenaire » : l'interne l'emporte
        self.partners = {n for n in (_norm_domain(d) for d in self.partners)
                         if n and n not in self.domains}

    @classmethod
    def from_about(cls, about: dict, extra_domains: list[str] | None = None,
                   partner_domains: list[str] | None = None) -> "Identity":
        email = (about.get("user", {}) or {}).get("emailAddress", "") or ""
        dom = email_domain(email)
        consumer = dom in CONSUMER_DOMAINS or not dom
        return cls(email=email.lower(), domain="" if consumer else dom,
                   consumer=consumer, aliases={email.lower()},
                   domains=set(extra_domains or []), partners=set(partner_domains or []))

    def is_self(self, email: str | None) -> bool:
        return bool(email) and email.lower() in self.aliases

    def is_internal_domain(self, domain: str | None) -> bool:
        return bool(domain) and _norm_domain(domain) in self.domains

    def is_partner_domain(self, domain: str | None) -> bool:
        return bool(domain) and _norm_domain(domain) in self.partners

    def is_partner(self, email: str | None) -> bool:
        return bool(email) and self.is_partner_domain(email_domain(email))

    def is_internal(self, email: str | None) -> bool:
        """Compte personnel : seul moi suis « interne ».

        Workspace : le domaine principal ET tous les domaines secondaires déclarés.
        """
        if not email:
            return False
        if self.consumer:
            return self.is_self(email)
        return self.is_internal_domain(email_domain(email))


def drive_ownership(members: list[dict], me: Identity) -> str:
    """À qui appartient ce Drive partagé : « internal », « external » ou « unknown ».

    Un Drive dont aucun gestionnaire n'est chez vous appartient à une autre
    organisation : vous y êtes invité, ce n'est pas votre exposition.

    Une preuve positive est exigée pour conclure « externe », car ce verdict sort le
    Drive des statistiques : en cas de doute (membres illisibles, aucun gestionnaire
    visible), on renvoie « unknown » et le Drive reste compté comme le vôtre.
    """
    if not members:
        return "unknown"
    organizers = [m for m in members if m.get("role") == "organizer"]
    if not organizers:
        return "unknown"
    if any(me.is_self(m.get("emailAddress")) or me.is_internal(m.get("emailAddress"))
           for m in organizers):
        return "internal"
    return "external"


def my_role(members: list[dict], me: Identity) -> str:
    """Mon rôle dans ce Drive partagé, tel qu'il figure dans ses membres.

    Renvoie "" si mon accès passe par un groupe : la capacité déclarée par l'API
    (canManageMembers) fait alors autorité.
    """
    for m in members:
        if m.get("type") == "user" and me.is_self(m.get("emailAddress")):
            return m.get("role", "")
    return ""


def classify_permission(perm: dict, me: Identity) -> Level:
    """Niveau d'exposition apporté par UNE permission."""
    ptype = perm.get("type")
    if ptype == "anyone":
        return BY_KEY["public_indexed"] if perm.get("allowFileDiscovery") else BY_KEY["public_link"]
    if ptype == "domain":
        dom = (perm.get("domain") or "").lower()
        if not me.consumer and me.is_internal_domain(dom):
            return BY_KEY["domain_indexed"] if perm.get("allowFileDiscovery") else BY_KEY["domain_link"]
        return BY_KEY["partner"] if me.is_partner_domain(dom) else BY_KEY["external_domain"]
    # user / group
    email = perm.get("emailAddress")
    if me.is_self(email):
        return PRIVATE
    if me.is_internal(email):
        return BY_KEY["internal"]
    return BY_KEY["partner"] if me.is_partner(email) else BY_KEY["external_user"]


def is_grant(perm: dict, me: Identity) -> bool:
    """Une permission qui accorde un accès à quelqu'un d'autre que moi."""
    if perm.get("deleted"):
        return False
    if perm.get("type") in ("user", "group") and me.is_self(perm.get("emailAddress")):
        return False
    return True


def principal_of(perm: dict) -> str:
    ptype = perm.get("type")
    if ptype == "anyone":
        return "Tout internaute"
    if ptype == "domain":
        return f"@{perm.get('domain', '?')}"
    return perm.get("emailAddress") or perm.get("displayName") or "(inconnu)"


def risk_score(level: Level, perms: list[dict], is_folder: bool, me: Identity) -> int:
    """Score 0-100 : exposition de base, aggravée par les droits d'écriture et le volume."""
    base = {"public_indexed": 95, "public_link": 85, "external_domain": 72,
            "external_user": 60, "partner": 38, "domain_indexed": 42, "domain_link": 36,
            "internal": 18, "private": 0}[level.key]
    if base == 0:
        return 0
    score = base
    grants = [p for p in perms if is_grant(p, me)]
    if any(p.get("role") in WRITE_ROLES for p in grants if classify_permission(p, me).rank >= 40):
        score += 8          # écriture accordée à l'extérieur
    elif any(p.get("role") in WRITE_ROLES for p in grants):
        score += 4
    ext = sum(1 for p in grants if classify_permission(p, me).rank >= 40)
    score += min(ext, 5)
    if is_folder:
        score += 6          # un dossier propage son partage à tout son contenu
    # le lien public lui-même doit être sans expiration — pas un autre destinataire
    if any(p.get("type") == "anyone" and not p.get("expirationTime") for p in grants):
        score += 2
    return max(0, min(100, score))


def summarize_file(perms: list[dict], me: Identity, is_folder: bool) -> tuple[Level, int, list[dict]]:
    """Niveau maximal, score, et permissions normalisées (hors moi-même)."""
    grants = [p for p in perms if is_grant(p, me)]
    rows = []
    top = PRIVATE
    for p in grants:
        lv = classify_permission(p, me)
        if lv.rank > top.rank:
            top = lv
        details = (p.get("permissionDetails") or [{}])[0]
        rows.append({
            "principal": principal_of(p),
            "type": p.get("type"),
            "role": p.get("role"),
            "roleLabel": ROLE_LABELS.get(p.get("role"), p.get("role") or "?"),
            "level": lv.key,
            "discoverable": bool(p.get("allowFileDiscovery")),
            "inherited": bool(details.get("inherited")),
            "inheritedFrom": details.get("inheritedFrom"),
            "expires": p.get("expirationTime"),
            "pendingOwner": bool(p.get("pendingOwner")),
        })
    rows.sort(key=lambda r: (-BY_KEY[r["level"]].rank, -ROLE_RANK.get(r["role"], 0), r["principal"]))
    return top, risk_score(top, perms, is_folder, me), rows
