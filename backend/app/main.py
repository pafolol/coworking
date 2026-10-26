"""API del coworking: formularios públicos, panel de operación, inicio de sesión con Google y tareas programadas."""
import json
import os
import secrets
import shutil
import re
from collections import Counter
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from urllib.parse import urlencode

import httpx
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Body, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from . import cuentas, difusion, formas, importer
from . import services as sv
from .db import UPLOADS, Base, SessionLocal, engine, get_db
from .mailer import (GOOGLE_AUTH, GOOGLE_TOKEN, GOOGLE_USERINFO, SCOPES, cfg, google_configured, links, log, queue_message,
                     reparar_mensajes_de_prueba, set_cfg)
from .models import (CON_ESPACIO, EN_OPERACION, ESTADOS, S_ACT, S_ALERTA, S_BAJA, S_DOC, S_ESP, S_EVA, S_FIJO, S_SOL,
                     Access, AuthSession, Automation, ChangeRequest, Checkin, Config, CustomForm, Cut, CutItem, Document, FormResponse, GoogleAccount, Log,
                     Member, Message, Space, Task, Team, Template, User)
from .seed import bootstrap, seed

COOKIE = "cw_session"
FRONTEND = os.environ.get("FRONTEND_URL", "http://localhost:5180").rstrip("/")
REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", f"{FRONTEND}/api/auth/google/callback")


def job(fn) -> None:
    with SessionLocal() as db:
        fn(db)
        db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    with engine.begin() as conn:  # columnas agregadas después de la primera versión
        if "respuestas" not in {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(teams)")}:
            conn.exec_driver_sql("ALTER TABLE teams ADD COLUMN respuestas JSON")
        if "pausa_desde" not in {r[1] for r in conn.exec_driver_sql("PRAGMA table_info(teams)")}:
            conn.exec_driver_sql("ALTER TABLE teams ADD COLUMN pausa_desde DATE")
    with SessionLocal() as db:
        bootstrap(db)
        cuentas.ensure_users(db)
        if reparar_mensajes_de_prueba(db):
            db.commit()
        if os.environ.get("SEED_DEMO", "1") == "1" and db.scalar(select(Team).limit(1)) is None and db.scalar(select(Log).limit(1)) is None:
            seed(db)
    scheduler = BackgroundScheduler()
    scheduler.add_job(lambda: job(sv.daily_review), "cron", hour=8, minute=0)          # diario, 8:00
    scheduler.add_job(lambda: job(sv.generate_cut), "cron", day_of_week="mon", hour=7)  # lunes, 7:00
    scheduler.add_job(lambda: job(difusion.run_due), "cron", minute=5)                  # envíos programados, cada hora
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="Coworking GDL", lifespan=lifespan)

# El frontend puede vivir en otro dominio que el API (api.emprendimientohub.com): CORS con credenciales solo para esos orígenes.
ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", FRONTEND).split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def check_origin(request: Request, call_next):
    """Con la cookie en SameSite=None, un formulario de otro sitio podría usar la sesión: se rechaza su origen."""
    origin = request.headers.get("origin", "").rstrip("/")
    if request.method not in ("GET", "HEAD", "OPTIONS") and origin and origin not in ORIGINS and origin != str(request.base_url).rstrip("/"):
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Origen no permitido."}, status_code=403)
    return await call_next(request)


def cookie_opts(request: Request) -> dict:
    """Por HTTPS la cookie va con SameSite=None; Secure para que el navegador la mande desde el dominio del frontend."""
    return {"samesite": "none", "secure": True} if request.url.scheme == "https" else {"samesite": "lax"}


# ---------- serialización ----------

def row(obj, *skip: str) -> dict:
    out = {}
    for col in obj.__table__.columns:
        if col.name in skip:
            continue
        value = getattr(obj, col.name)
        out[col.name] = value.isoformat() if isinstance(value, (date, datetime)) else value
    return out


def team_brief(t: Team) -> dict:
    return {"id": t.id, "folio": t.folio, "nombre": t.nombre, "estado": t.estado}


def team_row(t: Team, use: dict, weeks: list[date]) -> dict:
    data = row(t, "rubrica", "descripcion", "notas")
    data["espacio"] = t.space.numero if t.space else None
    data["integrantes"] = sum(1 for m in t.members if m.activo)
    data["uso"] = [use.get(t.id, {}).get(w, 0) for w in weeks]
    data["en_pausa"] = bool(t.pausa_hasta and t.pausa_hasta >= date.today())
    return data


def recent_weeks(n: int) -> list[date]:
    w0 = sv.monday(date.today())
    return [w0 - timedelta(days=7 * i) for i in range(n - 1, -1, -1)]


def member_row(m: Member) -> dict:
    data = row(m)
    data["acceso"] = row(m.access) if m.access else None
    return data


def doc_row(d: Document) -> dict:
    data = row(d)
    data["equipo"] = team_brief(d.team)
    data["persona"] = d.member.nombre if d.member else None
    data["tiene_archivo"] = bool(d.archivo)
    data["tipo_archivo"] = "pdf" if d.archivo.lower().endswith(".pdf") else "imagen" if d.archivo else None
    return data


def task_row(t: Task) -> dict:
    data = row(t)
    data["equipo"] = team_brief(t.team) if t.team else None
    return data


def msg_row(m: Message) -> dict:
    data = row(m)
    data["equipo"] = team_brief(m.team) if m.team else None
    return data


def cut_warnings(item: CutItem) -> list[str]:
    """Lo que conviene saber antes de aprobar una acción del corte."""
    team, out = item.team, []
    accesos = [m.access for m in team.members if m.activo and m.access]
    activos = sum(1 for a in accesos if a.estado == "Activo")
    vencidos = sum(1 for a in accesos if a.estado == "Vencido")
    if item.accion == "Baja":
        if activos or vencidos:
            out.append(f"Se creará la tarea de revocar {activos + vencidos} acceso(s) y se cerrarán sus renovaciones y trámites abiertos.")
        if team.space:
            out.append(f"Libera el espacio {team.space.numero}.")
    elif item.accion in ("Alerta de baja", "Downgrade y alerta de baja") and activos:
        out.append("Mientras esté en alerta no se le renuevan accesos.")
    elif item.accion == "Upgrade" and vencidos:
        out.append(f"Tiene {vencidos} acceso(s) vencido(s): conviene renovarlos antes de darle lugar.")
    return out


def cut_row(c: Cut, full: bool = False) -> dict:
    data = row(c)
    data["cambios"] = sum(1 for i in c.items if i.accion != "Sin cambio")
    data["equipos"] = len(c.items)
    if full:
        data["items"] = [{**row(i), "equipo": team_brief(i.team), "espacio": i.team.space.numero if i.team.space else None,
                          "lider": i.team.lider_nombre, "avisos": cut_warnings(i) if c.estado == "Propuesta" else []} for i in c.items]
    return data


# ---------- sesión ----------

SESSION_DAYS = 14


def current_session(request: Request, db: Session) -> AuthSession | None:
    """La sesión de la cookie, si existe y no pasó de SESSION_DAYS (la cookie vence en el navegador, pero el token también aquí)."""
    token = request.cookies.get(COOKIE)
    session = db.get(AuthSession, token) if token else None
    if session is not None and datetime.now() - session.creada > timedelta(days=SESSION_DAYS):
        db.delete(session)
        db.commit()
        return None
    return session


def operator(request: Request, db: Session = Depends(get_db)) -> AuthSession:
    session = current_session(request, db)
    if session is None:
        raise HTTPException(401, "Inicia sesión para continuar.")
    return session


def demo_allowed() -> bool:
    return os.environ.get("ALLOW_DEMO") == "1"


def start_session(request: Request, db: Session, response, email: str, nombre: str, foto: str = "", demo: bool = False) -> None:
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token=token, email=email, nombre=nombre, foto=foto, demo=demo, creada=datetime.now()))
    db.commit()
    response.set_cookie(COOKIE, token, httponly=True, max_age=60 * 60 * 24 * SESSION_DAYS, **cookie_opts(request))


@app.get("/api/auth/me")
def me(request: Request, db: Session = Depends(get_db)):
    session = current_session(request, db)
    return {"usuario": {"email": session.email, "nombre": session.nombre, "foto": session.foto, "demo": session.demo} if session else None,
            "google": google_configured(), "demo": demo_allowed(), "nombre": cfg(db, "NOMBRE", "Coworking GDL")}


@app.post("/api/auth/demo")
def login_demo(request: Request, db: Session = Depends(get_db)):
    if not demo_allowed():
        raise HTTPException(403, "El modo demo está desactivado: entra con Google.")
    from fastapi.responses import JSONResponse
    response = JSONResponse({"ok": True})
    start_session(request, db, response, "demo@coworking.local", "Operación (demo)", demo=True)
    return response


@app.post("/api/auth/login")
def login_password(request: Request, payload: dict = Body(...), db: Session = Depends(get_db)):
    from fastapi.responses import JSONResponse
    usuario = str(payload.get("usuario") or "").strip().lower()
    user = db.get(User, usuario) if usuario else None
    if user is None or not cuentas.check_password(str(payload.get("password") or ""), user.password_hash):
        raise HTTPException(401, "Usuario o contraseña incorrectos.")
    log(db, "Sistema", f"Inicio de sesión con usuario: {usuario}", actor=usuario)
    response = JSONResponse({"ok": True})
    start_session(request, db, response, usuario, user.nombre or usuario)
    return response


@app.post("/api/auth/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    from fastapi.responses import JSONResponse
    session = db.get(AuthSession, request.cookies.get(COOKIE) or "")
    if session:
        db.delete(session)
        db.commit()
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE, httponly=True, **cookie_opts(request))
    return response


@app.get("/api/auth/google/login")
def google_login():
    if not google_configured():
        raise HTTPException(400, "Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en backend/.env")
    state = secrets.token_urlsafe(16)
    params = {"client_id": os.environ["GOOGLE_CLIENT_ID"], "redirect_uri": REDIRECT_URI, "response_type": "code", "scope": SCOPES,
              "prompt": "select_account", "state": state}
    response = RedirectResponse(f"{GOOGLE_AUTH}?{urlencode(params)}")
    response.set_cookie("cw_oauth", state, httponly=True, samesite="lax", max_age=600)
    return response


@app.get("/api/auth/google/callback")
def google_callback(request: Request, code: str = "", state: str = "", error: str = "", db: Session = Depends(get_db)):
    fail = lambda why: RedirectResponse(f"{FRONTEND}/login?error={why}")
    if error or not code or state != request.cookies.get("cw_oauth"):
        return fail("cancelado")
    try:
        r = httpx.post(GOOGLE_TOKEN, data={"code": code, "client_id": os.environ["GOOGLE_CLIENT_ID"], "client_secret": os.environ["GOOGLE_CLIENT_SECRET"],
                                           "redirect_uri": REDIRECT_URI, "grant_type": "authorization_code"}, timeout=20)
        if r.status_code != 200:
            return fail("token")
        tok = r.json()
        info = httpx.get(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {tok['access_token']}"}, timeout=20).json()
    except (httpx.HTTPError, ValueError, KeyError):  # Google no respondió o respondió algo inesperado
        return fail("token")
    email = (info.get("email") or "").lower()
    if not email or not info.get("email_verified", True):
        return fail("correo")

    # El primer inicio de sesión queda como administrador; después solo entran los correos de operación.
    permitidos = [c.lower() for c in (cfg(db, "CORREOS_OPERACION", []) or [])]
    primero = db.scalar(select(func.count()).select_from(GoogleAccount)) == 0
    admins = [c.strip().lower() for c in os.environ.get("ADMIN_EMAILS", "").split(",") if c.strip()]
    if email not in permitidos and email not in admins and not (primero and not admins):
        return fail("no_autorizado")
    if email not in permitidos:
        set_cfg(db, "CORREOS_OPERACION", permitidos + [email])

    acc = db.get(GoogleAccount, email) or GoogleAccount(email=email)
    acc.nombre, acc.foto = info.get("name", email), info.get("picture", "")
    # Solo se usa para saber quién entró: ya no se guardan tokens de Google (los de Gmail que hubiera se borran al volver a entrar).
    acc.access_token, acc.refresh_token, acc.expira, acc.gmail = "", "", None, False
    db.add(acc)
    log(db, "Sistema", f"Inicio de sesión con Google: {email}", actor=email)
    response = RedirectResponse(f"{FRONTEND}/")
    response.delete_cookie("cw_oauth")
    start_session(request, db, response, email, acc.nombre, acc.foto)
    return response


# ---------- formularios públicos (sin sesión) ----------

async def read_form(request: Request) -> tuple[dict, dict[str, tuple[str, bytes]]]:
    form = await request.form()
    fields, files = {}, {}
    for key, value in form.multi_items():
        if hasattr(value, "filename"):
            content = await value.read()
            if len(content) > 10 * 1024 * 1024:
                raise HTTPException(413, f"«{value.filename}» pesa más de 10 MB.")
            if content:
                files[key.removeprefix("archivo:")] = (value.filename or "archivo", content)
        else:
            fields[key] = value
    return fields, files


def formularios_publicos(db: Session) -> dict:
    forms = sv.formularios(db)
    reemplazos = {"{{dias_minimos}}": str(cfg(db, "DIAS_MINIMOS", 3)), "{{semanas_upgrade}}": str(cfg(db, "SEMANAS_UPGRADE", 2))}
    for form in forms.values():
        for campo in ("titulo", "intro", "mensaje_final"):
            for clave, valor in reemplazos.items():
                if isinstance(form.get(campo), str):
                    form[campo] = form[campo].replace(clave, valor)
    return forms


def carta_texto(db: Session) -> str:
    return str(cfg(db, "CARTA_COMPROMISO", "")).replace("{{dias_minimos}}", str(cfg(db, "DIAS_MINIMOS", 3)))


@app.get("/api/public/info")
def public_info(db: Session = Depends(get_db)):
    return {"nombre": cfg(db, "NOMBRE"), "semestre": cfg(db, "SEMESTRE"), "catalogo": cfg(db, "CATALOGO_DOCS", []),
            "link_reglamento": cfg(db, "LINK_REGLAMENTO", ""), "dias_minimos": cfg(db, "DIAS_MINIMOS", 3),
            "semanas_upgrade": cfg(db, "SEMANAS_UPGRADE", 2), "dias_decision": cfg(db, "DIAS_HABILES_DECISION", 10),
            "max_pausa": cfg(db, "MAX_SEMANAS_PAUSA", 2), "carta": carta_texto(db),
            "formularios": formularios_publicos(db), "dominios": sv.internal_domains(db)}


@app.post("/api/public/solicitud")
async def public_solicitud(request: Request, db: Session = Depends(get_db)):
    fields, files = await read_form(request)
    try:
        data = json.loads(fields.get("datos", "{}"))
    except json.JSONDecodeError:
        raise HTTPException(400, "Formulario inválido.")
    if not isinstance(data, dict) or not isinstance(data.get("integrantes"), list):
        raise HTTPException(400, "Formulario inválido.")
    integrantes = [p for p in data["integrantes"] if isinstance(p, dict) and (str(p.get("nombre") or "").strip() or str(p.get("correo") or "").strip())]
    if not str(data.get("nombre") or "").strip() or not integrantes:
        raise HTTPException(400, "Escribe el nombre del proyecto y al menos un integrante con correo.")
    data["integrantes"] = integrantes
    try:
        team = sv.submit_application(db, data, files)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    return {"folio": team.folio, "estado": team.estado, "faltantes": sv.missing_docs(db, team)}


@app.post("/api/public/checkin")
def public_checkin(payload: dict = Body(...), db: Session = Depends(get_db)):
    correo = payload.get("correo")
    if not isinstance(correo, str) or not sv.EMAIL_RE.match(correo.strip().lower()):
        raise HTTPException(400, "Escribe tu correo.")
    result = sv.register_checkin(db, correo, "QR", payload.get("k") if isinstance(payload.get("k"), str) else None)
    db.commit()
    return result


def team_for_form(db: Session, folio: str, correo: str) -> Team:
    team = db.scalar(select(Team).where(Team.folio == folio.strip().upper()))
    if team is None or team.lider_correo != correo.strip().lower():
        raise HTTPException(404, "No encontramos un equipo con ese folio y correo de líder.")
    return team


@app.get("/api/public/equipo")
def public_equipo(folio: str, correo: str, db: Session = Depends(get_db)):
    team = team_for_form(db, folio, correo)
    docs = db.scalars(select(Document).where(Document.team_id == team.id))
    return {"folio": team.folio, "nombre": team.nombre, "estado": team.estado, "lider": team.lider_nombre,
            "renovacion_pendiente": not team.renovacion_confirmada, "renovacion_limite": team.renovacion_limite,
            "pausa_usada": team.pausa_semanas_usadas,
            "integrantes": [{"id": m.id, "nombre": m.nombre, "correo": m.correo, "rol": m.rol} for m in team.members if m.activo],
            "documentos": [{"id": d.id, "nombre": d.nombre, "persona": d.member.nombre if d.member else None, "estado": d.estado,
                            "vencimiento": d.vencimiento, "modo": sv.modo(db, d.clave), "firma": d.firma}
                           for d in docs if not d.member or d.member.activo]}


@app.post("/api/public/cambios")
async def public_cambios(request: Request, db: Session = Depends(get_db)):
    fields, files = await read_form(request)
    team = team_for_form(db, fields.get("folio", ""), fields.get("correo", ""))
    try:
        req = sv.request_change(db, team, fields.get("tipo", ""), json.loads(fields.get("datos", "{}")), files)
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc) or "Datos incompletos.")
    db.commit()
    return {"ok": True, "tipo": req.tipo, "estado": req.estado, "detalle": req.detalle}


# ---------- panel ----------

@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    today = date.today()
    weeks = recent_weeks(8)
    teams = list(db.scalars(select(Team)))
    use = sv.usage(db, since=weeks[0])
    by_id = {t.id: t for t in teams}
    spaces = list(db.scalars(select(Space).order_by(Space.numero)))
    estados = Counter(t.estado for t in teams)
    minimo = cfg(db, "DIAS_MINIMOS", 3)

    uso_semanal = []
    for w in weeks:
        dias = [use.get(t.id, {}).get(w, 0) for t in teams]
        uso_semanal.append({"semana": w.isoformat(), "dias_equipo": sum(dias), "equipos": sum(1 for d in dias if d),
                            "cumplen": sum(1 for d in dias if d >= minimo)})

    desde = today - timedelta(days=27)
    por_dia = [0] * 7
    for (fecha,) in db.execute(select(Checkin.fecha).where(Checkin.valido.is_(True), Checkin.fecha >= desde)):
        por_dia[fecha.weekday()] += 1

    horizonte = today + timedelta(days=30)
    venc = []
    for acc in db.scalars(select(Access).where(Access.estado.in_(["Activo", "Vencido"]), Access.vencimiento <= horizonte)):
        if acc.member.activo and acc.member.team.estado in EN_OPERACION:
            venc.append({"tipo": "Acceso", "quien": acc.member.nombre, "equipo": team_brief(acc.member.team), "fecha": acc.vencimiento.isoformat(),
                         "dias": (acc.vencimiento - today).days})
    for d in db.scalars(select(Document).where(Document.estado.in_(["Validado", "Vencido"]), Document.vencimiento <= horizonte)):
        if d.team.estado in EN_OPERACION:
            venc.append({"tipo": "Documento", "quien": d.nombre, "equipo": team_brief(d.team), "fecha": d.vencimiento.isoformat(),
                         "dias": (d.vencimiento - today).days})

    cut = db.scalar(select(Cut).where(Cut.estado == "Propuesta").order_by(Cut.semana.desc()))
    hoy = db.execute(select(func.count(), func.count(func.distinct(Checkin.team_id))).where(Checkin.fecha == today, Checkin.valido.is_(True))).one()
    mes = today.replace(day=1)
    w_actual = weeks[-1]
    return {
        "hoy": {"fecha": today.isoformat(), "checkins": hoy[0], "equipos": hoy[1]},
        "ocupacion": {"total": len(spaces), "ocupados": sum(1 for s in spaces if s.team_id), "libres": sum(1 for s in spaces if not s.team_id)},
        "por_estado": [{"estado": e, "n": estados.get(e, 0)} for e in ESTADOS],
        "kpis": {"en_operacion": sum(estados.get(e, 0) for e in EN_OPERACION), "lista_espera": estados.get(S_ESP, 0),
                 "tareas": db.scalar(select(func.count()).select_from(Task).where(Task.estado == "Pendiente")),
                 "por_evaluar": estados.get(S_EVA, 0), "en_riesgo": estados.get("En riesgo", 0), "alerta_baja": estados.get(S_ALERTA, 0),
                 "bandeja": db.scalar(select(func.count()).select_from(Message).where(Message.estado.in_(["Bandeja", "Error"])))},
        "uso_semanal": uso_semanal,
        "checkins_por_dia": por_dia,
        "lista_espera": [{"equipo": team_brief(t), "promedio": p, "posicion": i + 1} for i, (t, p) in enumerate(sv.waitlist(db))],
        "vencimientos": sorted(venc, key=lambda v: v["dias"]),
        "corte": cut_row(cut) if cut else None,
        "espacios": [{"numero": s.numero, "zona": s.zona, "equipo": team_brief(by_id[s.team_id]) if s.team_id else None,
                      "dias": use.get(s.team_id, {}).get(w_actual, 0) if s.team_id else None,
                      "dias_previa": use.get(s.team_id, {}).get(weeks[-2], 0) if s.team_id else None} for s in spaces],
        "mes": {"checkins": db.scalar(select(func.count()).select_from(Checkin).where(Checkin.valido.is_(True), Checkin.fecha >= mes)),
                "altas": sum(1 for t in teams if t.fecha_aceptacion and t.fecha_aceptacion >= mes),
                "bajas": sum(1 for t in teams if t.fecha_baja and t.fecha_baja >= mes),
                "solicitudes": sum(1 for t in teams if t.fecha_solicitud >= mes)},
        "minimo": minimo,
    }


@app.get("/api/nav")
def nav(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    """Contadores del menú lateral."""
    count = lambda q: db.scalar(q) or 0
    cut = db.scalar(select(Cut).where(Cut.estado == "Propuesta").order_by(Cut.semana.desc()))
    return {"tareas": count(select(func.count()).select_from(Task).where(Task.estado == "Pendiente")),
            "bandeja": count(select(func.count()).select_from(Message).where(Message.estado.in_(["Bandeja", "Error"]))),
            "por_evaluar": count(select(func.count()).select_from(Team).where(Team.estado == S_EVA)),
            "corte": sum(1 for i in cut.items if i.accion != "Sin cambio") if cut else 0}


@app.get("/api/importar/plantilla")
def importar_plantilla(_: AuthSession = Depends(operator)):
    return Response(importer.template_csv(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="plantilla_equipos.csv"'})


@app.post("/api/importar/ia")
async def importar_ia(request: Request, db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    """Lee cualquier Excel o CSV, acomoda sus columnas y devuelve la vista previa. No guarda nada.

    A la IA solo se le mandan los nombres de las columnas; los datos se acomodan aquí con ese mapeo.
    Con `mapa` (el mapeo ajustado a mano) no se llama a la IA.
    """
    fields, files = await read_form(request)
    if not files:
        raise HTTPException(400, "Elige un archivo CSV o Excel.")
    filename, content = next(iter(files.values()))
    try:
        mapa_manual = json.loads(fields["mapa"]) if fields.get("mapa") else None
    except json.JSONDecodeError:
        raise HTTPException(400, "Mapeo inválido.")
    try:
        r = importer.arrange(filename, content, fields.get("instrucciones", ""), mapa_manual if isinstance(mapa_manual, list) else None)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception:
        raise HTTPException(400, "No pude leer el archivo. Guárdalo como Excel (.xlsx) o CSV e inténtalo de nuevo.")
    filas = importer.apply_map(r["hojas"], r["mapa"], r["descartadas"])
    if r["modo"] == "ia":
        log(db, "Sistema", f"Carga masiva: columnas de «{filename}» acomodadas con IA (solo se enviaron los encabezados)", actor=op.email)
        db.commit()
    return {"plan": importer.build_plan(db, [dict(f) for f in filas]), "filas": filas, "notas": r["notas"], "modo": r["modo"],
            "mapa": importer.with_samples(r["hojas"], r["mapa"], r["descartadas"])}


@app.post("/api/importar/aplicar")
def importar_aplicar(payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    """Importa exactamente las filas que se vieron en la vista previa (no vuelve a llamar al modelo)."""
    filas = payload.get("filas")
    if not isinstance(filas, list) or not filas or not all(isinstance(f, dict) for f in filas):
        raise HTTPException(400, "No hay filas que importar.")
    try:
        plan = importer.build_plan(db, [dict(f) for f in filas])
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except (TypeError, AttributeError, KeyError):
        raise HTTPException(400, "Las filas no tienen el formato de la vista previa. Vuelve a subir el archivo.")
    resultado = importer.apply_plan(db, plan, op.email)
    db.commit()
    return {"resultado": resultado}


@app.get("/api/importar/estado")
def importar_estado(_: AuthSession = Depends(operator)):
    return {"ia": importer.ai_available(), "modelo": os.environ.get("OPENAI_MODEL", "gpt-5.6-luna")}


@app.get("/api/niveles")
def niveles(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    """Niveles por constancia: los requisitos y beneficios de cada uno y en cuál está cada equipo."""
    from .defaults import NIVELES
    lv = sv.levels(db)
    teams = db.scalars(select(Team).where(Team.id.in_(lv.keys())))
    equipos = [{**team_brief(t), "lider": t.lider_nombre, "espacio": t.space.numero if t.space else None, **lv[t.id]} for t in teams]
    equipos.sort(key=lambda e: (-e["indice"], -e["promedio"], -e["racha"], e["nombre"]))
    return {"niveles": cfg(db, "NIVELES", NIVELES) or NIVELES, "equipos": equipos, "minimo": cfg(db, "DIAS_MINIMOS", 3),
            "semanas_promedio": cfg(db, "SEMANAS_PROMEDIO", 4)}


@app.get("/api/solicitudes")
def solicitudes(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    """Solicitudes abiertas y decisiones recientes, con lo que le falta a cada una."""
    today = date.today()
    recientes = today - timedelta(days=30)
    teams = db.scalars(select(Team).where(Team.estado.in_([S_SOL, S_DOC, S_EVA, "No aceptado"]) | (Team.fecha_aceptacion >= recientes)).order_by(Team.fecha_solicitud))
    out = []
    for t in teams:
        habiles = sum(1 for i in range(1, (today - t.fecha_solicitud).days + 1) if (t.fecha_solicitud + timedelta(days=i)).weekday() < 5)
        docs = list(db.scalars(select(Document).where(Document.team_id == t.id)))
        activos = [m for m in t.members if m.activo]
        out.append({**team_brief(t), "descripcion": t.descripcion, "sector": t.sector, "etapa": t.etapa, "lider": t.lider_nombre,
                    "lider_correo": t.lider_correo, "integrantes": len(activos), "externos": sum(1 for m in activos if m.tipo == "Externo"),
                    "fecha_solicitud": t.fecha_solicitud, "fecha_aceptacion": t.fecha_aceptacion, "fecha_reaplicacion": t.fecha_reaplicacion,
                    "puntaje": t.puntaje, "dias_habiles": habiles, "faltantes": sv.missing_docs(db, t),
                    "por_validar": sum(1 for d in docs if d.estado == "Por validar"),
                    "importada": t.notas.startswith("Solicitud importada")})
    return {"solicitudes": out, "meta": cfg(db, "DIAS_HABILES_DECISION", 10), "link": links(db)["solicitud"]}


@app.get("/api/equipos")
def equipos(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    weeks = recent_weeks(5)
    use = sv.usage(db, since=weeks[0])
    teams = db.scalars(select(Team).order_by(Team.nombre))
    return {"semanas": [w.isoformat() for w in weeks], "equipos": [team_row(t, use, weeks) for t in teams], "estados": ESTADOS,
            "minimo": cfg(db, "DIAS_MINIMOS", 3)}


def get_team(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(404, "Equipo no encontrado.")
    return team


@app.get("/api/equipos/{team_id}")
def equipo(team_id: int, db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    t = get_team(db, team_id)
    weeks = recent_weeks(12)
    use = sv.usage(db, [t.id], weeks[0])
    dias = {c.fecha.isoformat() for c in db.scalars(select(Checkin).where(Checkin.team_id == t.id, Checkin.valido.is_(True), Checkin.fecha >= weeks[0]))}
    data = team_row(t, use, weeks)
    data.update(
        descripcion=t.descripcion, notas=t.notas, rubrica=t.rubrica, semanas=[w.isoformat() for w in weeks], dias_con_checkin=sorted(dias),
        miembros=[member_row(m) for m in t.members],
        documentos=[doc_row(d) for d in db.scalars(select(Document).where(Document.team_id == t.id))],
        bitacora=[row(l) for l in db.scalars(select(Log).where(Log.team_id == t.id).order_by(Log.ts.desc()).limit(60))],
        mensajes=[msg_row(m) for m in db.scalars(select(Message).where(Message.team_id == t.id).order_by(Message.ts.desc()).limit(30))],
        tareas=[task_row(k) for k in db.scalars(select(Task).where(Task.team_id == t.id, Task.estado == "Pendiente"))],
        faltantes=sv.missing_docs(db, t), rubrica_config=cfg(db, "RUBRICA", []), minimo=cfg(db, "DIAS_MINIMOS", 3),
        max_pausa=cfg(db, "MAX_SEMANAS_PAUSA", 2), excluidas=[w.isoformat() for w in sv.excluded_weeks(db)],
        ultimo_checkin=sv.last_checkin(db, t), nivel=sv.levels(db, [t.id]).get(t.id),
    )
    return data


@app.patch("/api/equipos/{team_id}")
def equipo_update(team_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    """Excepciones: cambiar el estado a mano queda en bitácora y no envía correos."""
    t = get_team(db, team_id)
    if "notas" in payload:
        t.notas = payload["notas"]
    estado = payload.get("estado")
    if estado and estado != t.estado:
        if estado not in ESTADOS:
            raise HTTPException(400, "Estado desconocido.")
        if estado in CON_ESPACIO and t.space is None:
            libres = sv.free_spaces(db)
            if not libres:
                raise HTTPException(400, "No hay espacios libres para asignar.")
            sv.assign_space(db, t, libres[0], op.email)
        if estado not in CON_ESPACIO and estado != S_ALERTA:  # en alerta de baja el equipo conserva su lugar hasta la baja
            sv.release_space(db, t, op.email)
        if estado in EN_OPERACION and t.fecha_aceptacion is None:
            t.fecha_aceptacion = date.today()
            sv.ensure_access_rows(db, t)
        t.alerta_limite = date.today() + timedelta(days=cfg(db, "DIAS_RESPUESTA_BAJA", 7)) if estado == S_ALERTA else None
        t.fecha_baja = date.today() if estado == S_BAJA else None
        sv.set_state(db, t, estado, op.email, "Cambio manual: " + (payload.get("motivo") or "sin motivo"))
    db.commit()
    return {"ok": True}


@app.post("/api/equipos/{team_id}/evaluar")
def equipo_evaluar(team_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    t = get_team(db, team_id)
    if t.estado not in (S_EVA, S_DOC, S_SOL):
        raise HTTPException(400, "Este equipo ya tiene una decisión registrada.")
    decision = payload.get("decision")
    if decision not in ("Aceptado", "No aceptado"):
        raise HTTPException(400, "Elige aceptar o rechazar.")
    sv.evaluate(db, t, decision, payload.get("rubrica") or {}, (payload.get("retroalimentacion") or "").strip(), op.email)
    db.commit()
    return {"ok": True, "estado": t.estado}


@app.post("/api/equipos/{team_id}/pausa")
def equipo_pausa(team_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    t = get_team(db, team_id)
    if payload.get("quitar"):
        t.pausa_hasta = None
        log(db, "Estado", "Pausa terminada", t, op.email)
    else:
        try:
            semanas = int(payload.get("semanas", 1))
        except (TypeError, ValueError):
            raise HTTPException(400, "Indica cuántas semanas.")
        error = sv.approve_pause(db, t, semanas, op.email)
        if error:
            raise HTTPException(400, error)
        for req in db.scalars(select(ChangeRequest).where(ChangeRequest.team_id == t.id, ChangeRequest.tipo == "Pausa", ChangeRequest.estado == "Pendiente")):
            req.estado = "Aplicado"
    db.commit()
    return {"ok": True}


@app.post("/api/equipos/{team_id}/integrantes")
def integrante_add(team_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    t = get_team(db, team_id)
    try:
        sv.add_member(db, t, payload, op.email)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    return {"ok": True}


@app.delete("/api/integrantes/{member_id}")
def integrante_remove(member_id: int, db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    m = db.get(Member, member_id)
    if m is None:
        raise HTTPException(404, "Integrante no encontrado.")
    sv.remove_member(db, m, op.email)
    db.commit()
    return {"ok": True}


@app.get("/api/espacios")
def espacios(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    weeks = recent_weeks(5)
    use = sv.usage(db, since=weeks[0])
    out = []
    for s in db.scalars(select(Space).order_by(Space.numero)):
        t = s.team
        out.append({"numero": s.numero, "zona": s.zona, "desde": s.desde, "equipo": {**team_brief(t), "lider": t.lider_nombre,
                    "uso": [use.get(t.id, {}).get(w, 0) for w in weeks], "en_pausa": bool(t.pausa_hasta and t.pausa_hasta >= date.today())} if t else None})
    sin_espacio = db.scalars(select(Team).where(Team.estado.in_([S_ACT, S_ESP])).order_by(Team.nombre))
    return {"espacios": out, "semanas": [w.isoformat() for w in weeks], "minimo": cfg(db, "DIAS_MINIMOS", 3),
            "candidatos": [team_brief(t) for t in sin_espacio],
            "lista_espera": [{"equipo": team_brief(t), "promedio": p, "posicion": i + 1} for i, (t, p) in enumerate(sv.waitlist(db))]}


@app.post("/api/espacios/{numero}")
def espacio_update(numero: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    s = db.get(Space, numero)
    if s is None:
        raise HTTPException(404, "Espacio no encontrado.")
    if payload.get("liberar"):
        if s.team:
            t = s.team
            sv.release_space(db, t, op.email)
            sv.set_state(db, t, S_ACT, op.email, "Espacio liberado a mano")
    else:
        try:
            t = get_team(db, int(payload["team_id"]))
        except (KeyError, TypeError, ValueError):
            raise HTTPException(400, "Elige un equipo.")
        if s.team_id or t.space:
            raise HTTPException(400, "El espacio está ocupado o el equipo ya tiene uno.")
        sv.assign_space(db, t, s, op.email)
        sv.set_state(db, t, S_FIJO, op.email, "Espacio asignado a mano")
    db.commit()
    return {"ok": True}


@app.get("/api/checkins")
def checkins(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    today = date.today()
    rows = db.scalars(select(Checkin).where(Checkin.fecha >= today - timedelta(days=14)).order_by(Checkin.ts.desc()).limit(5000))
    teams = {t.id: t for t in db.scalars(select(Team))}
    members = {m.id: m.nombre for m in db.scalars(select(Member))}
    return {"checkins": [{**row(c), "equipo": team_brief(teams[c.team_id]) if c.team_id else None, "persona": members.get(c.member_id)} for c in rows],
            "link": links(db)["checkin"], "hoy": today.isoformat()}


@app.post("/api/checkins")
def checkin_manual(payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    try:
        when = datetime.fromisoformat(payload["fecha"] + "T12:00:00") if payload.get("fecha") else None
    except (TypeError, ValueError):
        raise HTTPException(400, "Fecha inválida.")
    if when and when.date() > date.today():
        raise HTTPException(400, "No se puede registrar una visita en una fecha futura.")
    result = sv.register_checkin(db, payload.get("correo", ""), "Manual", when=when)
    if result["ok"]:
        log(db, "Sistema", f"Check-in manual de {str(payload.get('correo'))[:160]}", actor=op.email)
    db.commit()
    return result


@app.post("/api/qr/rotar")
def qr_rotar(db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    set_cfg(db, "QR_TOKEN", secrets.token_urlsafe(8))
    log(db, "Sistema", "QR de check-in rotado: el anterior deja de aceptarse", actor=op.email)
    db.commit()
    return {"link": links(db)["checkin"]}


@app.get("/api/cortes")
def cortes(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    return {"cortes": [cut_row(c) for c in db.scalars(select(Cut).order_by(Cut.semana.desc()).limit(26))],
            "automatica": cfg(db, "APROBACION_AUTOMATICA", False), "minimo": cfg(db, "DIAS_MINIMOS", 3),
            "semana_pendiente": (sv.monday(date.today()) - timedelta(days=7)).isoformat()}


@app.get("/api/cortes/{cut_id}")
def corte(cut_id: int, db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    c = db.get(Cut, cut_id)
    if c is None:
        raise HTTPException(404, "Corte no encontrado.")
    return cut_row(c, full=True)


@app.post("/api/cortes/generar")
def corte_generar(db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    c = sv.generate_cut(db)
    db.commit()
    return cut_row(c)


@app.patch("/api/cortes/items/{item_id}")
def corte_item(item_id: int, payload: dict = Body(...), db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    item = db.get(CutItem, item_id)
    if item is None or item.cut.estado != "Propuesta":
        raise HTTPException(400, "Esta propuesta ya no se puede editar.")
    item.aprobada = bool(payload.get("aprobada"))
    db.commit()
    return {"ok": True}


@app.post("/api/cortes/{cut_id}/aplicar")
def corte_aplicar(cut_id: int, db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    c = db.get(Cut, cut_id)
    if c is None:
        raise HTTPException(404, "Corte no encontrado.")
    sv.apply_cut(db, c, op.email)
    db.commit()
    return cut_row(c, full=True)


@app.get("/api/accesos")
def accesos(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    today = date.today()
    out = []
    for acc in db.scalars(select(Access)):
        m = acc.member
        out.append({**row(acc), "persona": m.nombre, "member_id": m.id, "correo": m.correo, "tipo_persona": m.tipo, "integrante_activo": m.activo,
                    "equipo": team_brief(m.team), "dias": (acc.vencimiento - today).days if acc.vencimiento else None})
    return {"accesos": out, "meses": cfg(db, "MESES_ACCESO", 6)}


@app.patch("/api/accesos/{access_id}")
def acceso_update(access_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    acc = db.get(Access, access_id)
    if acc is None:
        raise HTTPException(404, "Acceso no encontrado.")
    try:
        venc = date.fromisoformat(payload["vencimiento"]) if payload.get("vencimiento") else None
    except (TypeError, ValueError):
        raise HTTPException(400, "Fecha de vencimiento inválida.")
    estado = payload.get("estado", acc.estado)
    if estado not in ("Pendiente", "Activo", "Vencido", "Revocado"):
        raise HTTPException(400, "Estado de acceso desconocido.")
    sv.update_access(db, acc, estado, venc, op.email)
    db.commit()
    return {"ok": True}


@app.get("/api/documentos")
def documentos(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    docs = db.scalars(select(Document).join(Team).where(Team.estado != S_BAJA))
    return {"documentos": [doc_row(d) for d in docs if not d.member or d.member.activo], "catalogo": cfg(db, "CATALOGO_DOCS", []),
            "carta": carta_texto(db)}


@app.patch("/api/documentos/{doc_id}")
def documento_update(doc_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "Documento no encontrado.")
    if payload.get("enlace"):
        if not isinstance(payload["enlace"], str) or not payload["enlace"].strip().lower().startswith(("http://", "https://")):
            raise HTTPException(400, "El enlace debe empezar con http:// o https://.")
        sv.attach_document(db, doc, enlace=payload["enlace"].strip())
    if payload.get("estado") in ("Validado", "Rechazado"):
        if doc.estado == "Faltante":
            doc.fecha_carga = date.today()
        sv.validate_document(db, doc, payload["estado"], op.email)
    db.flush()
    sv.check_docs_complete(db, doc.team)
    db.commit()
    return {"ok": True}


@app.get("/api/archivos/{doc_id}")
def archivo(doc_id: int, db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    doc = db.get(Document, doc_id)
    path = (UPLOADS / doc.archivo).resolve() if doc and doc.archivo else None
    if path is None or UPLOADS.resolve() not in path.parents or not path.exists():
        raise HTTPException(404, "Archivo no encontrado.")
    media = sv.MEDIA.get(path.suffix.lower())
    if media is None:  # nunca se sirve en línea algo que no sea PDF o imagen
        return FileResponse(path, filename=path.name.split("_", 1)[-1], media_type="application/octet-stream",
                            headers={"X-Content-Type-Options": "nosniff"})
    return FileResponse(path, filename=path.name.split("_", 1)[-1], media_type=media, content_disposition_type="inline",
                        headers={"X-Content-Type-Options": "nosniff"})


@app.post("/api/documentos/{doc_id}/archivo")
async def documento_subir(doc_id: int, request: Request, db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    """El equipo operativo sube el archivo desde el panel (por ejemplo, si llegó por correo o en papel)."""
    doc = db.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "Documento no encontrado.")
    _, files = await read_form(request)
    if not files:
        raise HTTPException(400, "Elige un archivo.")
    filename, content = next(iter(files.values()))
    try:
        sv.attach_document(db, doc, archivo=sv.save_upload(doc.team, filename, content))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    log(db, "Documento", f"Subido desde el panel: {doc.nombre}", doc.team, op.email)
    db.flush()
    sv.check_docs_complete(db, doc.team)
    db.commit()
    return doc_row(doc)


@app.get("/api/integrantes/{member_id}")
def integrante(member_id: int, db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    """Ficha de una persona: sus datos, su acceso, sus documentos y sus visitas recientes."""
    m = db.get(Member, member_id)
    if m is None:
        raise HTTPException(404, "Integrante no encontrado.")
    docs = db.scalars(select(Document).where(Document.member_id == m.id))
    visitas = db.scalars(select(Checkin).where(Checkin.member_id == m.id, Checkin.valido.is_(True)).order_by(Checkin.ts.desc()).limit(12))
    total = db.scalar(select(func.count(func.distinct(Checkin.fecha))).where(Checkin.member_id == m.id, Checkin.valido.is_(True)))
    return {**member_row(m), "equipo": team_brief(m.team), "documentos": [doc_row(d) for d in docs],
            "documentos_equipo": [doc_row(d) for d in db.scalars(select(Document).where(Document.team_id == m.team_id, Document.member_id.is_(None)))],
            "visitas": [c.ts.isoformat() for c in visitas], "dias_con_visita": total}


@app.get("/api/tareas")
def tareas(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    pend = db.scalars(select(Task).where(Task.estado == "Pendiente").order_by(Task.vence.is_(None), Task.vence, Task.creada))
    hechas = db.scalars(select(Task).where(Task.estado == "Hecha").order_by(Task.cerrada.desc()).limit(40))
    return {"pendientes": [task_row(t) for t in pend], "hechas": [task_row(t) for t in hechas], "hoy": date.today().isoformat()}


@app.patch("/api/tareas/{task_id}")
def tarea_update(task_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    t = db.get(Task, task_id)
    if t is None:
        raise HTTPException(404, "Tarea no encontrada.")
    hecha = bool(payload.get("hecha"))
    t.estado, t.cerrada, t.cerrada_por = ("Hecha", datetime.now(), op.email) if hecha else ("Pendiente", None, "")
    db.commit()
    return {"ok": True}


@app.get("/api/mensajes")
def mensajes(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    return {"mensajes": [msg_row(m) for m in db.scalars(select(Message).order_by(Message.ts.desc()).limit(300))],
            "plantillas": [{**row(t), "propia": t.clave.startswith(PROPIA)} for t in db.scalars(select(Template).order_by(Template.numero))]}


@app.patch("/api/mensajes/{msg_id}")
def mensaje_update(msg_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    m = db.get(Message, msg_id)
    if m is None:
        raise HTTPException(404, "Mensaje no encontrado.")
    accion = payload.get("accion")
    if m.estado in ("Bandeja", "Error"):
        for campo in ("para", "cc", "asunto", "cuerpo"):
            if campo in payload:
                setattr(m, campo, payload[campo])
    if accion == "descartar" and m.estado != "Enviado":
        m.estado = "Descartado"
    elif accion == "marcar":
        # Se envió a mano desde el Outlook del equipo (borrador abierto con mailto:): solo queda registrarlo.
        if m.estado == "Descartado":
            raise HTTPException(400, "Este mensaje está descartado.")
        if m.estado != "Enviado":
            m.estado, m.error = "Enviado", ""
            log(db, "Correo", f"Enviado desde Outlook: «{m.asunto}»", m.team, op.email)
    db.commit()
    return msg_row(m)


@app.put("/api/plantillas/{clave}")
def plantilla_update(clave: str, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    tpl = db.get(Template, clave)
    if tpl is None:
        raise HTTPException(404, "Plantilla no encontrada.")
    tpl.asunto, tpl.cuerpo = payload.get("asunto", tpl.asunto), payload.get("cuerpo", tpl.cuerpo)
    if clave.startswith(PROPIA) and str(payload.get("nombre") or "").strip():
        tpl.nombre = str(payload["nombre"]).strip()[:80]
    log(db, "Sistema", f"Plantilla «{tpl.nombre}» editada", actor=op.email)
    db.commit()
    return {**row(tpl), "propia": clave.startswith(PROPIA)}


@app.post("/api/plantillas/probar")
def plantillas_probar(payload: dict = Body(default={}), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    """«Enviarme todas las plantillas de prueba»: una por plantilla (o solo una), con datos de ejemplo, al operador."""
    ejemplo = {"equipo": "Equipo Ejemplo", "folio": "CW-0000-0000", "lider": "Líder", "nombre": "Integrante", "documentos_faltantes": "Carta compromiso",
               "retroalimentacion": "(retroalimentación del comité)", "fecha_reaplicacion": "1 de enero", "posicion_lista": 1, "espacio": 7,
               "fecha_inicio": "hoy", "semana": "lunes pasado", "dias_uso": 2, "fecha_limite": "la próxima semana", "ultimo_checkin": "hace 2 semanas",
               "fecha_baja": "hoy", "fecha_vencimiento": "en 15 días", "documento": "Constancia vigente"}
    claves = [payload["clave"]] if payload.get("clave") else [t.clave for t in db.scalars(select(Template).order_by(Template.numero))]
    for clave in claves:
        queue_message(db, clave, extra=ejemplo, para=op.email, prueba=True)
    db.commit()
    return {"creados": len(claves)}


PROPIA = "p_"  # clave de las plantillas creadas desde el panel (las 14 del sistema no se pueden borrar)


def template_fields(payload: dict) -> tuple[str, str, str]:
    nombre, asunto, cuerpo = (str(payload.get(k) or "").strip() for k in ("nombre", "asunto", "cuerpo"))
    if not nombre or not asunto or not cuerpo:
        raise HTTPException(400, "Escribe el nombre, el asunto y el cuerpo de la plantilla.")
    return nombre[:80], asunto[:300], cuerpo


@app.post("/api/plantillas")
def plantilla_create(payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    nombre, asunto, cuerpo = template_fields(payload)
    numero = (db.scalar(select(func.max(Template.numero))) or 0) + 1
    tpl = Template(clave=f"{PROPIA}{secrets.token_hex(4)}", numero=numero, nombre=nombre, asunto=asunto, cuerpo=cuerpo)
    db.add(tpl)
    log(db, "Sistema", f"Plantilla «{nombre}» creada", actor=op.email)
    db.commit()
    return {**row(tpl), "propia": True}


@app.delete("/api/plantillas/{clave}")
def plantilla_delete(clave: str, db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    tpl = db.get(Template, clave)
    if tpl is None:
        raise HTTPException(404, "Plantilla no encontrada.")
    if not clave.startswith(PROPIA):
        raise HTTPException(400, "Las plantillas del sistema no se pueden borrar; solo editar.")
    for a in db.scalars(select(Automation).where(Automation.plantilla == clave)):
        db.delete(a)
    db.delete(tpl)
    log(db, "Sistema", f"Plantilla «{tpl.nombre}» borrada", actor=op.email)
    db.commit()
    return {"ok": True}


# ---------- envíos a grupos, envíos programados y exportación ----------

def person_row(m: Member) -> dict:
    return {"id": m.id, "nombre": m.nombre, "correo": m.correo, "tipo": m.tipo, "rol": m.rol, "equipo": team_brief(m.team)}


@app.get("/api/personas")
def personas(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    """Catálogo para el filtro de destinatarios: integrantes activos y equipos."""
    miembros = db.scalars(select(Member).join(Team).where(Member.activo.is_(True)).order_by(Member.nombre))
    return {"personas": [person_row(m) for m in miembros],
            "equipos": [team_brief(t) for t in db.scalars(select(Team).order_by(Team.nombre))],
            "estados": ESTADOS, "en_operacion": EN_OPERACION}


@app.post("/api/destinatarios")
def destinatarios(payload: dict = Body(default={}), db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    gente = difusion.recipients(db, payload.get("filtro"))
    return {"total": len(gente), "descripcion": difusion.describe(db, payload.get("filtro")),
            "personas": [person_row(m) for m in gente[:500]]}


@app.post("/api/mensajes/grupo")
def mensajes_grupo(payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    try:
        n = difusion.send_to_group(db, str(payload.get("plantilla") or ""), payload.get("filtro"), op.email)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if not n:
        raise HTTPException(400, "Nadie cumple el filtro: no se creó el mensaje.")
    db.commit()
    return {"creados": n}


@app.get("/api/personas/exportar")
def personas_exportar(filtro: str = "", db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    try:
        f = json.loads(filtro) if filtro else {}
    except json.JSONDecodeError:
        raise HTTPException(400, "Filtro inválido.")
    contenido = difusion.export_xlsx(db, f)
    log(db, "Sistema", f"Exportación de personas a Excel: {difusion.describe(db, f)}", actor=op.email)
    db.commit()
    return Response(contenido, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="personas_{date.today().isoformat()}.xlsx"'})


def automation_row(db: Session, a: Automation) -> dict:
    tpl = db.get(Template, a.plantilla)
    return {**row(a), "plantilla_nombre": tpl.nombre if tpl else "(borrada)", "descripcion": difusion.describe(db, a.filtro),
            "total": len(difusion.recipients(db, a.filtro))}


def automation_fields(db: Session, a: Automation, payload: dict) -> None:
    if "nombre" in payload:
        a.nombre = str(payload["nombre"] or "").strip()[:120]
    if "plantilla" in payload:
        if db.get(Template, str(payload["plantilla"] or "")) is None:
            raise HTTPException(400, "Elige una plantilla.")
        a.plantilla = payload["plantilla"]
    if "filtro" in payload:
        a.filtro = difusion.normalize_filter(payload["filtro"])
    if "frecuencia" in payload:
        if payload["frecuencia"] not in difusion.FRECUENCIAS:
            raise HTTPException(400, "Frecuencia desconocida.")
        a.frecuencia = payload["frecuencia"]
    if "proxima" in payload:
        try:
            a.proxima = date.fromisoformat(payload["proxima"])
        except (TypeError, ValueError):
            raise HTTPException(400, "Elige la fecha del envío.")
        if a.proxima < date.today():
            raise HTTPException(400, "La fecha del envío no puede ser en el pasado.")
    if "activa" in payload:
        a.activa = bool(payload["activa"])
    if not a.nombre:
        raise HTTPException(400, "Ponle un nombre al envío programado.")


@app.get("/api/automatizaciones")
def automatizaciones(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    autos = db.scalars(select(Automation).order_by(Automation.activa.desc(), Automation.proxima))
    return {"automatizaciones": [automation_row(db, a) for a in autos]}


@app.post("/api/automatizaciones")
def automatizacion_create(payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    a = Automation(nombre="", plantilla="", creada=datetime.now(), creada_por=op.email, proxima=date.today())
    automation_fields(db, a, {"filtro": {}, **payload})
    if not a.plantilla:
        raise HTTPException(400, "Elige una plantilla.")
    db.add(a)
    log(db, "Sistema", f"Envío programado «{a.nombre}» creado ({a.frecuencia}, desde {a.proxima.isoformat()})", actor=op.email)
    db.commit()
    return automation_row(db, a)


@app.patch("/api/automatizaciones/{auto_id}")
def automatizacion_update(auto_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    a = db.get(Automation, auto_id)
    if a is None:
        raise HTTPException(404, "Envío programado no encontrado.")
    if payload.get("accion") == "ejecutar":
        n = difusion.run_automation(db, a, op.email)
        db.commit()
        return {**automation_row(db, a), "creados": n}
    automation_fields(db, a, payload)
    if a.activa and a.proxima is None:
        raise HTTPException(400, "Elige la fecha del próximo envío para reactivarlo.")
    db.commit()
    return automation_row(db, a)


@app.delete("/api/automatizaciones/{auto_id}")
def automatizacion_delete(auto_id: int, db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    a = db.get(Automation, auto_id)
    if a is None:
        raise HTTPException(404, "Envío programado no encontrado.")
    db.delete(a)
    log(db, "Sistema", f"Envío programado «{a.nombre}» borrado", actor=op.email)
    db.commit()
    return {"ok": True}


# ---------- formularios propios (editor) ----------

def get_form(db: Session, form_id: int) -> CustomForm:
    f = db.get(CustomForm, form_id)
    if f is None:
        raise HTTPException(404, "Formulario no encontrado.")
    return f


def serve_upload(ruta: str) -> FileResponse:
    """Un archivo de uploads/: PDF o imagen en línea; cualquier otra cosa, como descarga."""
    path = (UPLOADS / ruta).resolve() if ruta else None
    if path is None or UPLOADS.resolve() not in path.parents or not path.exists():
        raise HTTPException(404, "Archivo no encontrado.")
    media = sv.MEDIA.get(path.suffix.lower())
    nombre = path.name.split("_", 1)[-1]
    if media is None:
        return FileResponse(path, filename=nombre, media_type="application/octet-stream", headers={"X-Content-Type-Options": "nosniff"})
    return FileResponse(path, filename=nombre, media_type=media, content_disposition_type="inline", headers={"X-Content-Type-Options": "nosniff"})


@app.get("/api/formas")
def formas_lista(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    forms = db.scalars(select(CustomForm).order_by(CustomForm.activo.desc(), CustomForm.creado.desc()))
    return {"formularios": [formas.form_row(db, f) for f in forms], "tipos": formas.TIPOS,
            "asunto": formas.ASUNTO, "mensaje": formas.MENSAJE}


@app.post("/api/formas")
def formas_crear(payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    f = CustomForm(slug=secrets.token_urlsafe(9), titulo="", creado=datetime.now(), creado_por=op.email,
                   boton="Enviar", mensaje_final="¡Gracias! Recibimos tus respuestas.")
    origen = db.get(CustomForm, int(payload["duplicar"])) if str(payload.get("duplicar") or "").isdigit() else None
    if origen is not None:  # copia de otro formulario, sin sus respuestas
        payload = {**formas.form_row(db, origen), "titulo": f"{origen.titulo} (copia)"}
    try:
        formas.apply_fields(f, {"campos": [], **payload})
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.add(f)
    log(db, "Sistema", f"Formulario «{f.titulo}» creado", actor=op.email)
    db.commit()
    return formas.form_row(db, f)


@app.get("/api/formas/{form_id}")
def formas_detalle(form_id: int, db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    f = get_form(db, form_id)
    respuestas = db.scalars(select(FormResponse).where(FormResponse.form_id == f.id)
                            .order_by(FormResponse.respondido.is_(None), FormResponse.respondido.desc(), FormResponse.creado.desc()))
    return {**formas.form_row(db, f), "respuestas": [formas.response_row(r) for r in respuestas]}


@app.put("/api/formas/{form_id}")
def formas_editar(form_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    f = get_form(db, form_id)
    try:
        formas.apply_fields(f, payload)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    log(db, "Sistema", f"Formulario «{f.titulo}» editado", actor=op.email)
    db.commit()
    return formas.form_row(db, f)


@app.delete("/api/formas/{form_id}")
def formas_borrar(form_id: int, db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    f = get_form(db, form_id)
    for r in db.scalars(select(FormResponse).where(FormResponse.form_id == f.id)):
        db.delete(r)
    db.delete(f)
    log(db, "Sistema", f"Formulario «{f.titulo}» borrado con sus respuestas", actor=op.email)
    db.commit()
    formas.remove_files(form_id)
    return {"ok": True}


@app.post("/api/formas/{form_id}/enviar")
def formas_enviar(form_id: int, payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    f = get_form(db, form_id)
    correos = payload.get("correos") if isinstance(payload.get("correos"), list) else []
    filtro = payload.get("filtro") if isinstance(payload.get("filtro"), dict) else None
    try:
        n = formas.invite(db, f, filtro, str(payload.get("asunto") or ""), str(payload.get("mensaje") or ""), op.email, correos)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    f.asunto, f.mensaje = str(payload.get("asunto") or "")[:300], str(payload.get("mensaje") or "")[:10000]  # se recuerdan para el siguiente envío
    db.commit()
    return {"enviados": n}


@app.get("/api/formas/{form_id}/exportar")
def formas_exportar(form_id: int, db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    f = get_form(db, form_id)
    nombre = "_".join(importer.norm(f.titulo).split("_"))[:50] or "formulario"  # solo ASCII en el encabezado
    return Response(formas.export_xlsx(db, f), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{nombre}_{date.today().isoformat()}.xlsx"'})


@app.get("/api/formas/respuestas/{resp_id}/archivo/{campo_id}")
def formas_archivo(resp_id: int, campo_id: str, db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    r = db.get(FormResponse, resp_id)
    valor = next((x["valor"] for x in (r.respuestas or []) if x["id"] == campo_id and x["tipo"] == "archivo"), "") if r else ""
    return serve_upload(valor)


@app.delete("/api/formas/respuestas/{resp_id}")
def formas_respuesta_borrar(resp_id: int, db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    r = db.get(FormResponse, resp_id)
    if r is None:
        raise HTTPException(404, "Respuesta no encontrada.")
    form_id = r.form_id
    db.delete(r)
    log(db, "Sistema", f"Respuesta de {r.nombre or r.correo} borrada del formulario «{r.form.titulo}»", actor=op.email)
    db.commit()
    formas.remove_files(form_id, resp_id)
    return {"ok": True}


@app.get("/api/equipos/{team_id}/respuesta/{campo_id}")
def equipo_respuesta_archivo(team_id: int, campo_id: str, db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    t = get_team(db, team_id)
    valor = next((x["valor"] for x in (t.respuestas or []) if x.get("id") == campo_id and x.get("tipo") == "archivo"), "")
    return serve_upload(valor)


@app.get("/api/public/forma/{slug}")
def public_forma(slug: str, t: str = "", db: Session = Depends(get_db)):
    f = db.scalar(select(CustomForm).where(CustomForm.slug == slug))
    if f is None or not f.activo:
        raise HTTPException(404, "Este formulario no existe o ya no recibe respuestas.")
    r = db.scalar(select(FormResponse).where(FormResponse.form_id == f.id, FormResponse.token == t)) if t else None
    if t and r is None:
        raise HTTPException(404, "El enlace no es válido. Pide que te lo vuelvan a enviar.")
    if r is None and not f.abierto:
        raise HTTPException(403, "Este formulario solo se llena desde el enlace personal que te enviamos por correo.")
    return {"titulo": f.titulo, "intro": f.intro, "campos": f.campos or [], "boton": f.boton, "mensaje_final": f.mensaje_final,
            "color": f.color, "coworking": cfg(db, "NOMBRE"), "personal": r is not None,
            "persona": {"nombre": r.nombre, "correo": r.correo, "equipo": r.team.nombre if r.team else None} if r else None,
            "respondido": bool(r and r.estado == "Respondido")}


@app.post("/api/public/forma/{slug}")
async def public_forma_enviar(slug: str, request: Request, db: Session = Depends(get_db)):
    fields, files = await read_form(request)
    f = db.scalar(select(CustomForm).where(CustomForm.slug == slug))
    if f is None:
        raise HTTPException(404, "Este formulario no existe.")
    try:
        datos = json.loads(fields.get("datos", "{}"))
        if not isinstance(datos, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(400, "Formulario inválido.")
    try:
        formas.submit(db, f, fields.get("t", ""), datos, files)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    return {"ok": True, "mensaje": f.mensaje_final}


CONFIG_EDITABLE = ["NOMBRE", "SEMESTRE", "DIAS_MINIMOS", "SEMANAS_UPGRADE", "SEMANAS_DOWNGRADE", "SEMANAS_SIN_USO", "DIAS_RESPUESTA_BAJA",
                   "DIAS_GRACIA", "SEMANAS_PROMEDIO", "AVISO_1", "AVISO_2", "MAX_SEMANAS_PAUSA", "DIAS_HABILES_DECISION", "DIAS_REAPLICACION",
                   "DIAS_RENOVACION", "MESES_ACCESO", "MEDICION", "APROBACION_AUTOMATICA",
                   "CORREOS_OPERACION", "LINK_REGLAMENTO", "SEMANAS_EXCLUIDAS", "CATALOGO_DOCS", "RUBRICA", "PUBLIC_URL", "CARTA_COMPROMISO", "NIVELES", "FORMULARIOS", "DOMINIOS_INTERNOS", "RENOVACION_AUTOMATICA", "RENOVACION_FECHAS"]


CONFIG_NUMEROS = {"DIAS_MINIMOS": 1, "SEMANAS_UPGRADE": 1, "SEMANAS_DOWNGRADE": 1, "SEMANAS_SIN_USO": 1, "DIAS_RESPUESTA_BAJA": 1,
                  "DIAS_GRACIA": 0, "SEMANAS_PROMEDIO": 1, "AVISO_1": 1, "AVISO_2": 1, "MAX_SEMANAS_PAUSA": 0, "DIAS_HABILES_DECISION": 1,
                  "DIAS_REAPLICACION": 0, "DIAS_RENOVACION": 1, "MESES_ACCESO": 1}


CONFIG_LISTAS = {"CORREOS_OPERACION", "SEMANAS_EXCLUIDAS", "CATALOGO_DOCS", "RUBRICA", "DOMINIOS_INTERNOS", "RENOVACION_FECHAS"}


@app.get("/api/config")
def config_get(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    proxima = sv.next_renewal(db)
    return {"config": {c.clave: c.valor for c in db.scalars(select(Config)) if c.clave not in ("QR_TOKEN", "FOLIO_SALT")}, "links": links(db),
            "proxima_renovacion": proxima.isoformat() if proxima else None,
            "formularios": sv.formularios(db)}


@app.put("/api/config")
def config_put(payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    cambios = []
    for clave, valor in payload.items():
        if clave in CONFIG_NUMEROS:  # números enteros dentro de un rango razonable: un 0 o un texto rompería los cálculos
            minimo = CONFIG_NUMEROS[clave]
            if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not minimo <= valor <= 365:
                raise HTTPException(400, f"{clave} debe ser un número entre {minimo} y 365.")
            valor = int(valor)
        if clave in CONFIG_LISTAS and not isinstance(valor, list):
            raise HTTPException(400, f"{clave} debe ser una lista.")
        if clave == "CORREOS_OPERACION" and not all(isinstance(c, str) for c in valor):
            raise HTTPException(400, "CORREOS_OPERACION debe ser una lista de correos.")
        if clave == "APROBACION_AUTOMATICA" and not isinstance(valor, bool):
            raise HTTPException(400, f"{clave} debe ser verdadero o falso.")
        if clave == "FORMULARIOS":
            if not isinstance(valor, dict):
                raise HTTPException(400, "FORMULARIOS inválido.")
            for form in valor.values():
                if not isinstance(form, dict):
                    raise HTTPException(400, "FORMULARIOS inválido.")
                if "color" in form and not re.fullmatch(r"(#[0-9a-fA-F]{6})?", str(form["color"] or "")):
                    raise HTTPException(400, "El color debe ser como #1d4ed8.")
                if "preguntas" in form:
                    try:
                        form["preguntas"] = formas.clean_fields(form["preguntas"])
                    except ValueError as exc:
                        raise HTTPException(400, str(exc))
        if clave in CONFIG_EDITABLE and cfg(db, clave) != valor:
            set_cfg(db, clave, valor)
            cambios.append(clave)
    if cambios:
        log(db, "Sistema", "Configuración actualizada: " + ", ".join(cambios), actor=op.email)
    db.commit()
    return {"cambios": cambios}


# Lo que borra «Reiniciar datos», en orden para no romper llaves foráneas. Se conservan cuentas, sesiones,
# configuración, plantillas, formularios propios (sin sus respuestas), envíos programados y los 33 espacios.
DATOS = [(FormResponse, "Respuestas de formularios"), (CutItem, None), (Cut, "Cortes"), (Checkin, "Check-ins"),
         (Task, "Tareas"), (Log, "Movimientos de bitácora"), (Message, "Correos"), (ChangeRequest, "Trámites de cambios"),
         (Document, "Documentos"), (Access, None), (Member, "Personas"), (Team, "Equipos y solicitudes")]


@app.get("/api/datos/resumen")
def datos_resumen(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    return [{"nombre": nombre, "total": db.scalar(select(func.count()).select_from(modelo))} for modelo, nombre in DATOS if nombre]


@app.post("/api/datos/reiniciar")
def datos_reiniciar(payload: dict = Body(...), db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    """Deja el coworking vacío para empezar de cero. Pide la contraseña de quien lo hace y escribir BORRAR."""
    if str(payload.get("confirmacion") or "").strip().upper() != "BORRAR":
        raise HTTPException(400, "Escribe BORRAR para confirmar.")
    user = db.get(User, op.email)
    if user is None or not cuentas.check_password(str(payload.get("password") or ""), user.password_hash):
        raise HTTPException(403, "La contraseña no es correcta.")
    borrados = {nombre: db.scalar(select(func.count()).select_from(modelo)) for modelo, nombre in DATOS if nombre}
    db.execute(update(Space).values(team_id=None, desde=None))
    for modelo, _ in DATOS:
        db.execute(delete(modelo))
    log(db, "Sistema", "Datos reiniciados: " + ", ".join(f"{n} {k.lower()}" for k, n in borrados.items() if n), actor=op.email)
    db.commit()
    for hijo in UPLOADS.iterdir():  # identificaciones, cartas y archivos de formularios
        shutil.rmtree(hijo, ignore_errors=True) if hijo.is_dir() else hijo.unlink(missing_ok=True)
    return {"borrados": borrados}


@app.get("/api/bitacora")
def bitacora(tipo: str = "", db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    q = select(Log).order_by(Log.ts.desc(), Log.id.desc()).limit(400)
    if tipo:
        q = q.where(Log.tipo == tipo)
    return {"bitacora": [{**row(l), "equipo": team_brief(l.team) if l.team else None} for l in db.scalars(q)]}


@app.get("/api/cambios")
def cambios(db: Session = Depends(get_db), _: AuthSession = Depends(operator)):
    reqs = db.scalars(select(ChangeRequest).order_by(ChangeRequest.ts.desc()).limit(100))
    return {"cambios": [{**row(r, "datos"), "equipo": team_brief(r.team), "semanas": (r.datos or {}).get("semanas")} for r in reqs]}


@app.post("/api/procesos/{nombre}")
def proceso(nombre: str, db: Session = Depends(get_db), op: AuthSession = Depends(operator)):
    """Corre a mano lo que normalmente corre solo: la revisión diaria o la renovación semestral."""
    if nombre == "diario":
        result = sv.daily_review(db)
    elif nombre == "renovacion":
        result = {"equipos": sv.start_renewal(db, op.email)}
    else:
        raise HTTPException(404, "Proceso desconocido.")
    db.commit()
    return result
