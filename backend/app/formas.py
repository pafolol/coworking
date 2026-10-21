"""Campos de formulario configurables: los usan los formularios propios (editor) y las preguntas extra de la solicitud.

Un campo es {id, etiqueta, tipo, ayuda, obligatoria, opciones, texto}. Las respuestas se guardan como
[{id, etiqueta, tipo, valor}]; en un archivo, el valor es la ruta dentro de uploads/.
"""
import re
import secrets
import shutil
from datetime import date, datetime
from io import BytesIO

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import difusion
from . import services as sv
from .db import UPLOADS
from .mailer import links, log, queue_message
from .models import CustomForm, FormResponse, Member

TIPOS = {
    "texto": "Texto corto", "parrafo": "Texto largo", "numero": "Número", "fecha": "Fecha", "correo": "Correo", "telefono": "Teléfono",
    "opcion": "Lista desplegable", "unica": "Una opción", "varias": "Varias opciones", "casilla": "Casilla (sí / no)",
    "archivo": "Archivo (PDF o imagen)", "firma": "Firma (leer y aceptar)", "seccion": "Título de sección",
}
CON_OPCIONES = ("opcion", "unica", "varias")
SIN_RESPUESTA = ("seccion",)

ASUNTO = "{{titulo_formulario}} · {{coworking}}"
MENSAJE = ("Hola {{nombre}}:\n\nNecesitamos que llenes el formulario «{{titulo_formulario}}». Te toma unos minutos:\n\n"
           "{{enlace_formulario}}\n\nEl enlace es personal; no lo compartas.\n\nGracias,\nEquipo de {{coworking}}")


def clean_fields(campos) -> list[dict]:
    """Normaliza lo que manda el editor: tipos conocidos, ids únicos y sin preguntas vacías."""
    out, ids = [], set()
    for c in campos if isinstance(campos, list) else []:
        if not isinstance(c, dict):
            continue
        tipo = c.get("tipo") if c.get("tipo") in TIPOS else "texto"
        etiqueta = str(c.get("etiqueta") or "").strip()[:300]
        if not etiqueta:
            continue
        cid = re.sub(r"[^\w\-]", "", str(c.get("id") or ""))[:40] or f"c{secrets.token_hex(3)}"
        while cid in ids:
            cid = f"c{secrets.token_hex(3)}"
        ids.add(cid)
        opciones = [str(o).strip()[:200] for o in c.get("opciones") or [] if str(o).strip()] if tipo in CON_OPCIONES else []
        if tipo in CON_OPCIONES and not opciones:
            raise ValueError(f"La pregunta «{etiqueta}» es de opciones pero no tiene opciones.")
        out.append({"id": cid, "etiqueta": etiqueta, "tipo": tipo, "ayuda": str(c.get("ayuda") or "").strip()[:500],
                    "obligatoria": bool(c.get("obligatoria")) and tipo not in SIN_RESPUESTA, "opciones": opciones,
                    "texto": str(c.get("texto") or "")[:20000] if tipo in ("firma", "seccion") else ""})
    return out


def collect(campos: list[dict], dadas: dict, files: dict[str, tuple[str, bytes]]) -> tuple[list[dict], dict[str, tuple[str, bytes]]]:
    """Valida las respuestas contra los campos. Devuelve (respuestas, archivos por guardar {id: (nombre, contenido)}).

    Lanza ValueError con el primer problema. Los archivos se validan aquí pero los guarda quien llama,
    porque su carpeta depende de a qué se adjuntan.
    """
    dadas = dadas if isinstance(dadas, dict) else {}
    out, pendientes = [], {}
    for c in campos:
        tipo, cid = c["tipo"], c["id"]
        if tipo in SIN_RESPUESTA:
            continue
        valor = dadas.get(cid)
        if tipo == "archivo":
            archivo = files.get(f"pregunta:{cid}") or files.get(cid)
            if archivo:
                sv.check_upload(*archivo)
                pendientes[cid] = archivo
                valor = archivo[0]
            else:
                valor = None
        elif tipo == "firma":
            firma = valor if isinstance(valor, dict) else {}
            nombre = str(firma.get("nombre") or "").strip()[:190]
            if (firma.get("acepta") or nombre) and not (firma.get("acepta") and nombre):
                raise ValueError(f"Para firmar «{c['etiqueta']}» marca que aceptas y escribe tu nombre completo.")
            valor = f"Aceptado por {nombre} el {date.today().strftime('%d/%m/%Y')}" if nombre else None
        elif tipo == "casilla":
            valor = "Sí" if valor is True else None
        elif tipo == "varias":
            elegidas = [str(v) for v in valor] if isinstance(valor, list) else []
            if any(v not in (c.get("opciones") or []) for v in elegidas):
                raise ValueError(f"Elige opciones válidas en «{c['etiqueta']}».")
            valor = ", ".join(elegidas) or None
        else:
            valor = str(valor).strip()[:5000] if valor not in (None, False) else ""
            valor = valor or None
            if valor and tipo in ("opcion", "unica") and valor not in (c.get("opciones") or []):
                raise ValueError(f"Elige una opción válida en «{c['etiqueta']}».")
            if valor and tipo == "correo" and not sv.EMAIL_RE.match(valor.lower()):
                raise ValueError(f"El correo de «{c['etiqueta']}» no es válido.")
            if valor and tipo == "numero":
                try:
                    float(valor.replace(",", ""))
                except ValueError:
                    raise ValueError(f"«{c['etiqueta']}» debe ser un número.")
            if valor and tipo == "fecha":
                try:
                    valor = date.fromisoformat(valor).isoformat()
                except ValueError:
                    raise ValueError(f"La fecha de «{c['etiqueta']}» no es válida.")
        if valor is None:
            if c.get("obligatoria"):
                raise ValueError(f"Falta responder: {c['etiqueta']}")
            continue
        out.append({"id": cid, "etiqueta": c["etiqueta"], "tipo": tipo, "valor": valor})
    return out, pendientes


def save_files(respuestas: list[dict], pendientes: dict[str, tuple[str, bytes]], carpeta: str) -> None:
    """Guarda los archivos validados en uploads/<carpeta>/ y pone su ruta como valor de la respuesta."""
    destino = UPLOADS / carpeta
    destino.mkdir(parents=True, exist_ok=True)
    for r in respuestas:
        if r["id"] in pendientes:
            filename, content = pendientes[r["id"]]
            ext = sv.check_upload(filename, content)
            stem = re.sub(r"[^\w\-]+", "_", filename.rsplit(".", 1)[0])[-60:] or "archivo"
            nombre = f"{secrets.token_hex(4)}_{stem}{ext}"
            (destino / nombre).write_bytes(content)
            r["valor"] = f"{carpeta}/{nombre}"


# ---------- formularios propios ----------

def public_url(db: Session, form: CustomForm, token: str = "") -> str:
    base = links(db)["solicitud"].rsplit("/f/", 1)[0]
    return f"{base}/formulario/{form.slug}" + (f"?t={token}" if token else "")


def form_row(db: Session, f: CustomForm) -> dict:
    estados = [e for (e,) in db.execute(select(FormResponse.estado).where(FormResponse.form_id == f.id))]
    return {"id": f.id, "slug": f.slug, "titulo": f.titulo, "intro": f.intro, "campos": f.campos or [], "boton": f.boton,
            "mensaje_final": f.mensaje_final, "color": f.color, "abierto": f.abierto, "activo": f.activo,
            "asunto": f.asunto or ASUNTO, "mensaje": f.mensaje or MENSAJE, "creado": f.creado, "url": public_url(db, f),
            "pendientes": estados.count("Pendiente"), "respondidos": estados.count("Respondido")}


def apply_fields(f: CustomForm, payload: dict) -> None:
    if "titulo" in payload:
        f.titulo = str(payload["titulo"] or "").strip()[:160]
    if "campos" in payload:
        f.campos = clean_fields(payload["campos"])
    for campo, largo in (("intro", 5000), ("mensaje_final", 3000), ("boton", 80), ("asunto", 300), ("mensaje", 10000)):
        if campo in payload:
            setattr(f, campo, str(payload[campo] or "").strip()[:largo])
    if "color" in payload:
        color = str(payload["color"] or "").strip()
        f.color = color if re.fullmatch(r"#[0-9a-fA-F]{6}", color) else ""
    for campo in ("abierto", "activo"):
        if campo in payload:
            setattr(f, campo, bool(payload[campo]))
    if not f.titulo:
        raise ValueError("Ponle un título al formulario.")


def invite(db: Session, f: CustomForm, filtro: dict | None, asunto: str, mensaje: str, actor: str, correos: list[str] | None = None) -> int:
    """Un enlace personal por persona del filtro (o por correo suelto) y su correo. A quien ya tiene uno pendiente se le reenvía el mismo."""
    if not f.activo:
        raise ValueError("El formulario está pausado: actívalo antes de enviarlo.")
    if not any(c["tipo"] not in SIN_RESPUESTA for c in f.campos or []):
        raise ValueError("El formulario no tiene preguntas.")
    destinos: list[tuple[str, str, Member | None]] = [(m.correo, m.nombre, m) for m in difusion.recipients(db, filtro)] if filtro else []
    vistos = {d[0].lower() for d in destinos}
    for correo in correos or []:
        correo = str(correo).strip().lower()
        if not correo:
            continue
        if not sv.EMAIL_RE.match(correo):
            raise ValueError(f"El correo «{correo}» no es válido.")
        if correo not in vistos:
            vistos.add(correo)
            m = sv.email_owner(db, correo)
            destinos.append((correo, m.nombre if m else "", m))
    if not destinos:
        raise ValueError("Nadie recibe este envío: elige personas o escribe correos.")
    texto = {"nombre": f"Formulario: {f.titulo}"[:80], "asunto": (asunto or ASUNTO)[:300], "cuerpo": mensaje or MENSAJE}
    for correo, nombre, m in destinos:
        r = db.scalar(select(FormResponse).where(FormResponse.form_id == f.id, FormResponse.correo == correo.lower(), FormResponse.estado == "Pendiente"))
        if r is None:
            r = FormResponse(form_id=f.id, token=secrets.token_urlsafe(18), correo=correo.lower(), nombre=nombre, creado=datetime.now(),
                             team_id=m.team_id if m else None, member_id=m.id if m else None)
            db.add(r)
            db.flush()
        extra = {"titulo_formulario": f.titulo, "enlace_formulario": public_url(db, f, r.token),
                 "nombre": nombre.split(" ")[0] if nombre else correo.split("@")[0]}
        queue_message(db, "formulario", team=m.team if m else None, member=m, para=correo, extra=extra, texto=texto)
    log(db, "Correo", f"Formulario «{f.titulo}» enviado a {len(destinos)} persona(s)", actor=actor)
    return len(destinos)


def submit(db: Session, f: CustomForm, token: str, datos: dict, files: dict[str, tuple[str, bytes]]) -> FormResponse:
    if not f.activo:
        raise ValueError("Este formulario ya no recibe respuestas.")
    r = db.scalar(select(FormResponse).where(FormResponse.form_id == f.id, FormResponse.token == token)) if token else None
    if token and r is None:
        raise ValueError("El enlace no es válido. Pide que te lo vuelvan a enviar.")
    if r is not None and r.estado == "Respondido":
        raise ValueError("Ya respondiste este formulario. Si necesitas corregir algo, escríbenos.")
    if r is None:
        if not f.abierto:
            raise ValueError("Este formulario solo se llena desde el enlace personal que te enviamos por correo.")
        nombre, correo = str(datos.get("nombre") or "").strip()[:160], str(datos.get("correo") or "").strip().lower()
        if not nombre or not sv.EMAIL_RE.match(correo):
            raise ValueError("Escribe tu nombre y un correo válido.")
        m = sv.email_owner(db, correo)
        r = FormResponse(form_id=f.id, token=secrets.token_urlsafe(18), correo=correo, nombre=nombre, creado=datetime.now(),
                         team_id=m.team_id if m else None, member_id=m.id if m else None)
        db.add(r)
        db.flush()
    respuestas, pendientes = collect(f.campos or [], datos.get("respuestas"), files)
    save_files(respuestas, pendientes, f"formularios/{f.id}/{r.id}")
    r.respuestas, r.estado, r.respondido = respuestas, "Respondido", datetime.now()
    log(db, "Cambio", f"Respondió el formulario «{f.titulo}»: {r.nombre or r.correo}", r.team)
    return r


def response_row(r: FormResponse) -> dict:
    return {"id": r.id, "correo": r.correo, "nombre": r.nombre, "estado": r.estado, "creado": r.creado, "respondido": r.respondido,
            "equipo": {"id": r.team.id, "nombre": r.team.nombre} if r.team else None, "respuestas": r.respuestas or []}


def remove_files(form_id: int, response_id: int | None = None) -> None:
    carpeta = UPLOADS / "formularios" / str(form_id) / (str(response_id) if response_id else "")
    shutil.rmtree(carpeta, ignore_errors=True)


def export_xlsx(db: Session, f: CustomForm) -> bytes:
    from openpyxl import Workbook
    campos = [c for c in f.campos or [] if c["tipo"] not in SIN_RESPUESTA]
    book = Workbook()
    hoja = book.active
    hoja.title = "Respuestas"
    hoja.append(["Nombre", "Correo", "Equipo", "Estado", "Respondido"] + [c["etiqueta"][:200] for c in campos])
    for r in db.scalars(select(FormResponse).where(FormResponse.form_id == f.id).order_by(FormResponse.respondido.desc(), FormResponse.id)):
        valores = {x["id"]: x["valor"] for x in r.respuestas or []}
        hoja.append([r.nombre, r.correo, r.team.nombre if r.team else "", r.estado, r.respondido.strftime("%Y-%m-%d %H:%M") if r.respondido else ""]
                    + [("(archivo) " + str(valores[c["id"]]).rsplit("/", 1)[-1].split("_", 1)[-1]) if c["tipo"] == "archivo" and c["id"] in valores
                       else valores.get(c["id"], "") for c in campos])
    out = BytesIO()
    book.save(out)
    return out.getvalue()
