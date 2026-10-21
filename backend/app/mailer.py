"""Mensajes: render de plantillas, bandeja de salida y entrega con Gmail API (borrador o envío)."""
import base64
import os
import re
from datetime import date, datetime, timedelta
from email.message import EmailMessage

import httpx
from sqlalchemy.orm import Session

from .models import Config, GoogleAccount, Log, Member, Message, Team, Template

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
SCOPES = "openid email profile https://www.googleapis.com/auth/gmail.compose"

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
    """Crea el mensaje en la bandeja y lo entrega según MODO_ENVIO.

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

    if prueba or cfg(db, "MODO_PRUEBA", True):
        operacion = cfg(db, "CORREOS_OPERACION", []) or []
        cuenta = cfg(db, "CUENTA_ENVIO", "")
        destino = operacion or ([cuenta] if cuenta else [])
        asunto = f"[PRUEBA → {para or '(sin destinatario)'}] {asunto}"
        # En modo prueba nunca se usa el destinatario real, ni siquiera si falta a quién mandar la prueba.
        para, cc, prueba = (", ".join(destino) or "(falta capturar los correos del equipo operativo)"), [], True

    msg = Message(ts=datetime.now(), plantilla=clave, team_id=team.id if team else None, para=para or "",
                  cc=", ".join(cc), asunto=asunto, cuerpo=cuerpo, prueba=prueba)
    db.add(msg)
    db.flush()
    log(db, "Correo", f"«{tpl.nombre}» para {msg.para}", team)

    modo = cfg(db, "MODO_ENVIO", "bandeja")
    if modo in ("borrador", "enviar") and sender_account(db):
        deliver(db, msg, "enviar" if modo == "enviar" else "borrador")
    return msg


# ---------- Google OAuth + Gmail ----------

def sender_account(db: Session) -> GoogleAccount | None:
    email = cfg(db, "CUENTA_ENVIO", "")
    acc = db.get(GoogleAccount, email) if email else None
    return acc if acc and acc.gmail and acc.refresh_token else None


def access_token(db: Session, acc: GoogleAccount) -> str:
    if acc.access_token and acc.expira and acc.expira > datetime.now() + timedelta(seconds=60):
        return acc.access_token
    r = httpx.post(GOOGLE_TOKEN, data={
        "client_id": os.environ["GOOGLE_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
        "refresh_token": acc.refresh_token,
        "grant_type": "refresh_token",
    }, timeout=20)
    r.raise_for_status()
    data = r.json()
    acc.access_token = data["access_token"]
    acc.expira = datetime.now() + timedelta(seconds=int(data.get("expires_in", 3600)))
    return acc.access_token


def raw_mime(msg: Message, sender: str) -> str:
    mail = EmailMessage()
    una_linea = lambda t: re.sub(r"[\r\n]+", " ", t or "").strip()  # un salto de línea en un nombre o asunto inyectaría encabezados
    mail["From"] = una_linea(sender)
    mail["To"] = una_linea(msg.para)
    if msg.cc:
        mail["Cc"] = una_linea(msg.cc)
    mail["Subject"] = una_linea(msg.asunto)
    mail.set_content(msg.cuerpo)
    return base64.urlsafe_b64encode(mail.as_bytes()).decode()


def deliver(db: Session, msg: Message, modo: str) -> Message:
    """modo: 'borrador' crea un borrador en Gmail; 'enviar' lo envía (o envía el borrador existente)."""
    if msg.estado == "Enviado" or (modo == "borrador" and msg.estado == "Borrador" and msg.gmail_id):
        return msg  # reintentar no debe mandar dos veces ni duplicar el borrador
    acc = sender_account(db)
    if acc is None:
        msg.error = "Conecta una cuenta de Google con permiso de Gmail en Configuración."
        return msg
    try:
        headers = {"Authorization": f"Bearer {access_token(db, acc)}"}
        raw = {"raw": raw_mime(msg, acc.email)}
        if modo == "borrador":
            r = httpx.post(f"{GMAIL}/drafts", headers=headers, json={"message": raw}, timeout=30)
            r.raise_for_status()
            msg.gmail_id, msg.estado = r.json()["id"], "Borrador"
        elif msg.estado == "Borrador" and msg.gmail_id:
            r = httpx.post(f"{GMAIL}/drafts/send", headers=headers, json={"id": msg.gmail_id}, timeout=30)
            r.raise_for_status()
            msg.gmail_id, msg.estado = r.json().get("id", ""), "Enviado"
        else:
            r = httpx.post(f"{GMAIL}/messages/send", headers=headers, json=raw, timeout=30)
            r.raise_for_status()
            msg.gmail_id, msg.estado = r.json().get("id", ""), "Enviado"
        msg.error = ""
    except httpx.HTTPStatusError as exc:
        msg.estado, msg.error = "Error", f"Gmail respondió {exc.response.status_code}: {exc.response.text[:300]}"
    except Exception as exc:  # red caída, token revocado, etc.
        msg.estado, msg.error = "Error", str(exc)[:380]
    return msg
