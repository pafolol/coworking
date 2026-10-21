"""Reglas de operación: registro, evaluación, check-ins, corte semanal, vencimientos y cambios."""
import base64
import hashlib
import hmac
import os
import re
import secrets
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .db import UPLOADS
from .mailer import cfg, fecha_larga, log, queue_message, set_cfg
from .models import (CON_ESPACIO, EN_OPERACION, S_ACT, S_ALERTA, S_BAJA, S_DOC, S_ESP, S_EVA, S_FIJO, S_NO, S_RIESGO,
                     S_SOL, Access, ChangeRequest, Checkin, Cut, CutItem, Document, Member, Space, Task, Team)

R_ADMIN = "Administración"
R_EVAL = "Evaluación"
R_ACC = "Accesos y documentos"

TIPOS = ("Alumno", "Colaborador", "Exatec", "Externo")
LIBRE_CORREO = ("Exatec", "Externo")  # pueden registrarse con cualquier correo (los Exatec suelen ya no tener el institucional)
EMAIL_RE = re.compile(r"^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)+$")

# Tipos de archivo que se aceptan como documento, con la firma con la que empieza cada uno.
ARCHIVOS = {".pdf": b"%PDF", ".png": b"\x89PNG\r\n\x1a\n", ".jpg": b"\xff\xd8\xff", ".jpeg": b"\xff\xd8\xff", ".webp": b"RIFF"}
MEDIA = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    day = min(d.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def add_business_days(d: date, n: int) -> date:
    while n > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


# ---------- utilidades de estado, tareas y espacios ----------

def set_state(db: Session, team: Team, estado: str, actor: str = "Sistema", motivo: str = "") -> None:
    if team.estado == estado:
        return
    log(db, "Estado", f"{team.estado} → {estado}" + (f" · {motivo}" if motivo else ""), team, actor)
    team.estado = estado
    team.fecha_estado = date.today()


def add_task(db: Session, tipo: str, rol: str, titulo: str, team: Team | None = None, member: Member | None = None,
             vence: date | None = None, detalle: str = "") -> Task:
    t = Task(tipo=tipo, rol=rol, titulo=titulo, detalle=detalle, team_id=team.id if team else None,
             member_id=member.id if member else None, creada=datetime.now(), vence=vence)
    db.add(t)
    return t


def upsert_task(db: Session, tipo: str, rol: str, titulo: str, team: Team | None = None, member: Member | None = None,
                vence: date | None = None, detalle: str = "") -> Task:
    """Una sola tarea abierta por tipo, equipo y persona: si ya existe se actualiza en vez de duplicarse."""
    db.flush()
    q = select(Task).where(Task.tipo == tipo, Task.estado == "Pendiente",
                           Task.team_id == (team.id if team else None), Task.member_id == (member.id if member else None))
    actual = db.scalar(q)
    if actual is None:
        return add_task(db, tipo, rol, titulo, team, member, vence, detalle)
    actual.rol, actual.titulo, actual.vence = rol, titulo, vence
    actual.detalle = detalle or actual.detalle
    return actual


def close_tasks(db: Session, tipo: str, team: Team | None = None, member: Member | None = None, actor: str = "Sistema") -> None:
    db.flush()
    q = select(Task).where(Task.tipo == tipo, Task.estado == "Pendiente")
    if team is not None:
        q = q.where(Task.team_id == team.id)
    if member is not None:
        q = q.where(Task.member_id == member.id)
    for t in db.scalars(q):
        t.estado, t.cerrada, t.cerrada_por = "Hecha", datetime.now(), actor


def close_doc_tasks(db: Session, tipo: str, doc: Document, actor: str = "Sistema") -> None:
    """Cierra las tareas de ese documento: las del equipo si es de equipo, solo las de la persona si es personal."""
    db.flush()
    q = select(Task).where(Task.tipo == tipo, Task.estado == "Pendiente", Task.team_id == doc.team_id,
                           Task.member_id == doc.member_id)
    for t in db.scalars(q):
        t.estado, t.cerrada, t.cerrada_por = "Hecha", datetime.now(), actor


def free_spaces(db: Session) -> list[Space]:
    return list(db.scalars(select(Space).where(Space.team_id.is_(None)).order_by(Space.numero)))


def assign_space(db: Session, team: Team, space: Space, actor: str = "Sistema") -> None:
    space.team_id, space.desde = team.id, date.today()
    team.space = space
    log(db, "Estado", f"Espacio {space.numero} asignado", team, actor)


def release_space(db: Session, team: Team, actor: str = "Sistema") -> int | None:
    space = team.space
    if space is None:
        return None
    numero = space.numero
    space.team_id, space.desde = None, None
    team.space = None
    log(db, "Estado", f"Espacio {numero} liberado", team, actor)
    return numero


def make_folio(db: Session, base: str) -> str:
    """Folio derivado de la matrícula del líder (o su correo, si es externo) con una sal secreta.

    No es consecutivo ni adivinable, y la misma persona obtiene otro folio si vuelve a aplicar.
    """
    salt = cfg(db, "FOLIO_SALT", "")
    if not salt:
        salt = secrets.token_hex(16)
        set_cfg(db, "FOLIO_SALT", salt)
    db.flush()
    base = re.sub(r"\s+", "", str(base or "")).lower() or secrets.token_hex(4)
    for intento in range(200):
        digest = hmac.new(salt.encode(), f"{base}:{intento}".encode(), hashlib.sha256).digest()
        code = base64.b32encode(digest).decode()[:8]
        folio = f"CW-{code[:4]}-{code[4:]}"
        if db.scalar(select(func.count()).select_from(Team).where(Team.folio == folio)) == 0:
            return folio
    raise ValueError("No se pudo generar el folio; inténtalo de nuevo.")


# ---------- personas y correos ----------

def internal_domains(db: Session) -> list[str]:
    return [str(d).strip().lower().lstrip("@") for d in (cfg(db, "DOMINIOS_INTERNOS", ["tec.mx"]) or []) if str(d).strip()]


def is_internal_email(db: Session, correo: str) -> bool:
    domain = correo.rsplit("@", 1)[-1].lower()
    return any(domain == d or domain.endswith("." + d) for d in internal_domains(db))


def email_owner(db: Session, correo: str) -> Member | None:
    """El integrante activo que ya usa ese correo en un equipo vigente (ni dado de baja ni no aceptado)."""
    db.flush()
    for m in db.scalars(select(Member).where(Member.correo == correo, Member.activo.is_(True))):
        if m.team.estado not in (S_BAJA, S_NO):
            return m
    return None


def check_person(db: Session, nombre: str, correo: str, tipo: str, dominio: bool = True) -> str:
    """Valida a una persona antes de registrarla y devuelve su correo normalizado. Lanza ValueError con el motivo.

    Con `dominio=False` no se exige el correo institucional (la carga masiva lo marca como aviso, no como error).
    """
    nombre, correo = (nombre or "").strip(), (correo or "").strip().lower()
    if not nombre:
        raise ValueError("falta el nombre")
    if not correo:
        raise ValueError("falta el correo")
    if not EMAIL_RE.match(correo):
        raise ValueError(f"el correo «{correo}» no es válido")
    if tipo not in TIPOS:
        raise ValueError(f"tipo «{tipo}» no reconocido")
    dominios = internal_domains(db)
    if dominio and tipo not in LIBRE_CORREO and dominios and not is_internal_email(db, correo):
        raise ValueError(f"alumnos y colaboradores deben usar su correo @{dominios[0]}; si no pertenece a la institución, márcalo como Exatec o externo")
    otro = email_owner(db, correo)
    if otro is not None:
        raise ValueError(f"el correo {correo} ya está registrado en {otro.team.nombre}")
    return correo


# ---------- documentos ----------

def catalog(db: Session) -> list[dict]:
    return cfg(db, "CATALOGO_DOCS", []) or []


def modo(db: Session, clave: str) -> str:
    item = next((i for i in catalog(db) if i["clave"] == clave), None)
    return (item or {}).get("modo", "archivo")


def applies(item: dict, member: Member | None) -> bool:
    if item["nivel"] == "Equipo":
        return member is None
    if member is None:
        return False
    externo = member.tipo == "Externo"
    return item.get("aplica", "Todos") == "Todos" or (item["aplica"] == "Externos") == externo


def ensure_required_docs(db: Session, team: Team) -> None:
    """Crea el renglón «Faltante» de cada documento obligatorio que aún no existe."""
    db.flush()
    existing = {(d.clave, d.member_id) for d in db.scalars(select(Document).where(Document.team_id == team.id))}
    for item in catalog(db):
        if not item.get("obligatorio"):
            continue
        for member in [None] + [m for m in team.members if m.activo]:
            if applies(item, member) and (item["clave"], member.id if member else None) not in existing:
                db.add(Document(team_id=team.id, member_id=member.id if member else None, clave=item["clave"], nombre=item["nombre"]))
    db.flush()


def missing_docs(db: Session, team: Team) -> list[str]:
    db.flush()  # la sesión no hace autoflush: que la consulta vea lo recién cargado o firmado
    out = []
    for d in db.scalars(select(Document).where(Document.team_id == team.id, Document.estado.in_(["Faltante", "Rechazado", "Vencido"]))):
        if d.member_id and not d.member.activo:
            continue
        out.append(f"{d.nombre} ({d.member.nombre})" if d.member_id else d.nombre)
    return out


def check_upload(filename: str, content: bytes) -> str:
    """Solo PDF e imágenes, comprobando que el contenido corresponda a la extensión. Devuelve la extensión."""
    ext = os.path.splitext(filename or "")[1].lower()
    if ext not in ARCHIVOS:
        raise ValueError(f"«{filename}» no se puede subir: solo se aceptan PDF o imágenes (JPG, PNG, WEBP).")
    if not content.startswith(ARCHIVOS[ext]) or (ext == ".webp" and content[8:12] != b"WEBP"):
        raise ValueError(f"«{filename}» no es un archivo {ext[1:].upper()} válido.")
    return ext


def save_upload(team: Team, filename: str, content: bytes) -> str:
    ext = check_upload(filename, content)
    folder = UPLOADS / team.folio
    folder.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^\w\-]+", "_", os.path.splitext(filename)[0])[-60:] or "archivo"
    name = f"{uuid.uuid4().hex[:8]}_{stem}{ext}"
    (folder / name).write_bytes(content)
    return f"{team.folio}/{name}"


def sign_document(db: Session, doc: Document, nombre: str) -> None:
    """Aceptación en el formulario («he leído y acepto» + nombre): queda válida sin archivo ni revisión."""
    item = next((i for i in catalog(db) if i["clave"] == doc.clave), None)
    meses = item.get("vigencia_meses") if item else None
    doc.firma, doc.archivo, doc.enlace = nombre.strip()[:190], "", ""
    doc.fecha_carga, doc.estado = date.today(), "Validado"
    doc.vencimiento = add_months(date.today(), meses) if meses else None
    doc.aviso_1 = doc.aviso_2 = False
    close_doc_tasks(db, "Documento vencido", doc)
    log(db, "Documento", f"{doc.nombre}: aceptada por {doc.firma}", doc.team)


def attach_document(db: Session, doc: Document, archivo: str = "", enlace: str = "") -> None:
    doc.firma = ""
    doc.archivo, doc.enlace = archivo, enlace
    doc.fecha_carga, doc.estado, doc.vencimiento = date.today(), "Por validar", None
    doc.aviso_1 = doc.aviso_2 = False
    close_doc_tasks(db, "Documento vencido", doc)
    log(db, "Documento", f"Cargado: {doc.nombre}", doc.team)
    upsert_task(db, "Validar documento", R_ACC, f"Validar «{doc.nombre}» de {doc.team.nombre}", doc.team, doc.member)


def check_docs_complete(db: Session, team: Team) -> None:
    """Documentación pendiente → En evaluación cuando ya no falta nada."""
    faltan = missing_docs(db, team)
    if team.estado == S_DOC and not faltan:
        set_state(db, team, S_EVA, motivo="Documentación completa")
        upsert_task(db, "Evaluar", R_EVAL, f"Evaluar la solicitud de {team.nombre}", team,
                    vence=add_business_days(team.fecha_solicitud, cfg(db, "DIAS_HABILES_DECISION", 10)))


def validate_document(db: Session, doc: Document, estado: str, actor: str) -> None:
    doc.estado = estado
    if estado == "Validado":
        item = next((i for i in catalog(db) if i["clave"] == doc.clave), None)
        meses = item.get("vigencia_meses") if item else None
        doc.vencimiento = add_months(doc.fecha_carga or date.today(), meses) if meses else None
    log(db, "Documento", f"{estado}: {doc.nombre}", doc.team, actor)
    close_doc_tasks(db, "Validar documento", doc, actor)
    if estado == "Rechazado":
        queue_message(db, "documentacion", doc.team, extra={"documentos_faltantes": "; ".join(missing_docs(db, doc.team))})


# ---------- registro y evaluación ----------

def submit_application(db: Session, data: dict, files: dict[str, tuple[str, bytes]]) -> Team:
    """Paso 1 y 2: crea el equipo con folio, confirma el registro y revisa documentos.

    `files` va por llave: «<clave>» para documentos de equipo y «<clave>:<índice de integrante>» para personales.
    """
    today = date.today()
    integrantes = data.get("integrantes") or []
    if not integrantes:
        raise ValueError("Agrega al menos un integrante (el líder).")
    vistos: set[str] = set()
    for p in integrantes:
        try:
            p["tipo"] = p.get("tipo") or "Alumno"
            p["correo"] = check_person(db, p.get("nombre", ""), p.get("correo", ""), p["tipo"])
        except ValueError as exc:
            raise ValueError(f"{(p.get('nombre') or 'Un integrante').strip()}: {exc}.")
        if p["correo"] in vistos:
            raise ValueError("Hay correos repetidos entre los integrantes.")
        vistos.add(p["correo"])
    for filename, content in files.values():
        check_upload(filename, content)
    from . import formas
    respuestas, archivos_extra = formas.collect(formularios(db)["solicitud"].get("preguntas") or [], data.get("respuestas"), files)
    lider = integrantes[0]
    previo = db.scalar(select(Team).where(Team.estado == S_NO, Team.lider_correo == lider["correo"], Team.fecha_reaplicacion > today)
                       .order_by(Team.fecha_reaplicacion.desc()))
    if previo is not None:
        raise ValueError(f"Tu solicitud anterior no fue aceptada; podrás volver a aplicar a partir del {fecha_larga(previo.fecha_reaplicacion)}.")

    team = Team(folio=make_folio(db, lider.get("matricula") or lider["correo"]), nombre=data["nombre"].strip(),
                descripcion=data.get("descripcion", ""), etapa=data.get("etapa", ""), sector=data.get("sector", ""),
                lider_nombre=lider["nombre"].strip(), lider_correo=lider["correo"], estado=S_SOL, fecha_solicitud=today, fecha_estado=today,
                respuestas=respuestas)
    db.add(team)
    for i, p in enumerate(integrantes):
        team.members.append(Member(nombre=p["nombre"].strip(), correo=p["correo"], tipo=p["tipo"],
                                   matricula=str(p.get("matricula") or "").strip(), rol="Líder" if i == 0 else "Integrante"))
    db.flush()
    if archivos_extra:  # archivos de las preguntas extra: se guardan con los documentos del equipo
        formas.save_files(respuestas, archivos_extra, team.folio)
        flag_modified(team, "respuestas")  # el JSON cambió por dentro: SQLAlchemy no lo nota solo
    members = list(team.members)
    log(db, "Estado", f"Solicitud recibida · folio {team.folio}", team)
    queue_message(db, "registro", team)

    ensure_required_docs(db, team)
    docs = list(db.scalars(select(Document).where(Document.team_id == team.id)))
    for key, (filename, content) in files.items():
        clave, _, idx = key.partition(":")
        member_id = members[int(idx)].id if idx.isdigit() and int(idx) < len(members) else None
        doc = next((d for d in docs if d.clave == clave and d.member_id == member_id), None)
        if doc and content:
            attach_document(db, doc, archivo=save_upload(team, filename, content))
    carta = data.get("carta") or {}
    if carta.get("acepta") and (carta.get("nombre") or "").strip():
        for doc in docs:
            if doc.member_id is None and modo(db, doc.clave) == "firma":
                sign_document(db, doc, carta["nombre"])

    faltan = missing_docs(db, team)
    if faltan:
        set_state(db, team, S_DOC, motivo="Faltan documentos obligatorios")
        queue_message(db, "documentacion", team, extra={"documentos_faltantes": "; ".join(faltan)})
    else:
        set_state(db, team, S_EVA, motivo="Documentación completa")
        upsert_task(db, "Evaluar", R_EVAL, f"Evaluar la solicitud de {team.nombre}", team,
                    vence=add_business_days(today, cfg(db, "DIAS_HABILES_DECISION", 10)))
    return team


def ensure_access_rows(db: Session, team: Team) -> int:
    n = 0
    for m in team.members:
        if m.activo and m.access is None:
            m.access = Access()
            n += 1
    db.flush()
    return n


def evaluate(db: Session, team: Team, decision: str, rubrica: dict, retro: str, actor: str) -> None:
    """Pasos 3 y 4: registra la rúbrica y la decisión; el mensaje sale solo."""
    pesos = {r["criterio"]: r["peso"] for r in cfg(db, "RUBRICA", [])}
    total = sum(pesos.values()) or 1
    team.rubrica = rubrica
    team.puntaje = round(sum(float(rubrica.get(c, 0)) / 5 * p for c, p in pesos.items()) / total * 100, 1)
    team.retroalimentacion, team.evaluador = retro, actor
    close_tasks(db, "Evaluar", team, actor=actor)
    if decision == "Aceptado":
        team.fecha_aceptacion = date.today()
        team.renovacion_confirmada = True
        set_state(db, team, S_ACT, actor, f"Aceptado · puntaje {team.puntaje}")
        queue_message(db, "aceptacion", team)
        ensure_access_rows(db, team)
        n = sum(1 for m in team.members if m.activo)
        upsert_task(db, "Alta de acceso", R_ACC, f"Dar de alta {n} acceso(s) de {team.nombre} en la plataforma de accesos", team,
                    vence=date.today() + timedelta(days=3), detalle="Captura el vencimiento de cada integrante en Accesos.")
    else:
        team.fecha_reaplicacion = date.today() + timedelta(days=cfg(db, "DIAS_REAPLICACION", 90))
        set_state(db, team, S_NO, actor, f"No aceptado · puntaje {team.puntaje}")
        queue_message(db, "no_aceptacion", team, extra={"retroalimentacion": retro or "—", "fecha_reaplicacion": fecha_larga(team.fecha_reaplicacion)})


def update_access(db: Session, acc: Access, estado: str, vencimiento: date | None, actor: str) -> None:
    """Paso 5: espejo del alta manual; al quedar Activo el integrante recibe su aviso."""
    member, team = acc.member, acc.member.team
    acc.estado = estado
    if estado == "Activo":
        acc.vencimiento = vencimiento or add_months(date.today(), cfg(db, "MESES_ACCESO", 6))
        acc.fecha_alta = acc.fecha_alta or date.today()
        acc.aviso_1 = acc.aviso_2 = False
        queue_message(db, "acceso_activo", team, member, extra={"fecha_vencimiento": fecha_larga(acc.vencimiento)})
        close_tasks(db, "Renovar acceso", team, member, actor)
        close_tasks(db, "Alta de acceso", team, member, actor)
        if all(m.access and m.access.estado != "Pendiente" for m in team.members if m.activo):
            close_tasks(db, "Alta de acceso", team, actor=actor)
    elif estado == "Revocado":
        for tipo in ("Revocar acceso", "Renovar acceso", "Alta de acceso"):
            close_tasks(db, tipo, team, member, actor)
        if not any(m.access and m.access.estado == "Activo" for m in team.members):
            close_tasks(db, "Revocar acceso", team, actor=actor)
    log(db, "Acceso", f"{member.nombre}: {estado}" + (f" hasta {acc.vencimiento}" if estado == "Activo" else ""), team, actor)


# ---------- check-ins ----------

def register_checkin(db: Session, correo: str, origen: str = "QR", token: str | None = None, when: datetime | None = None) -> dict:
    correo = str(correo or "").strip().lower()
    when = when or datetime.now()
    if origen == "QR" and token != cfg(db, "QR_TOKEN", ""):
        return {"ok": False, "mensaje": "Este código QR ya no está vigente. Escanea el QR que está dentro del espacio."}

    members = list(db.scalars(select(Member).where(Member.correo == correo, Member.activo.is_(True))))
    member = next((m for m in members if m.team.estado in EN_OPERACION), None)
    if member is None:
        nota = "Equipo sin acceso vigente" if members else "Correo no registrado"
        ya = db.scalar(select(func.count()).select_from(Checkin).where(Checkin.correo == correo, Checkin.fecha == when.date(), Checkin.valido.is_(False)))
        if not ya:
            db.add(Checkin(ts=when, fecha=when.date(), correo=correo, valido=False, nota=nota, origen=origen))
            pendiente = db.scalar(select(func.count()).select_from(Task).where(Task.tipo == "Revisar check-in", Task.estado == "Pendiente",
                                                                               Task.detalle == correo))
            if not pendiente:
                add_task(db, "Revisar check-in", R_ADMIN, f"Check-in inválido de {correo[:80]}: {nota.lower()}", detalle=correo)
        return {"ok": False, "mensaje": "No encontramos ese correo entre los integrantes activos. Avisamos al equipo del coworking."}

    team = member.team
    del_equipo = db.scalar(select(func.count()).select_from(Checkin).where(Checkin.team_id == team.id, Checkin.fecha == when.date(), Checkin.valido.is_(True)))
    propio = db.scalar(select(func.count()).select_from(Checkin).where(Checkin.member_id == member.id, Checkin.fecha == when.date(), Checkin.valido.is_(True)))
    if not propio:  # un registro por persona y día; repetirlo no crea otra fila
        nota = ""
        if member.access and member.access.estado == "Vencido":
            nota = "Acceso vencido"
            upsert_task(db, "Revisar check-in", R_ACC, f"{member.nombre} hizo check-in con acceso vencido", team, member)
        db.add(Checkin(ts=when, fecha=when.date(), correo=correo, member_id=member.id, team_id=team.id, valido=True, nota=nota, origen=origen))
        db.flush()
    semana = usage(db, [team.id], monday(when.date())).get(team.id, {}).get(monday(when.date()), 0)
    return {"ok": True, "nombre": member.nombre.split(" ")[0], "equipo": team.nombre, "dias_semana": semana,
            "minimo": cfg(db, "DIAS_MINIMOS", 3), "repetido": bool(del_equipo), "ya_registrado": bool(propio),
            "espacio": team.space.numero if team.space else None, "mensaje": "¡Check-in registrado!"}


def usage(db: Session, team_ids: list[int] | None = None, since: date | None = None) -> dict[int, dict[date, int]]:
    """Visitas (días distintos con al menos un check-in válido de cualquier integrante) por equipo y semana."""
    q = select(Checkin.team_id, Checkin.fecha).where(Checkin.valido.is_(True), Checkin.team_id.is_not(None)).distinct()
    if team_ids is not None:
        q = q.where(Checkin.team_id.in_(team_ids))
    if since is not None:
        q = q.where(Checkin.fecha >= since)
    out: dict[int, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    for team_id, fecha in db.execute(q):
        out[team_id][monday(fecha)] += 1
    return out


def excluded_weeks(db: Session) -> dict[date, str]:
    out = {}
    for item in cfg(db, "SEMANAS_EXCLUIDAS", []) or []:
        try:
            out[monday(date.fromisoformat(item["inicio"]))] = item.get("motivo", "")
        except (KeyError, TypeError, ValueError):
            continue
    return out


def counted_weeks(db: Session, upto: date, n: int) -> list[date]:
    """Las últimas n semanas que cuentan (sin las excluidas), la más reciente primero."""
    excl, out, w = excluded_weeks(db), [], upto
    while len(out) < n:
        if w not in excl:
            out.append(w)
        w -= timedelta(days=7)
    return out


def paused(team: Team, week: date) -> bool:
    """¿Esa semana (por su lunes) cae dentro de la pausa justificada del equipo?"""
    if not team.pausa_hasta:
        return False
    desde = monday(team.pausa_desde) if team.pausa_desde else monday(team.pausa_hasta)
    return desde <= week <= team.pausa_hasta


def team_weeks(team: Team, weeks: list[date], n: int) -> list[date]:
    """Las n semanas más recientes que cuentan para ese equipo: las pausadas no se le cuentan como bajas."""
    return [w for w in weeks if not paused(team, w)][:n]


def average(n: int) -> int:
    return max(1, int(n or 1))


def waitlist(db: Session) -> list[tuple[Team, float]]:
    """Lista de espera ordenada por promedio de visitas de las últimas semanas."""
    teams = list(db.scalars(select(Team).where(Team.estado == S_ESP)))
    n = average(cfg(db, "SEMANAS_PROMEDIO", 4))
    weeks = counted_weeks(db, monday(date.today()) - timedelta(days=7), n + 8)
    use = usage(db, [t.id for t in teams], weeks[-1]) if teams else {}
    rows = [(t, round(sum(use.get(t.id, {}).get(w, 0) for w in team_weeks(t, weeks, n)) / n, 2)) for t in teams]
    return sorted(rows, key=lambda r: (-r[1], r[0].fecha_estado, r[0].id))


# ---------- formularios editables ----------

def formularios(db: Session) -> dict:
    """La configuración de los tres formularios, completando con los valores de fábrica lo que no se haya editado."""
    from .defaults import FORMULARIOS
    guardado = cfg(db, "FORMULARIOS", {}) or {}
    return {clave: {**base, **(guardado.get(clave) or {})} for clave, base in FORMULARIOS.items()}


# ---------- niveles y beneficios ----------

def levels(db: Session, team_ids: list[int] | None = None) -> dict[int, dict]:
    """Nivel de cada equipo en operación según su constancia en las semanas ya cerradas."""
    from .defaults import NIVELES
    niveles = cfg(db, "NIVELES", NIVELES) or NIVELES
    minimo, n_avg = cfg(db, "DIAS_MINIMOS", 3), average(cfg(db, "SEMANAS_PROMEDIO", 4))
    todas = counted_weeks(db, monday(date.today()) - timedelta(days=7), 20)
    q = select(Team).where(Team.estado.in_(EN_OPERACION))
    if team_ids is not None:
        q = q.where(Team.id.in_(team_ids))
    teams = list(db.scalars(q))
    use = usage(db, [t.id for t in teams], todas[-1]) if teams else {}
    out = {}
    for t in teams:
        dias = [use.get(t.id, {}).get(w, 0) for w in team_weeks(t, todas, 12)]
        promedio = round(sum(dias[:n_avg]) / n_avg, 2)
        racha = next((i for i, d in enumerate(dias) if d < minimo), len(dias))
        idx = max((i for i, n in enumerate(niveles) if promedio >= n["promedio_min"] and racha >= n["racha_min"]), default=0)
        sig = niveles[idx + 1] if idx + 1 < len(niveles) else None
        falta = []
        if sig:
            if promedio < sig["promedio_min"]:
                falta.append(f"subir el promedio a {sig['promedio_min']:g} visitas por semana")
            if racha < sig["racha_min"]:
                falta.append(f"{sig['racha_min'] - racha} semana(s) más cumpliendo el mínimo")
        out[t.id] = {"nivel": niveles[idx]["nombre"], "indice": idx, "promedio": promedio, "racha": racha, "racha_tope": racha == len(dias),
                     "siguiente": sig["nombre"] if sig else None, "falta": " y ".join(falta), "beneficios": niveles[idx]["beneficios"]}
    return out


# ---------- corte semanal ----------

def recent_use(db: Session, team: Team) -> bool:
    """¿El equipo tiene alguna visita dentro de las semanas que dispararían una alerta de baja?"""
    ultimo = last_checkin(db, team)
    return bool(ultimo and (date.today() - ultimo).days <= 7 * cfg(db, "SEMANAS_SIN_USO", 2))


def renewal_overdue(team: Team) -> bool:
    return bool(not team.renovacion_confirmada and team.renovacion_limite and team.renovacion_limite < date.today())


def generate_cut(db: Session, semana: date | None = None) -> Cut:
    """Cuenta las visitas de la semana anterior por equipo y arma la Propuesta de corte."""
    semana = monday(semana) if semana else monday(date.today()) - timedelta(days=7)
    previous = db.scalar(select(Cut).where(Cut.semana == semana))
    desmarcadas: set[tuple[int, str]] = set()
    if previous is not None:
        if previous.estado != "Propuesta":
            return previous
        # Al recalcular se conserva lo que el operador ya había desmarcado.
        desmarcadas = {(i.team_id, i.accion) for i in previous.items if not i.aprobada}
        db.delete(previous)
        db.flush()
    # Una propuesta de otra semana que nadie aplicó ya no debe poder aplicarse.
    for viejo in db.scalars(select(Cut).where(Cut.estado == "Propuesta", Cut.semana != semana)):
        viejo.estado, viejo.nota = "Vencida", "No se aplicó antes del corte siguiente."
    cut = Cut(semana=semana, creado=datetime.now())
    db.add(cut)
    if semana in excluded_weeks(db):
        cut.nota = f"Semana excluida del cálculo: {excluded_weeks(db)[semana]}"
        cut.estado, cut.aplicado_en, cut.aplicado_por = "Aplicado", datetime.now(), "Sistema"
        db.flush()
        return cut

    hoy = date.today()
    minimo = cfg(db, "DIAS_MINIMOS", 3)
    n_up, n_down, n_zero = (average(cfg(db, k, 2)) for k in ("SEMANAS_UPGRADE", "SEMANAS_DOWNGRADE", "SEMANAS_SIN_USO"))
    n_avg, gracia = average(cfg(db, "SEMANAS_PROMEDIO", 4)), cfg(db, "DIAS_GRACIA", 14)
    n_max = max(n_up, n_down, n_zero, n_avg)
    todas = counted_weeks(db, semana, n_max + 8)
    fin_semana = semana + timedelta(days=6)
    teams = list(db.scalars(select(Team).where(Team.estado.in_(EN_OPERACION)).order_by(Team.nombre)))
    use = usage(db, [t.id for t in teams], todas[-1])

    items: list[CutItem] = []
    candidatos: list[CutItem] = []
    libres_ahora = len(free_spaces(db))
    liberados = 0
    for t in teams:
        weeks = team_weeks(t, todas, n_max)
        dias = [use.get(t.id, {}).get(w, 0) for w in weeks]
        item = CutItem(team_id=t.id, estado_actual=t.estado, dias=dias[0], dias_previa=dias[1] if len(dias) > 1 else 0,
                       promedio=round(sum(dias[:n_avg]) / n_avg, 2), accion="Sin cambio", estado_nuevo="", detalle="",
                       aprobada=True, resultado="")
        item.team = t
        items.append(item)
        acept = t.fecha_aceptacion or t.fecha_solicitud
        en_gracia = (fin_semana - acept).days < gracia
        completas = lambda n: len(weeks) >= n and acept <= weeks[n - 1]  # el equipo ya existía durante las n semanas
        if paused(t, semana):
            item.dias = use.get(t.id, {}).get(semana, 0)
            item.detalle = f"En pausa justificada hasta el {fecha_larga(t.pausa_hasta)}"
        elif t.estado == S_ALERTA:
            sin_renovar = renewal_overdue(t)
            if dias[0] > 0 and not sin_renovar:
                item.accion, item.estado_nuevo = "Reactivar", (S_FIJO if t.space else S_ACT)
                item.detalle = "Volvió a usar el espacio"
            elif t.alerta_limite and hoy >= t.alerta_limite:
                item.accion, item.estado_nuevo = "Baja", S_BAJA
                item.detalle = ("No confirmó la renovación del semestre" if sin_renovar else "Sin visitas ni respuesta") + f" (límite: {fecha_larga(t.alerta_limite)})"
                liberados += 1 if t.space else 0
            else:
                item.detalle = ("Falta que confirme la renovación" if sin_renovar else "En plazo de respuesta") + (f" hasta el {fecha_larga(t.alerta_limite)}" if t.alerta_limite else "")
        elif not en_gracia and completas(n_zero) and all(d == 0 for d in dias[:n_zero]):
            item.estado_nuevo = S_ALERTA
            item.detalle = f"0 visitas en {n_zero} semanas seguidas"
            if t.estado in CON_ESPACIO:
                item.accion = "Downgrade y alerta de baja"
                liberados += 1
            else:
                item.accion = "Alerta de baja"
        elif t.estado in CON_ESPACIO:
            # No se penaliza por semanas anteriores a tener el lugar (p. ej. asignado a mano a mitad de semana).
            desde_lugar = t.space.desde if t.space is not None else None
            if dias[0] < minimo and desde_lugar is not None and desde_lugar > weeks[0]:
                item.detalle = f"Tiene su lugar desde el {fecha_larga(desde_lugar)}; aún no se mide una semana completa"
            elif dias[0] < minimo:
                if completas(n_down) and all(d < minimo for d in dias[:n_down]) and (desde_lugar is None or desde_lugar <= weeks[n_down - 1]):
                    item.accion, item.estado_nuevo = "Downgrade", S_ACT
                    item.detalle = f"Menos de {minimo} visitas {n_down} semanas seguidas ({', '.join(str(d) for d in reversed(dias[:n_down]))})"
                    liberados += 1
                elif t.estado == S_FIJO:
                    item.accion, item.estado_nuevo = "En riesgo", S_RIESGO
                    item.detalle = f"{dias[0]} visita(s) en la semana; el mínimo es {minimo}"
                else:
                    item.detalle = "Sigue en riesgo"
            elif t.estado == S_RIESGO:
                item.accion, item.estado_nuevo, item.detalle = "Recupera", S_FIJO, f"{dias[0]} visitas en la semana"
        elif t.estado == S_ESP:
            # Quien ya está en la lista conserva su turno, pero solo recibe lugar si esta semana volvió a cumplir.
            if dias[0] >= minimo:
                candidatos.append(item)
            else:
                item.detalle = f"Sigue en lista de espera; esta semana no alcanzó las {minimo} visitas"
        elif completas(n_up) and all(d >= minimo for d in dias[:n_up]):
            candidatos.append(item)

    # Primero la lista de espera, luego los nuevos candidatos; dentro de cada grupo, por promedio de visitas.
    candidatos.sort(key=lambda i: (i.estado_actual != S_ESP, -i.promedio, i.team.fecha_estado, i.team_id))
    lugares = libres_ahora + liberados
    origen = f"{libres_ahora} libre(s) hoy" + (f" + {liberados} que se libera(n) en este corte" if liberados else "")
    for pos, item in enumerate(candidatos, start=1):
        if pos <= lugares:
            item.accion, item.estado_nuevo = "Upgrade", S_FIJO
            item.detalle = f"Lugar {pos} de {lugares} disponibles ({origen})" + (" · venía de la lista de espera" if item.estado_actual == S_ESP else f" · {minimo}+ visitas {n_up} semanas seguidas")
        else:
            motivo = f"Califican {len(candidatos)} equipos y hay {lugares} lugar(es) ({origen}): quedó en el turno {pos} por promedio ({item.promedio:g})"
            if item.estado_actual == S_ACT:
                item.accion, item.estado_nuevo, item.detalle = "Lista de espera", S_ESP, motivo
            else:
                item.detalle = "Sigue en lista de espera. " + motivo

    orden = {"Downgrade": 0, "Downgrade y alerta de baja": 0, "Baja": 1, "Alerta de baja": 2, "En riesgo": 3, "Upgrade": 4,
             "Lista de espera": 5, "Recupera": 6, "Reactivar": 7, "Sin cambio": 9}
    posicion = {id(i): n for n, i in enumerate(candidatos)}
    items.sort(key=lambda i: (orden[i.accion], posicion.get(id(i), 0), i.estado_actual != S_ESP, -i.promedio))
    for item in items:
        if (item.team_id, item.accion) in desmarcadas:
            item.aprobada = False
    cut.items = items
    db.flush()
    cambios = sum(1 for i in items if i.accion != "Sin cambio")
    log(db, "Sistema", f"Propuesta de corte de la semana del {semana.isoformat()}: {cambios} cambio(s) en {len(items)} equipos")
    if cfg(db, "APROBACION_AUTOMATICA", False):
        apply_cut(db, cut, "Sistema (aprobación automática)")
    elif cambios:
        upsert_task(db, "Aprobar corte", R_ADMIN, f"Aprobar la propuesta de corte de la semana del {fecha_larga(semana)}",
                    vence=hoy, detalle=f"{cambios} cambio(s) propuestos. Los mensajes salen al aprobar.")
    else:
        apply_cut(db, cut, "Sistema (sin cambios)")
    return cut


def last_checkin(db: Session, team: Team) -> date | None:
    db.flush()
    return db.scalar(select(func.max(Checkin.fecha)).where(Checkin.team_id == team.id, Checkin.valido.is_(True)))


def start_drop_alert(db: Session, team: Team, actor: str, motivo: str, desde: date | None = None) -> None:
    """Alerta de baja con plazo para responder. `desde` es el día del corte, para que el plazo no dependa de cuándo se aprobó."""
    team.alerta_limite = (desde or date.today()) + timedelta(days=cfg(db, "DIAS_RESPUESTA_BAJA", 7))
    if team.alerta_limite <= date.today():
        team.alerta_limite = date.today() + timedelta(days=1)
    set_state(db, team, S_ALERTA, actor, motivo)
    ultimo = last_checkin(db, team)
    queue_message(db, "alerta_baja", team, extra={"ultimo_checkin": fecha_larga(ultimo) if ultimo else "su ingreso",
                                                   "fecha_limite": fecha_larga(team.alerta_limite)})


def drop_team(db: Session, team: Team, actor: str, motivo: str) -> None:
    release_space(db, team, actor)
    team.fecha_baja, team.alerta_limite = date.today(), None
    set_state(db, team, S_BAJA, actor, motivo)
    queue_message(db, "baja", team, extra={"fecha_baja": fecha_larga(team.fecha_baja)})
    # Lo que quedaba abierto del equipo ya no aplica: no se renueva ni se da de alta a quien se va.
    for tipo in ("Renovar acceso", "Alta de acceso", "Validar documento", "Documento vencido", "Aprobar pausa", "Liberar espacio"):
        close_tasks(db, tipo, team, actor=actor)
    for m in team.members:
        if m.access and m.access.estado == "Pendiente":
            m.access.estado = "Revocado"
    activos = [m for m in team.members if m.access and m.access.estado in ("Activo", "Vencido")]
    if activos:
        upsert_task(db, "Revocar acceso", R_ACC, f"Revocar {len(activos)} acceso(s) de {team.nombre} (baja)", team,
                    vence=date.today() + timedelta(days=2))


def downgrade(db: Session, team: Team, actor: str) -> None:
    if team.space is None:
        return
    limite = date.today() + timedelta(days=7)
    numero = team.space.numero
    queue_message(db, "downgrade", team, extra={"espacio": numero, "fecha_limite": fecha_larga(limite)})
    release_space(db, team, actor)
    add_task(db, "Liberar espacio", R_ADMIN, f"Verificar que {team.nombre} retiró sus pertenencias del espacio {numero}", team, vence=limite)


def upgrade(db: Session, team: Team, actor: str) -> bool:
    if team.space is not None:  # ya tiene lugar: no se le asigna un segundo
        set_state(db, team, S_FIJO, actor, "Conserva su espacio")
        return True
    libres = free_spaces(db)
    if not libres:
        return False
    assign_space(db, team, libres[0], actor)
    set_state(db, team, S_FIJO, actor, "Upgrade")
    queue_message(db, "upgrade", team, extra={"espacio": libres[0].numero, "fecha_inicio": fecha_larga(date.today())})
    return True


def apply_cut(db: Session, cut: Cut, actor: str) -> Cut:
    """Aplica solo lo aprobado: cambia estados, mueve espacios y deja salir los mensajes."""
    if cut.estado != "Propuesta":
        return cut
    dia_corte = cut.semana + timedelta(days=7)  # el lunes en que corrió este corte
    pendientes_espera: list[CutItem] = []
    for item in cut.items:  # ya vienen ordenados: primero lo que libera lugares
        team = item.team
        if item.accion == "Sin cambio":
            continue
        if not item.aprobada:
            item.resultado = "No aprobada"
            continue
        if team.estado != item.estado_actual:
            item.resultado = f"Omitida: el equipo ya está en {team.estado}"
            continue
        motivo = f"Corte {cut.semana.isoformat()}"
        if item.accion == "Downgrade":
            downgrade(db, team, actor)
            set_state(db, team, S_ACT, actor, motivo)
        elif item.accion == "Downgrade y alerta de baja":
            downgrade(db, team, actor)
            start_drop_alert(db, team, actor, motivo, dia_corte)
        elif item.accion == "Alerta de baja":
            start_drop_alert(db, team, actor, motivo, dia_corte)
        elif item.accion == "Baja":
            drop_team(db, team, actor, motivo)
        elif item.accion == "En riesgo":
            set_state(db, team, S_RIESGO, actor, motivo)
            queue_message(db, "alerta_uso", team, extra={"semana": fecha_larga(cut.semana), "dias_uso": item.dias})
        elif item.accion == "Recupera":
            set_state(db, team, S_FIJO, actor, motivo)
        elif item.accion == "Reactivar":
            team.alerta_limite = None
            set_state(db, team, S_FIJO if team.space else S_ACT, actor, motivo)
        elif item.accion == "Upgrade":
            if not upgrade(db, team, actor):
                pendientes_espera.append(item)
                continue
        elif item.accion == "Lista de espera":
            pendientes_espera.append(item)
            continue
        item.resultado = "Aplicada"
        db.flush()

    for item in pendientes_espera:
        team = item.team
        if team.estado != S_ESP:
            set_state(db, team, S_ESP, actor, f"Corte {cut.semana.isoformat()}")
            db.flush()
            pos = next((i + 1 for i, (t, _) in enumerate(waitlist(db)) if t.id == team.id), 1)
            queue_message(db, "lista_espera", team, extra={"posicion_lista": pos})
        item.resultado = "Aplicada" if item.accion == "Lista de espera" else "Sin lugar libre: queda en lista de espera"

    cut.estado, cut.aplicado_en, cut.aplicado_por = "Aplicado", datetime.now(), actor
    close_tasks(db, "Aprobar corte", actor=actor)
    log(db, "Sistema", f"Corte de la semana del {cut.semana.isoformat()} aplicado", actor=actor)
    return cut


# ---------- revisión diaria ----------

def daily_review(db: Session) -> dict:
    """Vencimientos de accesos y documentos (avisos a 15 y 5 días), renovación del semestre y sus plazos."""
    today = date.today()
    a1, a2 = cfg(db, "AVISO_1", 15), cfg(db, "AVISO_2", 5)
    res = {"accesos_avisados": 0, "accesos_vencidos": 0, "documentos_avisados": 0, "documentos_vencidos": 0, "renovaciones": 0}

    if renewal_due(db, today) is not None:
        res["renovacion_iniciada"] = start_renewal(db, "Sistema (renovación automática)")

    for acc in db.scalars(select(Access).where(Access.estado == "Activo", Access.vencimiento.is_not(None))):
        member, team = acc.member, acc.member.team
        if not member.activo or team.estado not in EN_OPERACION:
            continue
        left = (acc.vencimiento - today).days
        extra = {"fecha_vencimiento": fecha_larga(acc.vencimiento)}
        # Solo se renuevan accesos de equipos activos; los de Alerta de baja esperan la resolución del corte.
        renovable = team.estado != S_ALERTA
        if left <= 0:
            acc.estado = "Vencido"
            res["accesos_vencidos"] += 1
            log(db, "Acceso", f"Acceso vencido: {member.nombre}", team)
            if renovable:
                upsert_task(db, "Renovar acceso", R_ACC, f"Acceso vencido de {member.nombre} ({team.nombre}): renovar o revocar", team, member, vence=today)
        elif left <= a2 and not acc.aviso_2:
            acc.aviso_1 = acc.aviso_2 = True
            res["accesos_avisados"] += 1
            queue_message(db, "acceso_por_vencer", team, member, extra=extra)
            if renovable:
                upsert_task(db, "Renovar acceso", R_ACC, f"Urgente: el acceso de {member.nombre} ({team.nombre}) vence en {left} día(s)", team, member, vence=acc.vencimiento)
        elif left <= a1 and not acc.aviso_1:
            acc.aviso_1 = True
            res["accesos_avisados"] += 1
            queue_message(db, "acceso_por_vencer", team, member, extra=extra)
            if renovable:
                upsert_task(db, "Renovar acceso", R_ACC, f"Renovar el acceso de {member.nombre} ({team.nombre})", team, member, vence=acc.vencimiento)

    for doc in db.scalars(select(Document).where(Document.estado == "Validado", Document.vencimiento.is_not(None))):
        team = doc.team
        if team.estado not in EN_OPERACION or (doc.member and not doc.member.activo):
            continue
        left = (doc.vencimiento - today).days
        extra = {"documento": doc.nombre, "fecha_vencimiento": fecha_larga(doc.vencimiento)}
        if left <= 0:
            doc.estado = "Vencido"
            res["documentos_vencidos"] += 1
            log(db, "Documento", f"Vencido: {doc.nombre}", team)
            if team.estado != S_ALERTA:
                upsert_task(db, "Documento vencido", R_ACC, f"«{doc.nombre}» de {team.nombre} venció: dar seguimiento para que lo actualicen", team, doc.member, vence=today)
        elif (left <= a2 and not doc.aviso_2) or (left <= a1 and not doc.aviso_1):
            doc.aviso_1 = True
            doc.aviso_2 = left <= a2
            res["documentos_avisados"] += 1
            lider = next((m for m in team.members if m.rol == "Líder"), None)
            queue_message(db, "documento_por_vencer", team, doc.member or lider, extra=extra)

    pendientes = select(Team).where(Team.estado.in_([S_ACT, S_ESP, S_FIJO, S_RIESGO]), Team.renovacion_confirmada.is_(False),
                                    Team.renovacion_limite.is_not(None))
    for team in db.scalars(pendientes):
        left = (team.renovacion_limite - today).days
        if left < 0:
            start_drop_alert(db, team, "Sistema", "No confirmó la renovación semestral")
            res["renovaciones"] += 1
        elif left == a2:  # un recordatorio antes de que venza el plazo
            queue_message(db, "renovacion", team, extra={"fecha_limite": fecha_larga(team.renovacion_limite)})

    log(db, "Sistema", "Revisión diaria: " + ", ".join(f"{k.replace('_', ' ')} {v}" for k, v in res.items()))
    return res


# ---------- renovación del semestre ----------

def renewal_dates(db: Session, year: int) -> list[date]:
    out = []
    for texto in cfg(db, "RENOVACION_FECHAS", []) or []:
        try:
            mes, dia = (int(x) for x in str(texto).split("-")[-2:])
            out.append(date(year, mes, dia))
        except (ValueError, TypeError):
            continue
    return sorted(out)


def renewal_due(db: Session, today: date) -> date | None:
    """La fecha de inicio de renovación que ya llegó y todavía no se ha corrido (con un mes de margen si el sistema estuvo apagado)."""
    if not cfg(db, "RENOVACION_AUTOMATICA", False):
        return None
    ultima = str(cfg(db, "RENOVACION_ULTIMA", "") or "")
    for d in renewal_dates(db, today.year):
        if d <= today and (today - d).days <= 30 and ultima < d.isoformat():
            return d
    return None


def next_renewal(db: Session) -> date | None:
    today = date.today()
    futuras = [d for d in renewal_dates(db, today.year) + renewal_dates(db, today.year + 1) if d > today]
    return futuras[0] if futuras else None


def start_renewal(db: Session, actor: str) -> int:
    """Manda a todos los equipos en operación a repetir el proceso: confirmar integrantes y volver a aceptar la carta.

    Tienen DIAS_RENOVACION días; quien no confirme entra en alerta de baja.
    """
    today = date.today()
    limite = today + timedelta(days=cfg(db, "DIAS_RENOVACION", 15))
    n = 0
    for team in db.scalars(select(Team).where(Team.estado.in_([S_ACT, S_ESP, S_FIJO, S_RIESGO]))):
        team.renovacion_confirmada, team.renovacion_limite = False, limite
        team.pausa_semanas_usadas = 0
        ensure_required_docs(db, team)
        for doc in db.scalars(select(Document).where(Document.team_id == team.id, Document.estado == "Validado")):
            if modo(db, doc.clave) == "firma":  # la carta se vuelve a aceptar cada semestre
                doc.estado, doc.vencimiento = "Faltante", None
        queue_message(db, "renovacion", team, extra={"fecha_limite": fecha_larga(limite)})
        n += 1
    set_cfg(db, "RENOVACION_ULTIMA", today.isoformat())
    log(db, "Sistema", f"Renovación semestral iniciada para {n} equipos (límite {limite.isoformat()})", actor=actor)
    return n


def confirm_renewal(db: Session, team: Team, actor: str = "Formulario de cambios") -> None:
    faltan = missing_docs(db, team)
    if faltan:
        raise ValueError("Antes de confirmar, completa: " + "; ".join(faltan) + ".")
    team.renovacion_confirmada = True
    log(db, "Cambio", f"Permanencia confirmada para {cfg(db, 'SEMESTRE', '')}", team, actor)
    # Si estaba en alerta solo por no haber confirmado, vuelve a donde estaba.
    if team.estado == S_ALERTA and recent_use(db, team):
        team.alerta_limite = None
        set_state(db, team, S_FIJO if team.space else S_ACT, actor, "Confirmó la renovación")


# ---------- cambios de integrantes, documentos y pausas ----------

def add_member(db: Session, team: Team, datos: dict, actor: str = "Formulario de cambios") -> Member:
    tipo = datos.get("tipo") or "Alumno"
    try:
        correo = check_person(db, datos.get("nombre", ""), datos.get("correo", ""), tipo)
    except ValueError as exc:
        raise ValueError(str(exc)[0].upper() + str(exc)[1:] + ".")
    m = Member(nombre=datos["nombre"].strip(), correo=correo, tipo=tipo, matricula=str(datos.get("matricula") or "").strip())
    team.members.append(m)
    db.flush()
    ensure_required_docs(db, team)
    log(db, "Cambio", f"Alta de integrante: {m.nombre}", team, actor)
    if team.estado in EN_OPERACION:
        m.access = Access()
        db.flush()
        upsert_task(db, "Alta de acceso", R_ACC, f"Dar de alta el acceso de {m.nombre} ({team.nombre})", team, m, vence=date.today() + timedelta(days=3))
    return m


def remove_member(db: Session, member: Member, actor: str = "Formulario de cambios") -> None:
    member.activo = False
    log(db, "Cambio", f"Baja de integrante: {member.nombre}", member.team, actor)
    for tipo in ("Alta de acceso", "Renovar acceso", "Validar documento", "Documento vencido"):
        close_tasks(db, tipo, member.team, member, actor)
    if member.access and member.access.estado == "Activo":
        upsert_task(db, "Revocar acceso", R_ACC, f"Revocar el acceso de {member.nombre} ({member.team.nombre})", member.team, member,
                    vence=date.today() + timedelta(days=2))
    elif member.access and member.access.estado in ("Pendiente", "Vencido"):
        member.access.estado = "Revocado"


def approve_pause(db: Session, team: Team, semanas: int, actor: str) -> str | None:
    maximo = cfg(db, "MAX_SEMANAS_PAUSA", 2)
    if not 1 <= semanas <= maximo:
        return f"La pausa debe ser de 1 a {maximo} semanas."
    if team.pausa_semanas_usadas + semanas > maximo:
        return f"El equipo ya usó {team.pausa_semanas_usadas} de {maximo} semanas de pausa este semestre."
    team.pausa_semanas_usadas += semanas
    team.pausa_desde = monday(date.today())
    team.pausa_hasta = team.pausa_desde + timedelta(days=7 * semanas - 1)
    log(db, "Estado", f"Pausa justificada de {semanas} semana(s), hasta {team.pausa_hasta.isoformat()}", team, actor)
    close_tasks(db, "Aprobar pausa", team, actor=actor)
    return None


def request_change(db: Session, team: Team, tipo: str, datos: dict, files: dict[str, tuple[str, bytes]]) -> ChangeRequest:
    permitido = formularios(db)["cambios"]
    if (tipo, False) in [("Alta de integrante", permitido["permitir_altas"]), ("Baja de integrante", permitido["permitir_bajas"]),
                         ("Pausa", permitido["permitir_pausa"])]:
        raise ValueError("Ese trámite no está disponible por formulario; escribe al equipo del coworking.")
    if not isinstance(datos, dict):
        raise ValueError("Datos incompletos.")
    req = ChangeRequest(ts=datetime.now(), team_id=team.id, tipo=tipo, datos=datos, estado="Aplicado")
    if tipo == "Alta de integrante":
        m = add_member(db, team, datos)
        req.detalle = f"{m.nombre} · {m.correo}"
    elif tipo == "Baja de integrante":
        try:
            m = db.get(Member, int(datos["member_id"]))
        except (KeyError, TypeError, ValueError):
            m = None
        if m is None or m.team_id != team.id or m.rol == "Líder" or not m.activo:
            raise ValueError("No se puede dar de baja a ese integrante desde el formulario.")
        remove_member(db, m)
        req.detalle = m.nombre
    elif tipo == "Documento":
        nombres = []
        for filename, content in files.values():
            check_upload(filename, content)
        for key, (filename, content) in files.items():
            doc = db.get(Document, int(key)) if str(key).isdigit() else None
            if doc and doc.team_id == team.id and content:
                attach_document(db, doc, archivo=save_upload(team, filename, content))
                nombres.append(doc.nombre)
        firmas = datos.get("firmas") if isinstance(datos.get("firmas"), dict) else {}
        for key, nombre in firmas.items():
            doc = db.get(Document, int(key)) if str(key).isdigit() else None
            if doc and doc.team_id == team.id and str(nombre).strip() and modo(db, doc.clave) == "firma":
                sign_document(db, doc, str(nombre))
                nombres.append(doc.nombre)
        if not nombres:
            raise ValueError("No se recibió ningún documento.")
        req.detalle = "; ".join(nombres)
        db.flush()
        check_docs_complete(db, team)
    elif tipo == "Pausa":
        maximo = cfg(db, "MAX_SEMANAS_PAUSA", 2)
        disponibles = maximo - team.pausa_semanas_usadas
        if disponibles < 1:
            raise ValueError(f"Tu equipo ya usó sus {maximo} semanas de pausa de este semestre.")
        try:
            semanas = int(datos.get("semanas", 1))
        except (TypeError, ValueError):
            semanas = 1
        semanas = max(1, min(semanas, disponibles))
        req.estado, req.datos = "Pendiente", {**datos, "semanas": semanas}
        req.detalle = f"{semanas} semana(s) · {datos.get('motivo', '')}"
        upsert_task(db, "Aprobar pausa", R_ADMIN, f"{team.nombre} pide pausa de {semanas} semana(s)", team, detalle=str(datos.get("motivo", ""))[:500])
    elif tipo == "Renovación":
        confirm_renewal(db, team)
        req.detalle = f"Permanencia confirmada para {cfg(db, 'SEMESTRE', '')}"
    else:
        raise ValueError("Tipo de cambio desconocido.")
    db.add(req)
    return req
