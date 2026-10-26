"""Mensajes: render de plantillas y bandeja de salida. El envío es manual: el panel abre cada borrador en el Outlook del equipo."""
import os
import re
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Config, Log, Member, Message, Team, Template

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"
SCOPES = "openid email profile"

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def fecha_larga(d: date | None) -> str:
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}" if d else "—"


def google_configured() -> bool:
    return bool(os.environ.get("GOOGLE_CLIENT_ID") and os.environ.get("GOOGLE_CLIENT_SECRET"))


def cfg(db: Session, clave: str, default=None):
    row = db.get(Config, clave)
    return default if row is None or row.valor is None else row.valor


def set_cfg(db: Session, clave: str, valor) -> None:
    row = db.get(Config, clave)
    if row is None:
        db.add(Config(clave=clave, valor=valor))
    else:
        row.valor = valor


def log(db: Session, tipo: str, detalle: str, team: Team | None = None, actor: str = "Sistema") -> None:
    db.add(Log(ts=datetime.now(), tipo=tipo, team_id=team.id if team else None, detalle=detalle, actor=actor))


def links(db: Session) -> dict:
    base = str(cfg(db, "PUBLIC_URL", "http://localhost:5180")).rstrip("/")
    return {
        "solicitud": f"{base}/f/solicitud",
        "cambios": f"{base}/f/cambios",
        "checkin": f"{base}/f/checkin?k={cfg(db, 'QR_TOKEN', '')}",
    }


def render(text: str, variables: dict) -> str:
    return re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda m: m.group(0) if m.group(1) not in variables else "" if variables[m.group(1)] is None else str(variables[m.group(1)]), text)


def base_vars(db: Session, team: Team | None, member: Member | None) -> dict:
    urls = links(db)
    variables = {
        "coworking": cfg(db, "NOMBRE", "Coworking GDL"),
        "semestre": cfg(db, "SEMESTRE", ""),
        "dias_minimos": cfg(db, "DIAS_MINIMOS", 3),
        "semanas_upgrade": cfg(db, "SEMANAS_UPGRADE", 2),
        "dias_decision": cfg(db, "DIAS_HABILES_DECISION", 10),
        "total_espacios": 33,
        "link_reglamento": cfg(db, "LINK_REGLAMENTO", "") or "(pendiente de publicar)",
        "link_solicitud": urls["solicitud"],
        "link_formulario_cambios": urls["cambios"],
    }
    if team:
        variables.update(
            equipo=team.nombre,
            folio=team.folio,
            lider=team.lider_nombre.split(" ")[0],
            link_formulario_cambios=f"{urls['cambios']}?folio={team.folio}",
            espacio=team.space.numero if team.space else "—",
        )
    if member:
        variables["nombre"] = member.nombre.split(" ")[0]
    return variables


def queue_message(db: Session, clave: str, team: Team | None = None, member: Member | None = None,
                  extra: dict | None = None, para: str | None = None, prueba: bool = False, texto: dict | None = None) -> Message:
    """Crea el mensaje en la bandeja.

    Al líder con copia a los integrantes activos; los avisos personales van a la persona con copia al líder.
    """
    # texto: {nombre, asunto, cuerpo} para un correo que no sale de una plantilla guardada (p. ej. un formulario propio).
    tpl = Template(clave=clave, numero=0, **texto) if texto else db.get(Template, clave)
    variables = base_vars(db, team, member)
    variables.update(extra or {})
    asunto = render(tpl.asunto, variables)
    cuerpo = render(tpl.cuerpo, variables)

    cc: list[str] = []
    if para is None:
        if member is not None:
            para = member.correo
            if team and team.lider_correo != member.correo:
                cc = [team.lider_correo]
        elif team is not None:
            para = team.lider_correo
            cc = [m.correo for m in team.members if m.activo and m.correo != team.lider_correo]

    if prueba:  # «Enviarme una prueba»: va solo a quien la pidió, marcada en el asunto
        asunto, cc = f"[PRUEBA] {asunto}", []

    msg = Message(ts=datetime.now(), plantilla=clave, team_id=team.id if team else None, para=para or "",
                  cc=", ".join(cc), asunto=asunto, cuerpo=cuerpo, prueba=prueba)
    db.add(msg)
    db.flush()
    log(db, "Correo", f"«{tpl.nombre}» para {msg.para}", team)

    return msg


def reparar_mensajes_de_prueba(db: Session) -> int:
    """Devuelve a su destinatario real los mensajes sin enviar que se crearon en el antiguo «modo prueba».

    Ese modo cambiaba el «Para» al equipo operativo y dejaba al destinatario real solo en el asunto («[PRUEBA → correo] …»).
    El «Con copia» se recalcula igual que en queue_message: al líder con los integrantes activos; a un integrante, con el líder.
    """
    n = 0
    for m in db.scalars(select(Message).where(Message.estado.in_(["Bandeja", "Error", "Borrador"]), Message.asunto.like("[PRUEBA →%"))):
        hallado = re.match(r"\[PRUEBA → (.+?)\] (.*)$", m.asunto, re.S)
        if not hallado or hallado.group(1).startswith("("):  # «(sin destinatario)»: no hay a quién devolverlo
            continue
        para, m.asunto = hallado.group(1).strip(), hallado.group(2)
        cc: list[str] = []
        team = m.team
        if team is not None:
            if para.lower() == (team.lider_correo or "").lower():
                cc = [x.correo for x in team.members if x.activo and x.correo and x.correo.lower() != para.lower()]
            elif any(x.correo and x.correo.lower() == para.lower() for x in team.members):
                cc = [team.lider_correo] if team.lider_correo else []
        m.para, m.cc, m.prueba = para, ", ".join(cc), False
        n += 1
    return n
