"""Datos de demostración: ~50 equipos ficticios con 7 semanas de check-ins, accesos y documentos."""
import random
from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import services as sv
from .defaults import TEMPLATES, initial_config
from .mailer import log, queue_message, set_cfg
from .models import (S_ACT, S_ALERTA, S_BAJA, S_DOC, S_EVA, S_FIJO, S_NO, S_RIESGO, Access, Checkin, Config, Document,
                     Log, Member, Space, Team, Template)

NOMBRES = ["Sofía", "Mateo", "Valentina", "Santiago", "Regina", "Emiliano", "Camila", "Diego", "Ximena", "Leonardo", "Renata",
           "Sebastián", "Natalia", "Andrés", "Fernanda", "Iker", "Mariana", "Rodrigo", "Daniela", "Pablo", "Paulina", "Héctor",
           "Aitana", "Gael", "Julieta", "Bruno", "Elena", "Tomás", "Carolina", "Emilio"]
APELLIDOS = ["Hernández", "García", "Martínez", "López", "González", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz",
             "Cruz", "Morales", "Reyes", "Ortiz", "Castillo", "Vargas", "Mendoza", "Navarro", "Salazar", "Aguilar", "Ibarra"]
EQUIPOS = ["Kaxan Labs", "Milpa Digital", "Nube Agave", "Ruta Verde", "Tlali Tech", "Cobre Studio", "Faro Fintech", "Pulso Salud",
           "Orbita Logistics", "Semilla AI", "Brisa Energy", "Tinta Robotics", "Colibrí Data", "Mezcal Pay", "Ancla Legal",
           "Vértice 3D", "Lumbre Foods", "Atlas Edu", "Raíz Bio", "Cumbre Analytics", "Onda Media", "Trama Textil",
           "Nodo Agro", "Quetzal Games", "Marea Clean", "Brújula HR", "Chispa Mobility", "Aura Wearables", "Litoral Viajes",
           "Tejido Social", "Cauce Hídrico", "Zenit Aero", "Mosaico Retail", "Pixel Barro", "Voltio Storage", "Hábitat Modular",
           "Eco Bambú", "Kiosko Local", "Senda Care", "Fragua Hardware", "Lazo Market", "Prisma Vision", "Alba Cosmetics",
           "Tzolkin Time", "Cénit Solar", "Molino Coffee", "Bitácora Travel", "Sierra Outdoors", "Granito Homes", "Onix Security",
           "Vaivén Music", "Papalote Kids", "Corteza Wood"]
SECTORES = ["Fintech", "Salud", "Educación", "Agrotech", "Energía", "Logística", "Software", "Alimentos", "Hardware", "Impacto social"]
ETAPAS = ["Idea", "Prototipo", "MVP", "Primeras ventas", "Crecimiento"]


def bootstrap(db: Session) -> None:
    """Configuración, plantillas y los 33 espacios: lo mínimo para operar, con o sin datos demo."""
    if db.get(Config, "NOMBRE") is None:
        for clave, valor in initial_config().items():
            db.add(Config(clave=clave, valor=valor))
    if db.scalar(select(Template).limit(1)) is None:
        for i, (clave, nombre, asunto, cuerpo) in enumerate(TEMPLATES, start=1):
            db.add(Template(clave=clave, numero=i, nombre=nombre, asunto=asunto, cuerpo=cuerpo))
    if db.scalar(select(Space).limit(1)) is None:
        for n in range(1, 34):
            db.add(Space(numero=n, zona="A" if n <= 12 else "B" if n <= 24 else "C"))
    db.commit()


def seed(db: Session) -> None:
    rng = random.Random(7)
    today = date.today()
    w0 = sv.monday(today)  # semana en curso
    set_cfg(db, "SEMANAS_EXCLUIDAS", [{"inicio": sv.monday(date(today.year, 12, 21)).isoformat(), "motivo": "Vacaciones de invierno"},
                                      {"inicio": sv.monday(date(today.year, 12, 28)).isoformat(), "motivo": "Vacaciones de invierno"}])
    set_cfg(db, "CORREOS_OPERACION", ["operacion@coworking-gdl.mx"])
    nombres = iter(EQUIPOS)
    usados: set[str] = set()
    folio = [0]

    def persona() -> tuple[str, str]:
        while True:
            n, a = rng.choice(NOMBRES), rng.choice(APELLIDOS)
            usuario = f"{n}.{a}".lower().translate(str.maketrans("áéíóúñ", "aeioun"))
            if usuario not in usados:
                usados.add(usuario)
                return f"{n} {a}", usuario

    def team(estado: str, solicitud_hace: int, uso: list[int] | None = None, aceptado_hace: int | None = None, **kw) -> Team:
        """`uso`: días de uso por semana, de la más antigua a la semana pasada."""
        folio[0] += 1
        sol = today - timedelta(days=solicitud_hace)
        t = Team(folio=f"TMP-{folio[0]}", nombre=next(nombres), sector=rng.choice(SECTORES), etapa=rng.choice(ETAPAS),
                 descripcion="Proyecto de emprendimiento en etapa temprana que busca validar su modelo con clientes reales.",
                 lider_nombre="", lider_correo="", estado=estado, fecha_solicitud=sol, fecha_estado=today - timedelta(days=rng.randint(1, 20)), **kw)
        for i in range(rng.randint(2, 5)):
            nombre, usuario = persona()
            tipo = rng.choices(["Alumno", "Colaborador", "Externo"], [70, 12, 18])[0]
            matricula = f"A0{rng.randint(1000000, 1999999)}" if tipo == "Alumno" else f"L0{rng.randint(1000000, 1999999)}" if tipo == "Colaborador" else ""
            # Internos con correo institucional; externos con cualquier otro.
            t.members.append(Member(nombre=nombre, correo=usuario + ("@ejemplo.mx" if tipo == "Externo" else "@tec.mx"), tipo=tipo,
                                    rol="Líder" if i == 0 else "Integrante", matricula=matricula))
        t.lider_nombre, t.lider_correo = t.members[0].nombre, t.members[0].correo
        t.folio = sv.make_folio(db, t.members[0].matricula or t.lider_correo)
        db.add(t)
        db.flush()
        db.add(Log(ts=datetime.combine(sol, time(10, 0)), tipo="Estado", team_id=t.id, detalle=f"Solicitud recibida · folio {t.folio}"))
        sv.ensure_required_docs(db, t)
        docs = list(db.scalars(select(Document).where(Document.team_id == t.id)))

        if estado in (S_ACT, S_FIJO, S_RIESGO, S_ALERTA, S_BAJA, "Lista de espera"):
            acept = today - timedelta(days=aceptado_hace if aceptado_hace is not None else solicitud_hace - 8)
            t.fecha_aceptacion = acept
            t.rubrica = {r["criterio"]: rng.randint(3, 5) for r in initial_config()["RUBRICA"]}
            t.puntaje = round(sum(v / 5 * r["peso"] for v, r in zip(t.rubrica.values(), initial_config()["RUBRICA"])), 1)
            t.evaluador = "comite@coworking-gdl.mx"
            db.add(Log(ts=datetime.combine(acept, time(12, 0)), tipo="Estado", team_id=t.id, actor=t.evaluador,
                       detalle=f"En evaluación → Activo – Coworking · Aceptado · puntaje {t.puntaje}"))
            for d in docs:
                d.estado, d.fecha_carga = "Validado", sol
                d.vencimiento = today + timedelta(days=rng.randint(45, 170)) if d.clave != "identificacion" else None
                d.firma = t.lider_nombre if d.clave == "carta" else ""
            for m in t.members:
                m.access = Access(estado="Revocado" if estado == S_BAJA else "Activo", fecha_alta=acept + timedelta(days=2),
                                  vencimiento=today + timedelta(days=rng.randint(50, 175)))
            # check-ins de las semanas pasadas y de lo que va de esta
            uso = [max(0, min(5, uso[0] + rng.randint(-1, 1))) for _ in range(2)] + list(uso) if uso else []
            semanas = uso + [min(today.weekday() + 1, rng.randint(0, 3)) if (uso and uso[-1] > 0) else 0]
            for i, dias in enumerate(semanas):
                lunes = w0 - timedelta(days=7 * (len(semanas) - 1 - i))
                tope = min(today.weekday() + 1, 5) if lunes == w0 else 5  # sin check-ins en fin de semana
                for offset in rng.sample(range(tope), min(dias, tope)):
                    dia = lunes + timedelta(days=offset)
                    if dia < acept:
                        continue
                    for m in rng.sample(t.members, rng.randint(1, min(3, len(t.members)))):
                        ts = datetime.combine(dia, time(rng.randint(8, 17), rng.randint(0, 59)))
                        if ts > datetime.now():  # nada de check-ins "de hoy" con hora que aún no llega
                            ts = datetime.now() - timedelta(minutes=rng.randint(5, 120))
                            if ts.date() != dia:
                                continue
                        db.add(Checkin(ts=ts, fecha=dia, correo=m.correo, member_id=m.id, team_id=t.id))
        elif estado == S_EVA:
            for d in docs:
                d.estado, d.fecha_carga = ("Validado" if d.clave == "carta" else "Por validar"), sol
                d.firma = t.lider_nombre if d.clave == "carta" else ""
            sv.add_task(db, "Evaluar", sv.R_EVAL, f"Revisar la solicitud de {t.nombre}", t, vence=sv.add_business_days(sol, 10))
        elif estado == S_DOC:
            # Aceptaron la carta, pero falta la identificación de un integrante externo.
            if not any(m.tipo == "Externo" for m in t.members):
                t.members[-1].tipo, t.members[-1].matricula = "Externo", ""
                db.flush()
                sv.ensure_required_docs(db, t)
                docs = list(db.scalars(select(Document).where(Document.team_id == t.id)))
            for d in docs:
                if d.clave == "carta":
                    d.estado, d.fecha_carga, d.firma = "Validado", sol, t.lider_nombre
        elif estado == S_NO:
            for d in docs:
                d.estado, d.fecha_carga, d.firma = "Validado", sol, (t.lider_nombre if d.clave == "carta" else "")
            t.retroalimentacion = "El proyecto aún no define a su cliente; les sugerimos validar el problema con entrevistas antes de volver a aplicar."
            t.fecha_reaplicacion, t.puntaje = sol + timedelta(days=100), float(rng.randint(38, 55))
        return t

    estable = lambda: [rng.randint(3, 5) for _ in range(6)]
    espacios = list(db.scalars(select(Space).order_by(Space.numero)))
    con_espacio: list[Team] = []

    for _ in range(26):
        con_espacio.append(team(S_FIJO, rng.randint(60, 220), estable()))
    con_espacio.append(team(S_FIJO, 150, [4, 5, 3, 4, 4, 2]))     # → En riesgo
    con_espacio.append(team(S_FIJO, 130, [3, 4, 4, 5, 3, 1]))     # → En riesgo
    pausa = team(S_FIJO, 170, [4, 4, 3, 4, 0, 0])                 # en pausa justificada
    pausa.pausa_desde, pausa.pausa_hasta, pausa.pausa_semanas_usadas = w0 - timedelta(days=7), w0 + timedelta(days=6), 2
    con_espacio.append(pausa)
    con_espacio.append(team(S_RIESGO, 140, [4, 3, 3, 4, 2, 1]))   # → Downgrade
    con_espacio.append(team(S_RIESGO, 120, [5, 4, 3, 3, 2, 2]))   # → Downgrade
    con_espacio.append(team(S_RIESGO, 110, [3, 4, 4, 3, 1, 4]))   # → Recupera
    libres = rng.sample(espacios, 1)
    for t, sp in zip(con_espacio, [s for s in espacios if s not in libres]):
        sp.team_id, sp.desde = t.id, (t.fecha_aceptacion or today) + timedelta(days=rng.randint(14, 30))

    team(S_ACT, 70, [1, 2, 3, 2, 4, 4])       # → Upgrade
    team(S_ACT, 64, [0, 2, 2, 3, 3, 5])       # → Upgrade
    team(S_ACT, 90, [2, 1, 2, 2, 3, 3])       # → Upgrade
    team(S_ACT, 58, [1, 1, 0, 2, 3, 3])       # → Lista de espera (ya no hay lugar)
    team(S_ACT, 80, [2, 1, 1, 1, 0, 0])       # → Alerta de baja
    team(S_ACT, 75, [1, 2, 1, 0, 1, 2])
    team(S_ACT, 95, [2, 2, 1, 2, 2, 0])
    team(S_ACT, 50, [0, 0, 1, 2, 1, 1])
    nuevo = team(S_ACT, 16, [0, 0, 0, 0, 0, 1], aceptado_hace=8)  # en sus primeros 14 días
    for m in nuevo.members:
        m.access = Access()
    sv.add_task(db, "Alta de acceso", sv.R_ACC, f"Dar de alta {len(nuevo.members)} acceso(s) de {nuevo.nombre} en la plataforma de accesos",
                nuevo, vence=today + timedelta(days=1))

    a1 = team(S_ALERTA, 120, [1, 0, 0, 0, 0, 0])   # → Baja
    a1.alerta_limite = today - timedelta(days=1)
    a2 = team(S_ALERTA, 100, [2, 1, 0, 0, 0, 1])   # → Reactivar
    a2.alerta_limite = today + timedelta(days=3)

    for dias in (3, 6, 12):
        team(S_EVA, dias)
    team(S_DOC, 4)
    team(S_DOC, 9)
    team(S_NO, 40)
    team(S_NO, 25)
    for _ in range(2):
        b = team(S_BAJA, 200, [0, 0, 0, 0, 0, 0])
        b.fecha_baja = today - timedelta(days=rng.randint(20, 60))
    db.flush()

    # Vencimientos cercanos para que la revisión diaria tenga trabajo
    activos = list(db.scalars(select(Access).where(Access.estado == "Activo")))
    for acc, dias in zip(rng.sample(activos, 9), [-1, 3, 4, 9, 12, 14, 21, 26, 29]):
        acc.vencimiento = today + timedelta(days=dias)
    validados = list(db.scalars(select(Document).where(Document.estado == "Validado", Document.vencimiento.is_not(None))))
    for doc, dias in zip(rng.sample(validados, 6), [2, 8, 13, 19, 24, 28]):
        doc.vencimiento = today + timedelta(days=dias)
    por_validar = list(db.scalars(select(Document).where(Document.estado == "Por validar").limit(4)))
    for doc in por_validar:
        sv.add_task(db, "Validar documento", sv.R_ACC, f"Validar «{doc.nombre}» de {doc.team.nombre}", doc.team, doc.member)

    # Algunos check-ins inválidos de la semana
    for correo in ("visitante@correo.com", "amigo.de.alguien@correo.com"):
        ts = datetime.combine(today - timedelta(days=1), time(11, 20))
        db.add(Checkin(ts=ts, fecha=ts.date(), correo=correo, valido=False, nota="Correo no registrado"))
    sv.add_task(db, "Revisar check-in", sv.R_ADMIN, "Check-in inválido de visitante@correo.com: correo no registrado")
    db.flush()

    for t in db.scalars(select(Team).where(Team.estado == S_DOC)):
        queue_message(db, "registro", t)
        queue_message(db, "documentacion", t, extra={"documentos_faltantes": "; ".join(sv.missing_docs(db, t))})
    demo_files(db)
    sv.daily_review(db)
    sv.generate_cut(db)
    log(db, "Sistema", "Datos de demostración cargados")
    db.commit()


def sample_pdf(lines: list[str]) -> bytes:
    """Un PDF mínimo de una página con unas líneas de texto, para los documentos de demostración."""
    limpio = lambda l: l.encode("latin-1", "replace").decode("latin-1").replace("\\", "").replace("(", "[").replace(")", "]")
    stream = ("BT /F1 16 Tf 60 760 Td 22 TL " + " ".join(f"({limpio(l)}) Tj T*" for l in lines) + " ET").encode("latin-1")
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]
    out, offsets = b"%PDF-1.4\n", []
    for i, obj in enumerate(objs, start=1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj\n" + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    return out + b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + str(xref).encode() + b"\n%%EOF\n"


def demo_files(db: Session) -> None:
    """Da un archivo de ejemplo a los documentos ficticios ya cargados que no tienen uno, para poder revisarlos."""
    db.flush()
    docs = list(db.scalars(select(Document).where(Document.archivo == "", Document.enlace == "", Document.firma == "", Document.fecha_carga.is_not(None))))
    for d in docs:
        pdf = sample_pdf([d.nombre, "", f"Equipo: {d.team.nombre} ({d.team.folio})", f"Persona: {d.member.nombre if d.member else 'todo el equipo'}",
                          f"Cargado el {d.fecha_carga.isoformat()}", "", "Documento de demostracion, sin validez."])
        d.archivo = sv.save_upload(d.team, f"{d.clave}.pdf", pdf)
    db.flush()
