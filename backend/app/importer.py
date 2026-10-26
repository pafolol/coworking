"""Carga masiva de solicitudes y equipos desde cualquier Excel o CSV (por ejemplo, la exportación de un formulario).

Cada equipo nuevo entra como solicitud por evaluar, salvo que el archivo diga que ya se decidió (columna de decisión
o un estado en operación). Lo que ya está registrado o viene repetido se aparta y no cuenta como error.

El archivo se lee aquí mismo. A la IA solo se le mandan los NOMBRES de las columnas para que diga a qué campo
corresponde cada una; los datos de las personas nunca salen del servidor.
"""
import csv
import io
import json
import os
import re
import unicodedata
from datetime import date, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import services as sv
from .mailer import log
from .models import EN_OPERACION, S_ACT, S_BAJA, S_ESP, S_EVA, S_FIJO, S_NO, S_RIESGO, Access, Member, Team

COLUMNAS = ["equipo", "estado", "espacio", "fecha_ingreso", "sector", "etapa", "descripcion",
            "nombre", "correo", "tipo", "matricula", "lider", "acceso_vence"]
DE_EQUIPO = ("equipo", "estado", "decision", "espacio", "fecha_ingreso", "sector", "etapa", "descripcion")
DE_PERSONA = ("nombre", "correo", "tipo", "matricula", "lider", "acceso_vence")
# Además de las columnas de la plantilla: la decisión (aceptado o no), preguntas extra del formulario que se guardan
# como respuestas de la solicitud, una celda con varios integrantes juntos, o una columna que no se usa.
CAMPOS = COLUMNAS + ["decision", "respuesta", "integrantes_lista", "ignorar"]

EJEMPLO = [
    ["Equipo Ejemplo", "Espacio fijo", "5", "2026-08-17", "Fintech", "MVP", "Pagos para tienditas", "Ana López Ruiz", "ana.lopez@tec.mx", "Alumno", "A01234567", "sí", "2027-01-31"],
    ["Equipo Ejemplo", "", "", "", "", "", "", "Luis Pérez", "luis.perez@correo.mx", "Externo", "", "", "2027-01-31"],
    ["Otro Equipo", "Coworking", "", "2026-09-01", "Salud", "Idea", "", "María Díaz", "maria.diaz@tec.mx", "Colaborador", "L00123456", "sí", ""],
]

ALIAS = {
    "equipo": "equipo", "proyecto": "equipo", "nombre_del_equipo": "equipo", "nombre_equipo": "equipo", "team": "equipo", "startup": "equipo",
    "nombre_del_proyecto": "equipo", "emprendimiento": "equipo",
    "estado": "estado", "modalidad": "estado", "estatus": "estado", "status": "estado",
    "espacio": "espacio", "lugar": "espacio", "espacio_asignado": "espacio", "numero_de_espacio": "espacio", "mesa": "espacio",
    "fecha_ingreso": "fecha_ingreso", "fecha_de_ingreso": "fecha_ingreso", "fecha_alta": "fecha_ingreso", "fecha_de_alta": "fecha_ingreso", "ingreso": "fecha_ingreso",
    "sector": "sector", "industria": "sector", "giro": "sector", "etapa": "etapa",
    "descripcion": "descripcion", "descripcion_del_proyecto": "descripcion",
    "nombre": "nombre", "integrante": "nombre", "persona": "nombre", "nombre_completo": "nombre", "nombre_del_integrante": "nombre",
    "correo": "correo", "email": "correo", "e_mail": "correo", "mail": "correo", "correo_electronico": "correo",
    "tipo": "tipo", "tipo_de_integrante": "tipo",
    "matricula": "matricula", "nomina": "matricula", "matricula_o_nomina": "matricula",
    "lider": "lider", "es_lider": "lider",
    "acceso_vence": "acceso_vence", "vencimiento": "acceso_vence", "vencimiento_acceso": "acceso_vence", "vence": "acceso_vence",
    "vencimiento_del_acceso": "acceso_vence",
    "decision": "decision", "aceptado": "decision", "aceptada": "decision", "resultado": "decision", "dictamen": "decision",
    "telefono": "respuesta", "celular": "respuesta", "carrera": "respuesta", "redes_sociales": "respuesta", "red_social": "respuesta",
}

CORREO_RE = re.compile(r"[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+")


def norm(text) -> str:
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().strip().lower()
    return "_".join(re.sub(r"[^\w\s]", " ", text).split())


def template_csv() -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(COLUMNAS)
    writer.writerows(EJEMPLO)
    return "﻿" + out.getvalue()  # BOM: Excel lo abre con acentos


def ai_available() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


# ---------- lectura del archivo (local) ----------

def cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def header_score(fila: list[str]) -> int:
    """Cuántas celdas parecen títulos de columna: texto, sin ser solo números o fechas ni un correo."""
    return sum(1 for c in fila if c and not re.fullmatch(r"[\d\s./:\-]+", c) and "@" not in c)


def read_sheets(filename: str, content: bytes) -> list[dict]:
    """Las hojas del archivo como tablas de texto: [{hoja, encabezados, filas}]."""
    tablas: list[tuple[str, list[list[str]]]] = []
    if filename.lower().endswith(".xls"):
        raise ValueError("Los archivos .xls antiguos no se pueden leer: guárdalo como Excel (.xlsx) o CSV.")
    if filename.lower().endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        book = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        for sheet in book.worksheets:
            tablas.append((sheet.title, [[cell(c) for c in row] for row in sheet.iter_rows(values_only=True)]))
    else:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1")
        lineas = text.splitlines()[:20]  # un título suelto en la primera línea no debe decidir el separador
        delimiter = max(",;\t", key=lambda d: max((l.count(d) for l in lineas), default=0))
        tablas.append(("Hoja 1", [[c.strip() for c in row] for row in csv.reader(io.StringIO(text), delimiter=delimiter)]))

    hojas = []
    for nombre, tabla in tablas:
        tabla = [fila for fila in tabla if any(fila)]
        if len(tabla) < 2:
            continue
        # El encabezado es, entre las primeras filas, la que más celdas de texto tiene (así se saltan títulos sueltos).
        idx = max(range(min(len(tabla) - 1, 15)), key=lambda i: (header_score(tabla[i]), -i))
        ancho = max(len(f) for f in tabla[idx:])
        encabezados = [tabla[idx][i] if i < len(tabla[idx]) and tabla[idx][i] else f"Columna {i + 1}" for i in range(ancho)]
        filas = [fila + [""] * (ancho - len(fila)) for fila in tabla[idx + 1:]]
        usadas = [i for i in range(ancho) if any(f[i] for f in filas)]  # las columnas vacías no se muestran ni se mapean
        vistos: dict[str, int] = {}
        unicos = []
        for i in usadas:  # dos columnas con el mismo título (p. ej. «Nombre» de dos integrantes) se distinguen para mapearlas por separado
            e = encabezados[i]
            vistos[e] = vistos.get(e, 0) + 1
            unicos.append(e if vistos[e] == 1 else f"{e} ({vistos[e]})")
        hojas.append({"hoja": nombre, "encabezados": unicos, "filas": [[f[i] for i in usadas] for f in filas]})
    if not hojas:
        raise ValueError("El archivo no tiene una tabla con datos.")
    return hojas


# ---------- mapeo de columnas ----------

def local_map(encabezados: list[str]) -> list[dict]:
    """Mapeo por nombres conocidos, sin IA."""
    out, usados = [], set()
    for h in encabezados:
        campo = ALIAS.get(norm(h), "ignorar")
        if campo in usados:
            campo = "ignorar"
        if campo != "ignorar":
            usados.add(campo)
        out.append({"columna": h, "campo": campo, "persona": 1, "es_lider": False})
    return out


INSTRUCCIONES_IA = """Recibes SOLO los nombres de las columnas de una hoja de cálculo con equipos e integrantes de un coworking (no verás los datos).
Di a qué campo corresponde cada columna. Devuelve SOLO un JSON así:
{"hojas": [{"hoja": "<nombre>", "usar": true, "columnas": [{"columna": "<nombre exacto>", "campo": "<campo>", "persona": 1, "es_lider": false}]}],
 "notas": ["..."]}

Campos permitidos:
- Del equipo: "equipo" (nombre del equipo, idea, proyecto, startup o empresa), "estado" (modalidad o estatus en el coworking),
  "decision" (si la solicitud fue aceptada, aprobada, seleccionada o rechazada; también «resultado» o «dictamen»),
  "espacio" (número de lugar, mesa o escritorio asignado), "fecha_ingreso" (fecha de ingreso; si no hay, la fecha en que se envió
  la solicitud, como «Submit Date»), "sector" (giro o industria), "etapa", "descripcion" (de qué trata el proyecto, p. ej. «Platícanos de tu proyecto»).
- De una persona: "nombre", "correo", "tipo" (cómo forma parte de la institución: alumno/estudiante, colaborador/profesor, Exatec/egresado o externo),
  "matricula" (matrícula o nómina), "lider" (columna que dice si es líder), "acceso_vence" (vencimiento de su acceso o credencial).
- "respuesta": otra pregunta del formulario que sirve para evaluar la solicitud (teléfono, redes sociales, logros, ventas, empleos, en qué necesita
  ayuda, qué aporta, mentorías, nivel académico, carrera…). Se guarda tal cual en la solicitud. Puede haber varias.
- "integrantes_lista": una columna donde vienen VARIAS personas juntas en la misma celda (por ejemplo «Otros integrantes», «Miembros», «Equipo de trabajo»).
- "ignorar": lo que no sirve para evaluar (identificadores internos, números consecutivos, aviso de privacidad, fechas de inicio, tipo de respuesta,
  columnas técnicas del formulario, totales).

Reglas:
- "persona" numera a las personas que vienen en la misma fila: si la hoja trae una persona por fila, siempre es 1. Si trae columnas para varias
  («Responsable», «Integrante 2», «Correo integrante 2»…), las columnas de cada una llevan el mismo número.
- "es_lider": true en las columnas de la persona que es líder, responsable, representante o fundador del equipo.
- Cada campo de equipo se usa una sola vez por hoja ("respuesta" puede repetirse). Cada campo de persona, una vez por número de persona.
- Si la hoja trae una persona por fila con su proyecto (como un formulario de solicitud), esa persona es la líder: "es_lider": true.
- "usar": false si la hoja no trae equipos ni personas vigentes (por ejemplo bajas, catálogos o instrucciones).
- Usa el nombre de cada columna EXACTAMENTE como se te dio.
- "notas": de 1 a 4 frases cortas en español sobre lo que supusiste o no pudiste determinar.
- Si el usuario da indicaciones, tienen prioridad."""


def clean_spec(columna: str, spec: dict) -> dict:
    campo = spec.get("campo") if spec.get("campo") in CAMPOS else "ignorar"
    try:
        persona = max(1, min(int(spec.get("persona") or 1), 30))
    except (TypeError, ValueError):
        persona = 1
    es_persona = campo in DE_PERSONA
    return {"columna": columna, "campo": campo, "persona": persona if es_persona else 1, "es_lider": bool(spec.get("es_lider")) and es_persona}


def ai_map(hojas: list[dict], instrucciones: str = "") -> tuple[dict[str, list[dict]], list[str], set[str]]:
    """Pide a la IA el mapeo usando solo los nombres de las columnas. Devuelve (mapa por hoja, notas, hojas descartadas)."""
    def seguro(c: str, i: int) -> str:  # un «encabezado» que en realidad es un dato (correo, número, texto largo) no sale del servidor
        return f"Columna {i + 1}" if "@" in c or len(c) > 160 or re.fullmatch(r"[\d\s./:\-+]+", c) else c
    enviados = {h["hoja"]: [seguro(c, i) for i, c in enumerate(h["encabezados"])] for h in hojas}
    entrada = {"hojas": [{"hoja": h["hoja"], "columnas": enviados[h["hoja"]]} for h in hojas]}
    mensajes = [{"role": "system", "content": INSTRUCCIONES_IA}, {"role": "user", "content": json.dumps(entrada, ensure_ascii=False)}]
    if instrucciones.strip():
        mensajes.append({"role": "user", "content": "Indicaciones del usuario (tienen prioridad):\n" + instrucciones.strip()[:3000]})
    try:
        r = httpx.post("https://api.openai.com/v1/chat/completions", timeout=120,
                       headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
                       json={"model": os.environ.get("OPENAI_MODEL", "gpt-5.6-luna"), "messages": mensajes, "response_format": {"type": "json_object"}})
    except httpx.HTTPError as exc:
        raise ValueError(f"No se pudo conectar con OpenAI ({type(exc).__name__}).")
    if r.status_code != 200:
        try:
            detalle = (r.json().get("error") or {}).get("message", "")
        except ValueError:
            detalle = ""
        raise ValueError(f"OpenAI respondió {r.status_code}: {detalle[:200] or 'sin detalle'}")
    try:
        data = json.loads(r.json()["choices"][0]["message"]["content"])
        respuesta = {str(h.get("hoja")): h for h in data.get("hojas") or [] if isinstance(h, dict)}
    except (KeyError, IndexError, TypeError, AttributeError, json.JSONDecodeError):
        raise ValueError("La IA no devolvió un mapeo válido.")
    mapa, descartadas = {}, set()
    for h in hojas:
        dada = respuesta.get(h["hoja"]) or {}
        por_nombre = {str(c.get("columna")): c for c in dada.get("columnas") or [] if isinstance(c, dict)}
        mapa[h["hoja"]] = [clean_spec(col, por_nombre.get(env) or {}) for col, env in zip(h["encabezados"], enviados[h["hoja"]])]
        if dada.get("usar") is False:
            descartadas.add(h["hoja"])
    return mapa, [str(n) for n in (data.get("notas") or [])][:6], descartadas


# ---------- aplicar el mapeo a los datos (local) ----------

def split_people(texto: str) -> list[dict]:
    """«Iván Paredes - ivan@x.mx; Carla Méndez (externa) - carla@y.mx» → una persona por pedazo."""
    out = []
    for pedazo in re.split(r"[;\n|]+|\s/\s", texto):
        pedazo = pedazo.strip()
        if not pedazo:
            continue
        correo = CORREO_RE.search(pedazo)
        nombre = CORREO_RE.sub("", pedazo)
        externo = bool(re.search(r"extern", nombre, re.I))
        nombre = re.sub(r"\(.*?\)|sin correo|s/c", "", nombre, flags=re.I).strip(" -–—:,<>·\t")
        if nombre or correo:
            out.append({"nombre": nombre, "correo": correo.group(0).lower() if correo else "", "tipo": "Externo" if externo else ""})
    return out


def apply_map(hojas: list[dict], mapa: dict[str, list[dict]], descartadas: set[str] = frozenset()) -> list[dict]:
    """Convierte las filas del archivo en una fila por persona, con las columnas de la plantilla."""
    filas, n = [], 0
    for h in hojas:
        specs = mapa.get(h["hoja"]) or []
        if h["hoja"] in descartadas or not any(s["campo"] in ("nombre", "correo", "integrantes_lista") for s in specs):
            continue
        ultimo_equipo: dict = {}
        for fila in h["filas"]:
            equipo: dict = {}
            personas: dict[int, dict] = {}
            lista: list[dict] = []
            respuestas: list[dict] = []
            for valor, spec in zip(fila, specs):
                campo = spec["campo"]
                if campo == "ignorar" or not valor:
                    continue
                if campo == "respuesta":
                    respuestas.append({"etiqueta": spec["columna"][:200], "valor": valor[:2000]})
                elif campo in DE_EQUIPO:
                    equipo.setdefault(campo, valor)
                elif campo == "integrantes_lista":
                    lista += split_people(valor)
                else:
                    p = personas.setdefault(spec["persona"], {})
                    p.setdefault(campo, valor)
                    if spec["es_lider"] and campo != "lider":  # la columna «¿Es líder?» trae su propio sí/no
                        p["lider"] = "sí"
            gente = [p for _, p in sorted(personas.items()) if p.get("nombre") or p.get("correo")] + lista
            if not gente:
                continue  # títulos, totales y filas sin personas
            # Celdas combinadas: si la fila no repite el equipo, es el de la fila anterior.
            if equipo.get("equipo"):
                ultimo_equipo = equipo = {**equipo, "respuestas": respuestas}
            else:
                equipo = {**ultimo_equipo, **equipo}
            # Un vencimiento dado una sola vez en la fila vale para todas las personas de esa fila.
            vencimientos = [p["acceso_vence"] for p in gente if p.get("acceso_vence")]
            for p in gente:
                n += 1
                if len(vencimientos) == 1:
                    p.setdefault("acceso_vence", vencimientos[0])
                filas.append({"fila": n, **{c: equipo.get(c, "") for c in DE_EQUIPO}, **{c: p.get(c, "") for c in DE_PERSONA},
                              "respuestas": equipo.get("respuestas") or respuestas})
    return filas


def with_samples(hojas: list[dict], mapa: dict[str, list[dict]], descartadas: set[str]) -> list[dict]:
    """El mapeo listo para mostrarse, con un valor de ejemplo por columna (se lee del archivo aquí; no se manda a la IA)."""
    out = []
    for h in hojas:
        columnas = []
        for i, spec in enumerate(mapa.get(h["hoja"]) or []):
            ejemplo = next((f[i] for f in h["filas"] if f[i]), "")
            columnas.append({**spec, "ejemplo": ejemplo[:60]})
        out.append({"hoja": h["hoja"], "usar": h["hoja"] not in descartadas, "filas": len(h["filas"]), "columnas": columnas})
    return out


def arrange(filename: str, content: bytes, instrucciones: str = "", mapa_manual: list[dict] | None = None) -> dict:
    """Lee el archivo y decide el mapeo: el que ajustó el usuario, el de nombres conocidos, o el de la IA."""
    hojas = read_sheets(filename, content)
    notas: list[str] = []
    descartadas: set[str] = set()
    if mapa_manual is not None:
        dado = {str(h.get("hoja")): h for h in mapa_manual if isinstance(h, dict)}
        mapa = {}
        for h in hojas:
            hoja = dado.get(h["hoja"]) or {}
            por_nombre = {str(c.get("columna")): c for c in hoja.get("columnas") or [] if isinstance(c, dict)}
            mapa[h["hoja"]] = [clean_spec(col, por_nombre.get(col) or {}) for col in h["encabezados"]]
            if hoja.get("usar") is False:
                descartadas.add(h["hoja"])
        modo = "manual"
    else:
        mapa = {h["hoja"]: local_map(h["encabezados"]) for h in hojas}
        completo = all(not any(s["campo"] == "ignorar" for s in specs) for specs in mapa.values())
        basico = any({"equipo", "nombre", "correo"} <= {s["campo"] for s in specs} for specs in mapa.values())
        if completo and basico and not instrucciones.strip():
            modo = "plantilla"
        elif ai_available():
            try:
                mapa, notas, descartadas = ai_map(hojas, instrucciones)
                modo = "ia"
            except ValueError as exc:  # sin IA no se pierde el archivo: queda el mapeo por nombres para ajustarlo a mano
                modo = "local"
                notas.append(f"{exc} Se reconocieron las columnas con nombres conocidos; ajusta las demás a mano.")
        else:
            modo = "local"
            notas.append("El acomodo automático está apagado: se reconocieron las columnas con nombres conocidos. Ajusta las demás a mano.")
    return {"hojas": hojas, "mapa": mapa, "descartadas": descartadas, "notas": notas, "modo": modo}


# ---------- validación y carga ----------

def parse_date(value) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = (str(value).split() or [""])[0].split("T")[0]  # «17/08/2026 10:30» y «2026-08-17T00:00:00» traen hora
    if re.fullmatch(r"\d{5}(\.0+)?", text) and 20000 <= int(text[:5]) <= 80000:  # número de serie de Excel
        return date(1899, 12, 30) + timedelta(days=int(text[:5]))
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d.%m.%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"fecha «{value}» no reconocida (usa AAAA-MM-DD o DD/MM/AAAA)")


def parse_state(value) -> str | None:
    """Estado que trae el archivo; None si no trae (o dice que sigue en trámite)."""
    key = norm(value)
    if not key or any(x in key for x in ("solicitud", "pendiente", "evaluacion", "revision", "tramite", "proceso")):
        return None
    if key.startswith(("no_", "rechaz", "declin")) or key == "no":
        return S_NO
    if "fijo" in key:
        return S_FIJO
    if "espera" in key:
        return S_ESP
    if "riesgo" in key:
        return S_RIESGO
    if "cowork" in key or key.startswith(("activ", "acept", "vigente")) or key in ("acceso", "si"):
        return S_ACT
    raise ValueError(f"estado «{value}» no reconocido (usa Coworking, Espacio fijo, Lista de espera, En riesgo o Solicitud)")


def parse_decision(value) -> str | None:
    """«Aceptado», «No aceptado» o None (sin decisión: queda como solicitud por evaluar)."""
    key = norm(value)
    if not key:
        return None
    if key.startswith(("no", "rechaz", "declin", "deneg", "reject", "deni", "false")) or key == "0":
        return "No aceptado"
    if key in ("si", "s", "x", "1", "true", "yes", "ok") or key.startswith(("acept", "aprob", "admit", "selecc", "accept", "approv", "ganador")):
        return "Aceptado"
    return None


def parse_type(value) -> str | None:
    """Alumno, Colaborador, Exatec o Externo; None si no se indica o no se reconoce (se deduce por matrícula y correo)."""
    key = norm(value)
    if not key:
        return None
    if key.startswith(("alum", "estud")):
        return "Alumno"
    if key.startswith(("colab", "emple", "prof", "staff", "docen", "maestr")):
        return "Colaborador"
    if key.startswith(("exa", "egres", "ex_alum", "exalum")):
        return "Exatec"
    if key.startswith("ext") or key in ("no", "invitado", "ninguno", "ninguna"):
        return "Externo"
    return None


def clean_text(value, corto: bool = False) -> str:
    """Quita los escapes de los formularios («Startup \\| Tengo clientes»); en campos cortos deja solo lo de antes de «|»."""
    text = str(value or "").replace("\\|", "|").strip().removeprefix("'")  # el apóstrofo con que Excel marca un texto
    return text.split("|")[0].strip()[:60] if corto else text


def parse_space(value) -> int:
    numero = re.search(r"\d+", str(value))
    if not numero:
        raise ValueError(f"espacio «{value}» no es un número")
    return int(numero.group(0))


def build_plan(db: Session, rows: list[dict]) -> dict:
    """Valida todo sin escribir nada: qué solicitudes, equipos y personas se crearían, qué ya existía y qué tiene problema.

    Lo que ya está registrado o viene repetido en el archivo no es un error: se aparta en «duplicados» y no se importa.
    """
    existentes: dict[str, Team] = {}
    for t in db.scalars(select(Team).order_by(Team.id)):
        clave = norm(t.nombre)
        if clave not in existentes or existentes[clave].estado in (S_BAJA, S_NO):  # el vigente gana a uno cerrado
            existentes[clave] = t
    dominio = (sv.internal_domains(db) or [""])[0]
    equipos: dict[str, dict] = {}
    vistos: dict[str, str] = {}  # correo → equipo con el que ya viene en este archivo
    duplicados: list[dict] = []
    for row in rows:
        nombre_equipo = str(row.get("equipo") or "").strip()
        clave = norm(nombre_equipo)
        eq = equipos.get(clave)
        if eq is None:
            actual = existentes.get(clave) if clave else None
            eq = equipos[clave] = {"nombre": actual.nombre if actual else (nombre_equipo or "(sin equipo)"), "existe": actual is not None,
                                   "id": actual.id if actual else None, "estado": actual.estado if actual else None, "estado_dado": None,
                                   "decision": None, "espacio": None, "fecha_ingreso": None, "sector": "", "etapa": "", "descripcion": "",
                                   "respuestas": [], "errores": [], "avisos": [], "integrantes": []}
            if not clave:
                eq["errores"].append("Estas personas no traen equipo o proyecto.")
        persona = {"fila": row.get("fila"), "nombre": str(row.get("nombre") or "").strip(), "correo": str(row.get("correo") or "").strip().lower(),
                   "matricula": str(row.get("matricula") or "").strip(), "lider": norm(row.get("lider")) in ("si", "s", "x", "1", "true", "lider", "yes"),
                   "tipo": "Alumno", "tipo_supuesto": False, "acceso_vence": None, "ok": True, "nota": ""}
        correo = persona["correo"]

        def apartar(motivo: str) -> None:
            duplicados.append({"fila": persona["fila"], "nombre": persona["nombre"], "correo": correo, "equipo": eq["nombre"], "motivo": motivo})

        if eq["existe"] and eq["estado"] in (S_BAJA, S_NO):  # se registró antes y se cerró: no se reabre desde un archivo
            apartar(f"El equipo ya se registró antes ({eq['estado']}).")
            continue
        try:  # los datos del equipo se toman de la primera fila que los traiga
            if not eq["existe"]:
                if row.get("estado") not in (None, "") and eq["estado_dado"] is None:
                    eq["estado_dado"] = parse_state(row["estado"])
                if row.get("decision") not in (None, "") and eq["decision"] is None:
                    eq["decision"] = parse_decision(row["decision"])
                    if eq["decision"] is None and not any("decisión" in a for a in eq["avisos"]):
                        eq["avisos"].append(f"La decisión «{row['decision']}» no dice si se aceptó: queda por evaluar.")
                if row.get("espacio") not in (None, "") and eq["espacio"] is None:
                    eq["espacio"] = parse_space(row["espacio"])
                if row.get("fecha_ingreso") not in (None, "") and eq["fecha_ingreso"] is None:
                    eq["fecha_ingreso"] = parse_date(row["fecha_ingreso"])
                for campo in ("sector", "etapa", "descripcion"):
                    eq[campo] = eq[campo] or clean_text(row.get(campo), corto=campo != "descripcion")
                if not eq["respuestas"] and isinstance(row.get("respuestas"), list):
                    eq["respuestas"] = [{"etiqueta": str(r.get("etiqueta"))[:200], "valor": clean_text(r.get("valor"))[:2000]}
                                        for r in row["respuestas"] if isinstance(r, dict) and r.get("valor")]
        except ValueError as exc:
            mensaje = str(exc)[0].upper() + str(exc)[1:] + "."
            if mensaje not in eq["errores"]:
                eq["errores"].append(mensaje)

        if correo and correo in vistos:  # la misma persona otra vez (p. ej. mandó el formulario dos veces): se ignora
            apartar("Repetido en el archivo." if vistos[correo] == eq["nombre"] else f"Ya viene en el archivo con {vistos[correo]}.")
            continue
        dueno = sv.email_owner(db, correo) if correo else None
        if dueno is not None:
            apartar("Ya está registrado en este equipo." if dueno.team_id == eq["id"] else f"Ya está registrado en {dueno.team.nombre}.")
            vistos[correo] = eq["nombre"]
            continue
        try:
            tipo = parse_type(row.get("tipo"))
            if tipo is None:  # sin tipo: se deduce por la matrícula y por el dominio del correo
                persona["tipo_supuesto"] = True
                matricula = persona["matricula"].upper()
                if re.match(r"^L0\d+", matricula):
                    tipo = "Colaborador"
                elif re.match(r"^A0\d+", matricula) or sv.is_internal_email(db, correo):
                    tipo = "Alumno"
                else:
                    tipo = "Externo"
            persona["tipo"] = tipo
            persona["acceso_vence"] = parse_date(row.get("acceso_vence"))
            sv.check_person(db, persona["nombre"], correo, tipo, dominio=False)
            if tipo not in sv.LIBRE_CORREO and dominio and not sv.is_internal_email(db, correo):
                persona["nota"] = f"su correo no es @{dominio}"
            vistos[correo] = eq["nombre"]
        except ValueError as exc:
            persona["ok"], persona["nota"] = False, str(exc)
        eq["integrantes"].append(persona)

    lista = []
    for eq in equipos.values():
        if not eq["integrantes"] and not eq["errores"]:
            continue  # todo el equipo ya estaba registrado o viene repetido: queda solo en «duplicados»
        lista.append(eq)
        buenos = [p for p in eq["integrantes"] if p["ok"]]
        if not eq["existe"]:
            # Todo equipo nuevo entra como solicitud por evaluar: se acepta (y se le asigna espacio) desde Solicitudes.
            # Lo que el archivo diga del estado, la decisión o el espacio solo queda como referencia para quien evalúa.
            eq["estado"], eq["alta"] = S_EVA, "solicitud"
            dado = eq["estado_dado"]
            referencia = [f"el archivo dice «{dado}»" if dado and dado != S_EVA else "",
                          f"decisión: {eq['decision']}" if eq["decision"] else "",
                          f"espacio {eq['espacio']}" if eq["espacio"] is not None else ""]
            eq["referencia"] = ", ".join(r for r in referencia if r)
            if eq["referencia"]:
                eq["avisos"].append(f"Entra como solicitud por evaluar ({eq['referencia']}); se acepta desde Solicitudes.")
            eq["espacio"] = None
            if not buenos and not eq["errores"]:
                eq["errores"].append("Ninguna persona válida: el equipo no se crea.")
            if buenos and not any(p["lider"] for p in buenos):
                buenos[0]["lider"] = True
                if len(buenos) > 1:
                    eq["avisos"].append(f"Sin líder marcado: se toma a {buenos[0]['nombre']}.")
            for extra in [p for p in buenos if p["lider"]][1:]:
                extra["lider"] = False
        else:
            eq["alta"] = "existente"
            eq["avisos"].append("Este equipo ya existe: solo se agregan las personas que falten.")
        supuestos = sum(1 for p in buenos if p["tipo_supuesto"])
        if supuestos:
            eq["avisos"].append(f"{supuestos} persona(s) sin tipo reconocido: se dedujo por su matrícula o su correo" + (f" (@{dominio} = interno)." if dominio else "."))
        eq["importable"] = not eq["errores"] and bool(buenos)
        eq["fecha_ingreso"] = eq["fecha_ingreso"].isoformat() if eq["fecha_ingreso"] else None
        for p in eq["integrantes"]:
            p["acceso_vence"] = p["acceso_vence"].isoformat() if p["acceso_vence"] else None

    importables = [e for e in lista if e["importable"]]
    return {"equipos": lista, "duplicados": duplicados, "resumen": {
        "solicitudes": sum(1 for e in importables if e["alta"] == "solicitud"),
        "equipos_existentes": sum(1 for e in importables if e["alta"] == "existente"),
        "personas": sum(1 for e in importables for p in e["integrantes"] if p["ok"]),
        "duplicados": len(duplicados),
        "filas_con_problema": sum(1 for e in lista for p in e["integrantes"] if not p["ok"]) + sum(len(e["errores"]) for e in lista),
        "equipos_omitidos": len(lista) - len(importables)}}


def apply_plan(db: Session, plan: dict, actor: str) -> dict:
    """Crea lo que el plan marcó como importable. No envía ningún correo."""
    today = date.today()
    cuenta = {"solicitudes": 0, "personas": 0}
    for eq in plan["equipos"]:
        if not eq["importable"]:
            continue
        buenos = [p for p in eq["integrantes"] if p["ok"]]
        if eq["existe"]:
            team = db.get(Team, eq["id"])
        else:
            lider = next(p for p in buenos if p["lider"])
            fecha = date.fromisoformat(eq["fecha_ingreso"]) if eq["fecha_ingreso"] else today
            team = Team(folio=sv.make_folio(db, lider["matricula"] or lider["correo"]), nombre=eq["nombre"], descripcion=eq["descripcion"],
                        sector=eq["sector"], etapa=eq["etapa"], lider_nombre=lider["nombre"], lider_correo=lider["correo"], estado=eq["estado"],
                        fecha_solicitud=fecha, fecha_estado=today, respuestas=eq["respuestas"] or None,
                        notas="Solicitud importada por carga masiva." + (f" En el archivo: {eq['referencia']}." if eq.get("referencia") else ""))
            db.add(team)
            db.flush()
            cuenta["solicitudes"] += 1
        en_operacion = team.estado in EN_OPERACION
        pendientes = 0
        for p in buenos:
            m = Member(nombre=p["nombre"], correo=p["correo"], tipo=p["tipo"], matricula=p["matricula"],
                       rol="Líder" if p["lider"] and not eq["existe"] else "Integrante")
            if en_operacion:  # las solicitudes reciben su acceso cuando se aceptan
                if p["acceso_vence"]:
                    m.access = Access(estado="Activo", fecha_alta=today, vencimiento=date.fromisoformat(p["acceso_vence"]))
                else:
                    m.access = Access()
                    pendientes += 1
            team.members.append(m)
            cuenta["personas"] += 1
        db.flush()
        if team.estado != S_NO:
            sv.ensure_required_docs(db, team)
        if pendientes:
            sv.upsert_task(db, "Alta de acceso", sv.R_ACC, f"Capturar el vencimiento de {pendientes} acceso(s) de {team.nombre} (importado)", team)
        accion = "se agregaron" if eq["existe"] else "solicitud registrada con"
        log(db, "Cambio", f"Carga masiva: {accion} {len(buenos)} persona(s)", team, actor)
    log(db, "Sistema", f"Carga masiva: {cuenta['solicitudes']} solicitud(es) por evaluar y {cuenta['personas']} persona(s)", actor=actor)
    return cuenta
