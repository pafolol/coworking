# Coworking GDL — panel de operación

Sistema web que reemplaza la hoja de cálculo + formularios + script del manual de operación:
33 espacios fijos que se ganan y se conservan con uso real, medido con un QR de check-in.

- `backend/` — FastAPI + SQLite (`coworking.db`). Reglas, corte semanal, vencimientos, mensajes y Gmail.
- `frontend/` — React + Vite + Tailwind. Panel de operación y los tres formularios públicos.

## Arrancar

```powershell
.\iniciar.ps1
```

O a mano, en dos terminales:

```powershell
cd backend;  .\.venv\Scripts\python -m uvicorn app.main:app --port 8010
cd frontend; npm run dev
```

Abre <http://localhost:5180> y entra con `admin` o `admin2`. Primera vez en otra máquina:

```powershell
cd backend;  python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt
cd frontend; npm install
```

## Qué hay

| Dónde | Qué |
| --- | --- |
| Inicio | Ocupación de los 33 lugares, equipos por estado, uso por semana, check-ins por día, vencimientos a 30 días, lista de espera |
| Tareas | Lo único manual: evaluar, dar/renovar/revocar accesos, validar documentos, aprobar el corte |
| Corte semanal | Propuesta de cada lunes: se aprueba (o se desmarca lo que no aplique) y salen los mensajes |
| Mensajes | Bandeja de salida (revisar, crear borrador en Gmail, enviar); las 14 plantillas del sistema más las que crees; envíos a grupos (internos/externos, líderes/integrantes, por estado, por equipo o por persona) con exportación a Excel (nombre y correo); y envíos programados (una vez, diario, semanal o mensual) |
| Solicitudes / Equipos / Espacios / Check-ins | Evaluación con rúbrica, ficha de cada equipo, plano de lugares, QR |
| Formularios | Los tres enlaces públicos (solicitud, check-in, cambios) con su QR y lo que ha llegado |
| Accesos / Documentos | Espejo de la plataforma de accesos del campus; documentos que se suben, se revisan en pantalla y se consultan por persona |
| Importar datos | Sube cualquier Excel o CSV: las columnas se reconocen solas (a OpenAI solo se le mandan los títulos de las columnas, nunca los datos), se pueden ajustar a mano, hay vista previa y luego se importa |
| Cómo funciona | El manual en una página: ciclo de vida, reglas, roles y calendario |
| Configuración | Umbrales, semanas excluidas, catálogo de documentos, rúbrica, correo |

Formularios públicos (sin sesión): `/f/solicitud`, `/f/checkin?k=…` (el QR) y `/f/cambios`.

Automático: revisión diaria a las 8:00, corte los lunes a las 7:00 y envíos programados (se revisan cada hora) (mientras el backend esté corriendo).

## Reglas que conviene conocer

- **Folio**: se deriva de la matrícula del líder (o su correo, si es externo) con una sal secreta; no es consecutivo.
- **Correos**: alumnos y colaboradores deben usar un correo de los dominios de Configuración (por defecto `tec.mx`); a los externos se les pide identificación.
- **Archivos**: solo PDF, JPG, PNG o WEBP, y se comprueba que el contenido corresponda.
- **Renovación del semestre**: arranca sola en las fechas de Configuración; cada equipo repite el proceso (integrantes y carta) y tiene los días configurados para confirmar.

## Datos de demostración

Con la base vacía se cargan ~50 equipos ficticios. Para empezar en limpio: pon `SEED_DEMO=0`
en `backend/.env`, borra `backend/coworking.db` y reinicia el backend.

## Usuarios con contraseña

Al arrancar se crean las cuentas `admin` y `admin2` con la contraseña de `LOGIN_PASSWORD` en `backend/.env`
(solo si aún no existen; en la base se guarda únicamente el hash). Para cambiarla: cambia `LOGIN_PASSWORD`,
borra las filas de la tabla `users` y reinicia el backend.

## Google: inicio de sesión y Gmail

Sin configurar, el panel entra en "modo demo" y los mensajes se quedan en la bandeja.

1. En <https://console.cloud.google.com> crea un proyecto y activa **Gmail API**.
2. Pantalla de consentimiento OAuth: tipo **Interno** (Google Workspace) y agrega el permiso
   `https://www.googleapis.com/auth/gmail.compose`.
3. Credenciales → Crear ID de cliente OAuth → **Aplicación web**. URI de redirección autorizada:
   `http://localhost:5180/api/auth/google/callback` (o la de tu dominio).
4. Copia `backend/.env.example` a `backend/.env`, pega `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, reinicia el backend.
5. Entra con Google. La primera cuenta queda como administradora y como cuenta de envío;
   las demás deben estar en Configuración → Correos del equipo operativo.

En Configuración → Correo y Google se elige qué pasa con cada mensaje: se queda en la bandeja,
se crea solo como borrador en Gmail, o se envía automáticamente. **Modo prueba** (activo de inicio)
manda todo solo al equipo operativo con el destinatario real en el asunto.
