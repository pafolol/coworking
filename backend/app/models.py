from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# Los 10 estados del ciclo de vida de un equipo
S_SOL = "Solicitud recibida"
S_DOC = "Documentación pendiente"
S_EVA = "En evaluación"
S_NO = "No aceptado"
S_ACT = "Activo – Coworking"
S_ESP = "Lista de espera"
S_FIJO = "Espacio fijo"
S_RIESGO = "En riesgo"
S_ALERTA = "Alerta de baja"
S_BAJA = "Baja"

ESTADOS = [S_SOL, S_DOC, S_EVA, S_NO, S_ACT, S_ESP, S_FIJO, S_RIESGO, S_ALERTA, S_BAJA]
EN_OPERACION = [S_ACT, S_ESP, S_FIJO, S_RIESGO, S_ALERTA]
CON_ESPACIO = [S_FIJO, S_RIESGO]


class Team(Base):
    __tablename__ = "teams"
    id: Mapped[int] = mapped_column(primary_key=True)
    folio: Mapped[str] = mapped_column(String(20), unique=True)
    nombre: Mapped[str] = mapped_column(String(120))
    descripcion: Mapped[str] = mapped_column(Text, default="")
    etapa: Mapped[str] = mapped_column(String(60), default="")
    sector: Mapped[str] = mapped_column(String(60), default="")
    lider_nombre: Mapped[str] = mapped_column(String(120))
    lider_correo: Mapped[str] = mapped_column(String(160))
    estado: Mapped[str] = mapped_column(String(40), default=S_SOL)
    fecha_solicitud: Mapped[date]
    fecha_estado: Mapped[date]
    fecha_aceptacion: Mapped[Optional[date]]
    fecha_baja: Mapped[Optional[date]]
    fecha_reaplicacion: Mapped[Optional[date]]
    retroalimentacion: Mapped[str] = mapped_column(Text, default="")
    rubrica: Mapped[Optional[dict]] = mapped_column(JSON)
    puntaje: Mapped[Optional[float]]
    evaluador: Mapped[str] = mapped_column(String(160), default="")
    alerta_limite: Mapped[Optional[date]]
    pausa_desde: Mapped[Optional[date]]
    pausa_hasta: Mapped[Optional[date]]
    pausa_semanas_usadas: Mapped[int] = mapped_column(default=0)
    renovacion_limite: Mapped[Optional[date]]
    renovacion_confirmada: Mapped[bool] = mapped_column(default=True)
    notas: Mapped[str] = mapped_column(Text, default="")
    respuestas: Mapped[Optional[list]] = mapped_column(JSON)  # preguntas extra del formulario: [{etiqueta, valor}]

    members: Mapped[list["Member"]] = relationship(back_populates="team", cascade="all, delete-orphan")
    space: Mapped[Optional["Space"]] = relationship(back_populates="team", uselist=False)


class Member(Base):
    __tablename__ = "members"
    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    nombre: Mapped[str] = mapped_column(String(120))
    correo: Mapped[str] = mapped_column(String(160), index=True)
    tipo: Mapped[str] = mapped_column(String(20), default="Alumno")  # Alumno | Colaborador | Externo
    matricula: Mapped[str] = mapped_column(String(40), default="")
    rol: Mapped[str] = mapped_column(String(20), default="Integrante")  # Líder | Integrante
    activo: Mapped[bool] = mapped_column(default=True)

    team: Mapped[Team] = relationship(back_populates="members")
    access: Mapped[Optional["Access"]] = relationship(back_populates="member", uselist=False, cascade="all, delete-orphan")


class Space(Base):
    __tablename__ = "spaces"
    numero: Mapped[int] = mapped_column(primary_key=True)
    zona: Mapped[str] = mapped_column(String(20), default="")
    team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"))
    desde: Mapped[Optional[date]]

    team: Mapped[Optional[Team]] = relationship(back_populates="space")


class Checkin(Base):
    __tablename__ = "checkins"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime]
    fecha: Mapped[date] = mapped_column(index=True)
    correo: Mapped[str] = mapped_column(String(160))
    member_id: Mapped[Optional[int]] = mapped_column(ForeignKey("members.id"))
    team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"), index=True)
    valido: Mapped[bool] = mapped_column(default=True)
    nota: Mapped[str] = mapped_column(String(200), default="")
    origen: Mapped[str] = mapped_column(String(20), default="QR")  # QR | Manual


class Cut(Base):
    __tablename__ = "cuts"
    id: Mapped[int] = mapped_column(primary_key=True)
    semana: Mapped[date] = mapped_column(index=True)  # lunes de la semana medida
    creado: Mapped[datetime]
    estado: Mapped[str] = mapped_column(String(20), default="Propuesta")  # Propuesta | Aplicado
    aplicado_por: Mapped[str] = mapped_column(String(160), default="")
    aplicado_en: Mapped[Optional[datetime]]
    nota: Mapped[str] = mapped_column(String(300), default="")

    items: Mapped[list["CutItem"]] = relationship(back_populates="cut", cascade="all, delete-orphan")


class CutItem(Base):
    __tablename__ = "cut_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    cut_id: Mapped[int] = mapped_column(ForeignKey("cuts.id"))
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    estado_actual: Mapped[str] = mapped_column(String(40))
    dias: Mapped[int] = mapped_column(default=0)
    dias_previa: Mapped[int] = mapped_column(default=0)
    promedio: Mapped[float] = mapped_column(default=0)
    accion: Mapped[str] = mapped_column(String(40), default="Sin cambio")
    estado_nuevo: Mapped[str] = mapped_column(String(40), default="")
    detalle: Mapped[str] = mapped_column(String(300), default="")
    aprobada: Mapped[bool] = mapped_column(default=True)
    resultado: Mapped[str] = mapped_column(String(200), default="")

    cut: Mapped[Cut] = relationship(back_populates="items")
    team: Mapped[Team] = relationship()


class Access(Base):
    __tablename__ = "accesses"
    id: Mapped[int] = mapped_column(primary_key=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("members.id"), unique=True)
    tipo: Mapped[str] = mapped_column(String(40), default="Credencial")
    fecha_alta: Mapped[Optional[date]]
    vencimiento: Mapped[Optional[date]]
    estado: Mapped[str] = mapped_column(String(20), default="Pendiente")  # Pendiente | Activo | Vencido | Revocado
    aviso_1: Mapped[bool] = mapped_column(default=False)
    aviso_2: Mapped[bool] = mapped_column(default=False)

    member: Mapped[Member] = relationship(back_populates="access")


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    member_id: Mapped[Optional[int]] = mapped_column(ForeignKey("members.id"))
    clave: Mapped[str] = mapped_column(String(40))
    nombre: Mapped[str] = mapped_column(String(160))
    archivo: Mapped[str] = mapped_column(String(300), default="")  # nombre en uploads/
    enlace: Mapped[str] = mapped_column(String(400), default="")
    firma: Mapped[str] = mapped_column(String(200), default="")  # nombre de quien aceptó, si se firma en el formulario
    fecha_carga: Mapped[Optional[date]]
    vencimiento: Mapped[Optional[date]]
    estado: Mapped[str] = mapped_column(String(20), default="Faltante")  # Faltante | Por validar | Validado | Rechazado | Vencido
    aviso_1: Mapped[bool] = mapped_column(default=False)
    aviso_2: Mapped[bool] = mapped_column(default=False)

    team: Mapped[Team] = relationship()
    member: Mapped[Optional[Member]] = relationship()


class Template(Base):
    __tablename__ = "templates"
    clave: Mapped[str] = mapped_column(String(40), primary_key=True)
    numero: Mapped[int]
    nombre: Mapped[str] = mapped_column(String(80))
    asunto: Mapped[str] = mapped_column(String(300))
    cuerpo: Mapped[str] = mapped_column(Text)


class Config(Base):
    __tablename__ = "config"
    clave: Mapped[str] = mapped_column(String(60), primary_key=True)
    valor: Mapped[Optional[Any]] = mapped_column(JSON)


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str] = mapped_column(String(40))
    rol: Mapped[str] = mapped_column(String(40))
    titulo: Mapped[str] = mapped_column(String(240))
    detalle: Mapped[str] = mapped_column(Text, default="")
    team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"))
    member_id: Mapped[Optional[int]] = mapped_column(ForeignKey("members.id"))
    estado: Mapped[str] = mapped_column(String(20), default="Pendiente")  # Pendiente | Hecha
    creada: Mapped[datetime]
    vence: Mapped[Optional[date]]
    cerrada: Mapped[Optional[datetime]]
    cerrada_por: Mapped[str] = mapped_column(String(160), default="")

    team: Mapped[Optional[Team]] = relationship()


class Log(Base):
    __tablename__ = "logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(index=True)
    tipo: Mapped[str] = mapped_column(String(20))  # Estado | Correo | Sistema | Acceso | Documento | Cambio
    team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"), index=True)
    detalle: Mapped[str] = mapped_column(Text)
    actor: Mapped[str] = mapped_column(String(160), default="Sistema")

    team: Mapped[Optional[Team]] = relationship()


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(index=True)
    plantilla: Mapped[str] = mapped_column(String(40))
    team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"))
    para: Mapped[str] = mapped_column(String(300))
    cc: Mapped[str] = mapped_column(Text, default="")
    asunto: Mapped[str] = mapped_column(String(400))
    cuerpo: Mapped[str] = mapped_column(Text)
    estado: Mapped[str] = mapped_column(String(20), default="Bandeja")  # Bandeja | Borrador | Enviado | Error | Descartado
    gmail_id: Mapped[str] = mapped_column(String(80), default="")
    error: Mapped[str] = mapped_column(String(400), default="")
    prueba: Mapped[bool] = mapped_column(default=False)

    team: Mapped[Optional[Team]] = relationship()


class ChangeRequest(Base):
    __tablename__ = "change_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime]
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    tipo: Mapped[str] = mapped_column(String(40))  # Alta de integrante | Baja de integrante | Documento | Pausa | Renovación
    detalle: Mapped[str] = mapped_column(Text, default="")
    estado: Mapped[str] = mapped_column(String(20), default="Aplicado")  # Aplicado | Pendiente | Rechazado
    datos: Mapped[Optional[dict]] = mapped_column(JSON)

    team: Mapped[Team] = relationship()


class GoogleAccount(Base):
    __tablename__ = "google_accounts"
    email: Mapped[str] = mapped_column(String(160), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(160), default="")
    foto: Mapped[str] = mapped_column(String(400), default="")
    refresh_token: Mapped[str] = mapped_column(String(400), default="")
    access_token: Mapped[str] = mapped_column(Text, default="")
    expira: Mapped[Optional[datetime]]
    gmail: Mapped[bool] = mapped_column(default=False)


class AuthSession(Base):
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String(80), primary_key=True)
    email: Mapped[str] = mapped_column(String(160))
    nombre: Mapped[str] = mapped_column(String(160), default="")
    foto: Mapped[str] = mapped_column(String(400), default="")
    demo: Mapped[bool] = mapped_column(default=False)
    creada: Mapped[datetime]


class Automation(Base):
    """Envío programado de una plantilla a un grupo de personas (filtro por tipo, rol, estado, equipo o persona)."""
    __tablename__ = "automations"
    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120))
    plantilla: Mapped[str] = mapped_column(String(40))
    filtro: Mapped[Optional[dict]] = mapped_column(JSON)
    frecuencia: Mapped[str] = mapped_column(String(20), default="una_vez")  # una_vez | diaria | semanal | mensual
    proxima: Mapped[Optional[date]]
    activa: Mapped[bool] = mapped_column(default=True)
    ultima: Mapped[Optional[datetime]]
    ultimo_total: Mapped[int] = mapped_column(default=0)
    creada: Mapped[datetime]
    creada_por: Mapped[str] = mapped_column(String(160), default="")


class User(Base):
    """Cuenta local del panel (usuario y contraseña), además de Google."""
    __tablename__ = "users"
    usuario: Mapped[str] = mapped_column(String(60), primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120), default="")
    password_hash: Mapped[str] = mapped_column(String(200))


class CustomForm(Base):
    """Formulario hecho en el editor: se manda por correo (cada persona con su enlace) o se comparte abierto."""
    __tablename__ = "custom_forms"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(40), unique=True)
    titulo: Mapped[str] = mapped_column(String(160))
    intro: Mapped[str] = mapped_column(Text, default="")
    campos: Mapped[Optional[list]] = mapped_column(JSON)  # [{id, etiqueta, tipo, ayuda, obligatoria, opciones, texto}]
    boton: Mapped[str] = mapped_column(String(80), default="Enviar")
    mensaje_final: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(20), default="")
    abierto: Mapped[bool] = mapped_column(default=False)  # cualquiera con el enlace general puede responder
    activo: Mapped[bool] = mapped_column(default=True)
    asunto: Mapped[str] = mapped_column(String(300), default="")
    mensaje: Mapped[str] = mapped_column(Text, default="")
    creado: Mapped[datetime]
    creado_por: Mapped[str] = mapped_column(String(160), default="")


class FormResponse(Base):
    """Una invitación (Pendiente, con su token) o una respuesta (Respondido) a un formulario propio."""
    __tablename__ = "form_responses"
    id: Mapped[int] = mapped_column(primary_key=True)
    form_id: Mapped[int] = mapped_column(ForeignKey("custom_forms.id"), index=True)
    token: Mapped[str] = mapped_column(String(60), unique=True)
    correo: Mapped[str] = mapped_column(String(160), default="")
    nombre: Mapped[str] = mapped_column(String(160), default="")
    team_id: Mapped[Optional[int]] = mapped_column(ForeignKey("teams.id"))
    member_id: Mapped[Optional[int]] = mapped_column(ForeignKey("members.id"))
    creado: Mapped[datetime]
    respondido: Mapped[Optional[datetime]]
    estado: Mapped[str] = mapped_column(String(20), default="Pendiente")  # Pendiente | Respondido
    respuestas: Mapped[Optional[list]] = mapped_column(JSON)  # [{id, etiqueta, tipo, valor}]; archivo → ruta en uploads/

    form: Mapped[CustomForm] = relationship()
    team: Mapped[Optional[Team]] = relationship()
