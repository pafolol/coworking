"""Valores iniciales: configuración, catálogo de documentos, rúbrica y las 14 plantillas."""
import os
import secrets

CARTA = """Al aceptar esta carta, el equipo se compromete a:

1. Usar el coworking de forma constante. Los equipos con espacio fijo deben registrar al menos {{dias_minimos}} visitas por semana; una visita es un día en que al menos un integrante hizo check-in.
2. Registrar cada visita con el código QR que está dentro del espacio, usando el correo con el que cada integrante fue registrado.
3. Mantener al día la lista de integrantes y avisar de altas y bajas con el formulario de cambios.
4. Cuidar el espacio, el mobiliario y la convivencia con los demás equipos, y respetar el reglamento.
5. Aceptar que el espacio fijo se reasigna si el equipo deja de usarlo, y que el acceso se da de baja tras varias semanas sin visitas ni respuesta.

Quien firma declara que la información de la solicitud es verdadera y que todos los integrantes conocen estos compromisos."""

# Niveles por constancia, del más bajo al más alto. Un equipo tiene el nivel más alto cuyos dos requisitos cumple:
# promedio de visitas por semana y racha de semanas seguidas alcanzando el mínimo.
NIVELES = [
    {"nombre": "Explorador", "promedio_min": 0, "racha_min": 0,
     "beneficios": ["Acceso a las áreas comunes", "Eventos y talleres abiertos de la comunidad"]},
    {"nombre": "Constante", "promedio_min": 3, "racha_min": 2,
     "beneficios": ["Puede ganar y conservar un espacio fijo", "Reserva de sala de juntas: 2 h por semana", "Un invitado por semana"]},
    {"nombre": "Destacado", "promedio_min": 4, "racha_min": 4,
     "beneficios": ["Sala de juntas: 4 h por semana", "Locker para el equipo", "Prioridad en mentorías y talleres con cupo"]},
    {"nombre": "Embajador", "promedio_min": 4.5, "racha_min": 8,
     "beneficios": ["Sala de juntas: 6 h por semana", "Primera opción al elegir espacio fijo", "Lugar en demo days y visitas de inversionistas",
                    "Acceso en horario extendido"]},
]

# Lo que se puede cambiar de cada formulario público desde el editor (Formularios → Editar).
# En los textos, {{dias_minimos}} y {{semanas_upgrade}} se reemplazan por los valores de Configuración.
FORMULARIOS = {
    "solicitud": {
        "titulo": "Solicita tu lugar",
        "intro": "Convocatoria abierta para equipos emprendedores. Entras con Acceso Coworking; si tu equipo registra {{dias_minimos}}+ visitas "
                 "por semana durante {{semanas_upgrade}} semanas seguidas, puede ganar uno de los 33 espacios fijos.",
        "pregunta_descripcion": "¿Qué problema resuelven, para quién y qué avance llevan?",
        "etapas": ["Idea", "Prototipo", "MVP", "Primeras ventas", "Crecimiento"],
        "pedir_sector": True,
        "preguntas": [],  # campos de formas.py: {id, etiqueta, tipo, ayuda, opciones, obligatoria, texto}
        "mensaje_final": "Te enviamos la confirmación por correo. Revisaremos tu proyecto y te escribiremos con el resultado.",
        "color": "",
        "titulo_proyecto": "El proyecto",
        "etiqueta_nombre": "Nombre del equipo o proyecto",
        "etiqueta_etapa": "Etapa",
        "etiqueta_sector": "Sector",
        "titulo_integrantes": "Integrantes",
        "texto_integrantes": "",  # vacío: se explica la regla del correo institucional
        "titulo_carta": "Carta compromiso",
        "boton": "Enviar solicitud",
    },
    "checkin": {
        "titulo": "Check-in",
        "intro": "Escribe el correo con el que estás registrado en tu equipo.",
        "boton": "Registrar mi visita",
        "color": "",
    },
    "cambios": {
        "titulo": "Cambios en tu equipo",
        "intro": "Altas y bajas de integrantes, documentos, pausas y renovación del semestre.",
        "permitir_altas": True,
        "permitir_bajas": True,
        "permitir_pausa": True,
        "color": "",
        "titulo_documentos": "Identificaciones y otros documentos",
        "titulo_integrantes": "Integrantes",
        "titulo_pausa": "Pausa justificada",
    },
}

CONFIG = {
    "NIVELES": NIVELES,
    # Alumnos y colaboradores deben registrarse con un correo de estos dominios; los externos, con cualquiera.
    "DOMINIOS_INTERNOS": ["tec.mx"],
    # Renovación del semestre: en cada fecha (MM-DD) se manda a todos a repetir el proceso; tienen DIAS_RENOVACION días.
    "RENOVACION_AUTOMATICA": True,
    "RENOVACION_FECHAS": ["01-15", "08-10"],
    "RENOVACION_ULTIMA": "",
    "FORMULARIOS": FORMULARIOS,
    "NOMBRE": "Coworking GDL",
    "SEMESTRE": "Agosto–Diciembre 2026",
    "DIAS_MINIMOS": 3,
    "SEMANAS_UPGRADE": 2,
    "SEMANAS_DOWNGRADE": 2,
    "SEMANAS_SIN_USO": 2,
    "DIAS_RESPUESTA_BAJA": 7,
    "DIAS_GRACIA": 14,
    "SEMANAS_PROMEDIO": 4,
    "AVISO_1": 15,
    "AVISO_2": 5,
    "MAX_SEMANAS_PAUSA": 2,
    "DIAS_HABILES_DECISION": 10,
    "DIAS_REAPLICACION": 90,
    "DIAS_RENOVACION": 15,
    "MESES_ACCESO": 6,
    "MEDICION": "equipo",
    "APROBACION_AUTOMATICA": False,
    "MODO_PRUEBA": True,
    "CORREOS_OPERACION": [],
    "LINK_REGLAMENTO": "",
    "SEMANAS_EXCLUIDAS": [],
    # modo "firma": se acepta en el formulario (sin archivo). modo "archivo": se sube un PDF o imagen.
    "CATALOGO_DOCS": [
        {"clave": "carta", "nombre": "Carta compromiso y reglamento", "nivel": "Equipo", "aplica": "Todos", "vigencia_meses": 6, "obligatorio": True, "modo": "firma"},
        {"clave": "identificacion", "nombre": "Identificación oficial (INE o pasaporte)", "nivel": "Persona", "aplica": "Externos", "vigencia_meses": None, "obligatorio": True, "modo": "archivo"},
    ],
    "CARTA_COMPROMISO": CARTA,
    "RUBRICA": [
        {"criterio": "Claridad del problema y la solución", "peso": 25},
        {"criterio": "Equipo y dedicación", "peso": 25},
        {"criterio": "Avance y tracción", "peso": 20},
        {"criterio": "Potencial de impacto", "peso": 15},
        {"criterio": "Uso previsto del espacio", "peso": 15},
    ],
}


def initial_config() -> dict:
    config = dict(CONFIG)
    config["QR_TOKEN"] = secrets.token_urlsafe(8)
    config["PUBLIC_URL"] = os.environ.get("FRONTEND_URL", "http://localhost:5180")
    return config


# (clave, nombre, asunto, cuerpo) en el orden del manual
TEMPLATES = [
    ("registro", "Confirmación de registro",
     "Recibimos tu solicitud al {{coworking}} — Folio {{folio}}",
     "Hola {{lider}}: recibimos la solicitud de {{equipo}}. Tu folio es {{folio}}. En los próximos {{dias_decision}} días hábiles revisaremos tu proyecto y te escribiremos con el resultado. Si necesitas actualizar algo, responde a este correo citando tu folio."),
    ("documentacion", "Documentación pendiente",
     "Falta documentación para continuar tu solicitud — {{folio}}",
     "Hola {{lider}}: para evaluar a {{equipo}} necesitamos: {{documentos_faltantes}}. Puedes subirlos aquí: {{link_formulario_cambios}}. Tu solicitud queda en pausa hasta recibirlos."),
    ("aceptacion", "Aceptación",
     "¡Bienvenidos al {{coworking}}, {{equipo}}!",
     "Hola {{lider}}: {{equipo}} fue aceptado con Acceso Coworking. En los próximos días daremos de alta los accesos de tu equipo; te avisaremos cuando estén activos. Cómo funciona: registren cada visita con el QR de check-in; los equipos que usan el espacio {{dias_minimos}} o más días por semana durante {{semanas_upgrade}} semanas seguidas pueden ganar un espacio fijo. Reglamento: {{link_reglamento}}."),
    ("no_aceptacion", "No aceptación",
     "Resultado de tu solicitud al {{coworking}} — {{folio}}",
     "Hola {{lider}}: gracias por tu interés. En esta ocasión {{equipo}} no fue aceptado. Retroalimentación del comité: {{retroalimentacion}}. Puedes volver a aplicar a partir del {{fecha_reaplicacion}}."),
    ("lista_espera", "Lista de espera",
     "Ya califican para un espacio fijo — están en lista de espera",
     "Hola {{lider}}: {{equipo}} cumplió la regla de uso para un espacio fijo, pero hoy los {{total_espacios}} lugares están ocupados. Quedan en la posición {{posicion_lista}} de la lista de espera; mantengan su uso para conservar la prioridad."),
    ("upgrade", "Upgrade a Espacio Fijo",
     "¡{{equipo}} ganó un espacio fijo!",
     "Hola {{lider}}: por su constancia, {{equipo}} tiene asignado el espacio {{espacio}} a partir del {{fecha_inicio}}. Para conservarlo, usen el coworking al menos {{dias_minimos}} días por semana y registren cada visita con el QR."),
    ("alerta_uso", "Alerta de uso (En riesgo)",
     "Aviso: su espacio fijo está en riesgo",
     "Hola {{lider}}: la semana del {{semana}} registraron {{dias_uso}} días de uso; el mínimo para conservar el espacio {{espacio}} es {{dias_minimos}}. Si la próxima semana tampoco lo alcanzan, el espacio se reasignará. Si hubo un motivo justificado, respóndenos para revisar una pausa."),
    ("downgrade", "Downgrade",
     "Cambio de modalidad: de Espacio Fijo a Acceso Coworking",
     "Hola {{lider}}: por dos semanas seguidas con menos de {{dias_minimos}} días de uso, el espacio {{espacio}} se liberó. {{equipo}} conserva su Acceso Coworking y puede recuperar un lugar fijo cumpliendo de nuevo la regla. Por favor retiren sus pertenencias antes del {{fecha_limite}}."),
    ("alerta_baja", "Alerta de baja",
     "Aviso importante: su acceso al coworking podría darse de baja",
     "Hola {{lider}}: no hemos registrado visitas de {{equipo}} desde el {{ultimo_checkin}}. Si quieren conservar su lugar en el coworking, registren un check-in o respóndannos antes del {{fecha_limite}}. Después de esa fecha, el equipo se dará de baja."),
    ("baja", "Baja",
     "Baja del {{coworking}} — {{equipo}}",
     "Hola {{lider}}: al no registrar actividad ni respuesta, {{equipo}} fue dado de baja del coworking el {{fecha_baja}} y sus accesos serán desactivados. Gracias por haber sido parte; pueden volver a aplicar cuando quieran en {{link_solicitud}}."),
    ("acceso_por_vencer", "Acceso por vencer",
     "Tu acceso al coworking vence el {{fecha_vencimiento}}",
     "Hola {{nombre}}: tu acceso vence el {{fecha_vencimiento}}. Si tu equipo sigue activo, estamos gestionando la renovación y te avisaremos al quedar lista. Si ya no participarás, respóndenos para darte de baja."),
    ("acceso_activo", "Acceso activado o renovado",
     "Tu acceso al coworking está activo hasta el {{fecha_vencimiento}}",
     "Hola {{nombre}}: tu acceso quedó activo y vence el {{fecha_vencimiento}}. Recuerda registrar cada visita con el QR de check-in."),
    ("documento_por_vencer", "Documento por vencer",
     "Actualiza tu documentación: {{documento}} vence el {{fecha_vencimiento}}",
     "Hola {{nombre}}: {{documento}} vence el {{fecha_vencimiento}}. Súbelo actualizado aquí: {{link_formulario_cambios}}."),
    ("renovacion", "Renovación semestral",
     "Confirma tu permanencia en el {{coworking}} — {{semestre}}",
     "Hola {{lider}}: iniciamos {{semestre}}. Confirma integrantes y actualiza documentos de {{equipo}} antes del {{fecha_limite}} en {{link_formulario_cambios}}. Los equipos que no confirmen pasarán a alerta de baja."),
]
