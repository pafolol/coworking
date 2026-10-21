"""Envíos a grupos: a quién (filtro de personas), envío masivo, envíos programados y exportación a Excel."""
import calendar
import io
from datetime import date, datetime, timedelta

from openpyxl import Workbook
from openpyxl.styles import Font
from sqlalchemy import select
from sqlalchemy.orm import Session

from .mailer import log, queue_message
from .models import EN_OPERACION, Automation, Member, Team, Template

INTERNOS = ("Alumno", "Colaborador", "Exatec")  # comunidad Tec
FRECUENCIAS = ("una_vez", "diaria", "semanal", "mensual")


def normalize_filter(f: dict | None) -> dict:
    """Filtro de destinatarios.

    modo: 'segmento' (todos los que cumplan tipo/rol/estado), 'equipos' (los integrantes de esos equipos)
    o 'personas' (exactamente esas personas). tipo: todos | internos | externos.
    """
    f = f if isinstance(f, dict) else {}
    ints = lambda v: [int(x) for x in v if isinstance(x, (int, str)) and str(x).isdigit()] if isinstance(v, list) else []
    strs = lambda v: [x for x in v if isinstance(x, str)] if isinstance(v, list) else []
    return {
        "modo": f.get("modo") if f.get("modo") in ("segmento", "equipos", "personas") else "segmento",
        "tipo": f.get("tipo") if f.get("tipo") in ("todos", "internos", "externos") else "todos",
        "roles": strs(f.get("roles")) or ["Líder", "Integrante"],
        "estados": strs(f.get("estados")) if "estados" in f else list(EN_OPERACION),
        "equipos": ints(f.get("equipos")),
        "personas": ints(f.get("personas")),
    }


def recipients(db: Session, filtro: dict | None) -> list[Member]:
    """Integrantes activos que cumplen el filtro, uno por correo."""
    f = normalize_filter(filtro)
    q = select(Member).join(Team).where(Member.activo.is_(True)).order_by(Team.nombre, Member.rol, Member.nombre)
    if f["modo"] == "personas":
        q = q.where(Member.id.in_(f["personas"] or [-1]))
    else:
        if f["modo"] == "equipos":
            q = q.where(Team.id.in_(f["equipos"] or [-1]))
        elif f["estados"]:
            q = q.where(Team.estado.in_(f["estados"]))
        if f["tipo"] == "internos":
            q = q.where(Member.tipo.in_(INTERNOS))
        elif f["tipo"] == "externos":
            q = q.where(Member.tipo.not_in(INTERNOS))
        q = q.where(Member.rol.in_(f["roles"]))
    vistos, out = set(), []
    for m in db.scalars(q):
        correo = (m.correo or "").strip().lower()
        if correo and correo not in vistos:
            vistos.add(correo)
            out.append(m)
    return out


def describe(db: Session, filtro: dict | None) -> str:
    f = normalize_filter(filtro)
    if f["modo"] == "personas":
        return f"{len(f['personas'])} persona(s) elegidas"
    tipo = {"todos": "todas las personas", "internos": "internos", "externos": "externos"}[f["tipo"]]
    roles = " y ".join(r.lower() + "es" if r == "Líder" else r.lower() + "s" for r in f["roles"])
    if f["modo"] == "equipos":
        return f"{tipo} ({roles}) de {len(f['equipos'])} equipo(s)"
    return f"{tipo} ({roles}) de equipos en: {', '.join(f['estados']) or 'cualquier estado'}"


def send_to_group(db: Session, clave: str, filtro: dict | None, actor: str) -> int:
    """Un mensaje por persona (sin copia al líder), con sus variables. Se entrega según MODO_ENVIO."""
    if db.get(Template, clave) is None:
        raise ValueError("Plantilla no encontrada.")
    personas = recipients(db, filtro)
    for m in personas:
        queue_message(db, clave, team=m.team, member=m, para=m.correo)
    log(db, "Correo", f"Envío a grupo «{clave}»: {len(personas)} persona(s) — {describe(db, filtro)}", actor=actor)
    return len(personas)


def next_date(d: date, frecuencia: str) -> date | None:
    if frecuencia == "diaria":
        return d + timedelta(days=1)
    if frecuencia == "semanal":
        return d + timedelta(days=7)
    if frecuencia == "mensual":
        y, mth = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
        return d.replace(year=y, month=mth, day=min(d.day, calendar.monthrange(y, mth)[1]))
    return None


def run_automation(db: Session, a: Automation, actor: str = "Sistema") -> int:
    n = send_to_group(db, a.plantilla, a.filtro, actor)
    a.ultima, a.ultimo_total = datetime.now(), n
    today = date.today()
    if a.frecuencia == "una_vez":
        a.proxima, a.activa = None, False
    elif a.proxima is None or a.proxima <= today:  # al correrlo a mano antes de tiempo, el calendario no se mueve
        nxt = next_date(a.proxima or today, a.frecuencia)
        while nxt <= today:
            nxt = next_date(nxt, a.frecuencia)
        a.proxima = nxt
    return n


def run_due(db: Session) -> int:
    """Corre los envíos programados que tocan hoy (o que se quedaron atrás si el servidor estuvo apagado)."""
    total = 0
    for a in db.scalars(select(Automation).where(Automation.activa.is_(True), Automation.proxima <= date.today())):
        if db.get(Template, a.plantilla) is None:
            a.activa = False
            log(db, "Sistema", f"Envío programado «{a.nombre}» desactivado: su plantilla ya no existe")
            continue
        total += run_automation(db, a)
    return total


def export_xlsx(db: Session, filtro: dict | None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Personas"
    ws.append(["Nombre", "Correo"])
    for c in ws[1]:
        c.font = Font(bold=True)
    for m in recipients(db, filtro):
        ws.append([m.nombre, m.correo])
    ws.column_dimensions["A"].width = 38
    ws.column_dimensions["B"].width = 42
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
