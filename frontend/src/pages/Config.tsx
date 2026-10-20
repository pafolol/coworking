import { Copy, Plus, Trash2 } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'

import { api, fecha, useApi } from '../api'
import { Campo, Card, Chip, Page, useAccion, useToast, Vacio } from '../ui'

const REGLAS: [string, string, string][] = [
  ['DIAS_MINIMOS', 'Visitas mínimas por semana', 'por equipo; un día = una visita'],
  ['SEMANAS_UPGRADE', 'Semanas seguidas para upgrade', 'cumpliendo el mínimo'],
  ['SEMANAS_DOWNGRADE', 'Semanas bajas para downgrade', 'la primera genera alerta de uso'],
  ['SEMANAS_SIN_USO', 'Semanas sin uso para alerta de baja', 'con 0 días de uso'],
  ['DIAS_RESPUESTA_BAJA', 'Días para responder la alerta', 'después, baja'],
  ['DIAS_GRACIA', 'Días de gracia al entrar', 'sin alertas de baja'],
  ['SEMANAS_PROMEDIO', 'Semanas del promedio', 'ordena la lista de espera'],
  ['AVISO_1', 'Primer aviso de vencimiento', 'días antes'],
  ['AVISO_2', 'Segundo aviso de vencimiento', 'días antes'],
  ['MAX_SEMANAS_PAUSA', 'Semanas de pausa por semestre', 'máximo por equipo'],
  ['DIAS_HABILES_DECISION', 'Días hábiles para decidir', 'meta de servicio'],
  ['DIAS_REAPLICACION', 'Días para volver a aplicar', 'tras un No aceptado'],
  ['MESES_ACCESO', 'Vigencia sugerida del acceso', 'meses'],
]

function Interruptor({ on, onChange, label, nota }: { on: boolean; onChange: (v: boolean) => void; label: string; nota: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-left transition hover:border-brand-400">
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${on ? 'bg-brand' : 'bg-slate-300'}`}><i className={`size-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`} /></span>
      <span><b className="block text-sm font-semibold">{label}</b><span className="text-xs text-mute">{nota}</span></span>
    </button>
  )
}

export default function Config() {
  const { data, error, reload } = useApi('/config')
  const run = useAccion(reload)
  const toast = useToast()
  const [c, setC] = useState<any>(null)
  const [guardando, setGuardando] = useState(false)
  const previa = useRef<any>(null)
  // Un refetch (p. ej. tras «Correr ahora») no debe pisar lo que se está editando sin guardar.
  useEffect(() => {
    if (!data) return
    const anterior = previa.current
    previa.current = data.config
    setC((actual: any) => (actual === null || JSON.stringify(actual) === JSON.stringify(anterior) ? structuredClone(data.config) : actual))
  }, [data])
  const sucio = !!c && !!data && JSON.stringify(c) !== JSON.stringify(data.config)
  useEffect(() => {
    if (!sucio) return
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [sucio])
  if (!data || !c) return error ? <Page titulo="Configuración"><Vacio>{error}</Vacio></Page> : null
  const set = (k: string, v: any) => setC({ ...c, [k]: v })
  const guardar = async () => {
    for (const [k, label] of REGLAS) {
      const v = c[k]
      if (!Number.isInteger(v) || v < 0 || v > 365) return toast(`«${label}» debe ser un número entero entre 0 y 365.`, true)
    }
    if (!Number.isInteger(c.DIAS_RENOVACION) || c.DIAS_RENOVACION < 1 || c.DIAS_RENOVACION > 365) return toast('«Días para completar la renovación» debe ser un número entre 1 y 365.', true)
    if (c.SEMANAS_EXCLUIDAS.some((s: any) => !s.inicio)) return toast('Una semana excluida no tiene fecha: complétala o quítala.', true)
    if (c.RUBRICA.some((r: any) => !r.criterio.trim())) return toast('Un criterio de la rúbrica no tiene nombre: complétalo o quítalo.', true)
    if (c.CATALOGO_DOCS.some((d: any) => !d.nombre.trim())) return toast('Un documento del catálogo no tiene nombre: complétalo o quítalo.', true)
    // Solo lo que cambió: así no se pisan otros ajustes (niveles, formularios) editados desde otras pantallas.
    const cambios = Object.fromEntries(Object.entries(c).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(data.config[k])))
    setGuardando(true)
    await run(() => api('/config', { method: 'PUT', body: cambios }), 'Configuración guardada')
    setGuardando(false)
  }
  const lista = (k: string, i: number, campo: string, v: any) => set(k, c[k].map((x: any, j: number) => (j === i ? { ...x, [campo]: v } : x)))
  const quitar = (k: string, i: number) => set(k, c[k].filter((_: any, j: number) => j !== i))
  const copiar = (t: string) => { void navigator.clipboard.writeText(t); toast('Copiado') }

  return (
    <Page titulo="Configuración" eyebrow="Parámetros ajustables, no código"
      acciones={<button className="btn btn-primary" disabled={!sucio || guardando} onClick={guardar}>{guardando ? 'Guardando…' : sucio ? 'Guardar cambios' : 'Sin cambios'}</button>}>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card titulo="Reglas de uso y plazos" className="xl:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {REGLAS.map(([k, label, nota]) => (
              <label key={k} className="rounded-xl border border-line p-3">
                <span className="block text-[13px] font-semibold leading-tight">{label}</span>
                <span className="block text-xs text-mute">{nota}</span>
                <input type="number" min={0} max={365} step={1} className="input mt-2 !w-24 font-mono font-semibold" value={Number.isNaN(c[k]) ? '' : c[k]} onChange={e => set(k, e.target.value === '' ? NaN : Number(e.target.value))} />
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Interruptor on={c.APROBACION_AUTOMATICA} onChange={v => set('APROBACION_AUTOMATICA', v)} label="Aprobación automática del corte"
              nota="Apagada: cada lunes alguien aprueba la propuesta. Enciéndela cuando el equipo confíe en las reglas." />
            <div className="rounded-xl border border-line bg-brand-50 p-3">
              <b className="block text-sm font-semibold">Las visitas se cuentan por equipo y por día</b>
              <span className="text-xs text-mute">Un día en que vino al menos un integrante es una visita, hayan venido uno o todos. El equipo necesita {c.DIAS_MINIMOS} visitas por semana.</span>
            </div>
          </div>
        </Card>

        <Card titulo="Correo">
          <div className="space-y-3">
            <Interruptor on={c.MODO_PRUEBA} onChange={v => set('MODO_PRUEBA', v)} label="Modo prueba"
              nota="Todos los correos van solo al equipo operativo, con el destinatario real en el asunto. Apágalo al arrancar en serio." />
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
              Por ahora no hay cuenta de correo conectada: los mensajes se quedan en la bandeja de Mensajes y no sale ningún correo.
            </p>
            <Campo label="Correos del equipo operativo" ayuda="Uno por línea. Son quienes reciben los correos en modo prueba.">
              <textarea className="input min-h-20 font-mono text-[13px]" value={c.CORREOS_OPERACION.join('\n')} onChange={e => set('CORREOS_OPERACION', e.target.value.split('\n').map(x => x.trim().toLowerCase()).filter(Boolean))} />
            </Campo>
          </div>
        </Card>

        <div className="space-y-5">
          <Card titulo="Formularios públicos">
            <div className="flex gap-4">
              <div className="shrink-0 rounded-xl border border-line p-2"><QRCodeSVG value={data.links.checkin} size={96} fgColor="#06123a" /></div>
              <ul className="min-w-0 flex-1 space-y-2">
                {[['Solicitud', data.links.solicitud], ['Check-in (QR)', data.links.checkin], ['Cambios', data.links.cambios]].map(([l, url]) => (
                  <li key={l}>
                    <span className="eyebrow">{l}</span>
                    <div className="flex items-center gap-1">
                      <a href={url} target="_blank" className="mono min-w-0 flex-1 truncate text-brand hover:underline">{url}</a>
                      <button className="btn btn-ghost !p-1" aria-label={`Copiar enlace de ${l}`} title="Copiar enlace" onClick={() => copiar(url)}><Copy size={13} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 grid gap-3">
              <Campo label="Dirección pública del sitio" ayuda="Se usa para armar los enlaces y el QR. Cámbiala cuando lo publiques en un dominio.">
                <input className="input font-mono text-[13px]" value={c.PUBLIC_URL} onChange={e => set('PUBLIC_URL', e.target.value)} />
              </Campo>
              <Campo label="Enlace al reglamento"><input className="input" placeholder="https://…" value={c.LINK_REGLAMENTO} onChange={e => set('LINK_REGLAMENTO', e.target.value)} /></Campo>
            </div>
          </Card>
          <Card titulo="General">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Nombre del espacio"><input className="input" value={c.NOMBRE} onChange={e => set('NOMBRE', e.target.value)} /></Campo>
              <Campo label="Semestre en curso"><input className="input" value={c.SEMESTRE} onChange={e => set('SEMESTRE', e.target.value)} /></Campo>
              <div className="sm:col-span-2"><Campo label="Dominios de correo institucional" ayuda="Alumnos y colaboradores deben registrarse con un correo de estos dominios; los externos, con cualquiera. Separa varios con coma. Vacío = no se revisa.">
                <input className="input font-mono text-[13px]" placeholder="tec.mx" value={(c.DOMINIOS_INTERNOS ?? []).join(', ')}
                  onChange={e => set('DOMINIOS_INTERNOS', e.target.value.split(',').map(x => x.trim().toLowerCase().replace(/^@/, '')).filter(Boolean))} />
              </Campo></div>
            </div>
          </Card>
          <Card titulo="Renovación del semestre">
            <div className="space-y-3">
              <Interruptor on={!!c.RENOVACION_AUTOMATICA} onChange={v => set('RENOVACION_AUTOMATICA', v)} label="Renovación automática"
                nota="En cada fecha de inicio, todos los equipos en operación reciben el mensaje para repetir el proceso: revisar integrantes, volver a aceptar la carta y confirmar." />
              <div>
                <p className="label">Fechas de inicio (cada año)</p>
                <div className="flex flex-wrap items-center gap-2">
                  {(c.RENOVACION_FECHAS ?? []).map((f: string, i: number) => (
                    <span key={i} className="flex items-center gap-1 rounded-lg border border-line bg-white py-1 pl-2 pr-1">
                      <input type="date" className="bg-transparent text-sm outline-none" aria-label="Fecha de inicio de renovación" value={`${new Date().getFullYear()}-${f}`}
                        onChange={e => e.target.value && set('RENOVACION_FECHAS', c.RENOVACION_FECHAS.map((x: string, j: number) => (j === i ? e.target.value.slice(5) : x)))} />
                      <button className="btn btn-ghost !p-1 text-mute" title="Quitar fecha" aria-label="Quitar fecha" onClick={() => set('RENOVACION_FECHAS', c.RENOVACION_FECHAS.filter((_: string, j: number) => j !== i))}><Trash2 size={13} /></button>
                    </span>
                  ))}
                  <button className="btn" onClick={() => set('RENOVACION_FECHAS', [...(c.RENOVACION_FECHAS ?? []), '08-10'])}><Plus size={14} /> Agregar fecha</button>
                </div>
                <p className="mt-1 text-xs text-mute">Solo cuentan el día y el mes; el año se ignora.</p>
              </div>
              <label className="flex items-center gap-3 rounded-xl border border-line p-3">
                <span className="flex-1"><b className="block text-sm font-semibold">Días para completar la renovación</b><span className="text-xs text-mute">Reciben un recordatorio {c.AVISO_2} días antes; quien no confirme a tiempo entra en alerta de baja.</span></span>
                <input type="number" min={1} max={365} step={1} className="input !w-20 font-mono font-semibold" value={Number.isNaN(c.DIAS_RENOVACION) ? '' : c.DIAS_RENOVACION} onChange={e => set('DIAS_RENOVACION', e.target.value === '' ? NaN : Number(e.target.value))} />
              </label>
              <p className="text-xs text-mute">
                {c.RENOVACION_AUTOMATICA ? (data.proxima_renovacion ? <>Próxima renovación automática: <b className="text-ink">{fecha(data.proxima_renovacion)}</b>.</> : 'Agrega al menos una fecha para que corra sola.') : 'Apagada: solo corre si la inicias a mano abajo.'}
                {c.RENOVACION_ULTIMA && <> La última se inició el {fecha(c.RENOVACION_ULTIMA)}.</>}
              </p>
            </div>
          </Card>
          <Card titulo="Procesos a mano">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
                <span><b className="block text-sm font-semibold">Revisión diaria de vencimientos</b><span className="text-xs text-mute">Corre sola todos los días a las 8:00.</span></span>
                <button className="btn" onClick={() => run(async () => { const r = await api('/procesos/diario', { method: 'POST' }); toast(`Accesos avisados: ${r.accesos_avisados} · vencidos: ${r.accesos_vencidos} · documentos: ${r.documentos_avisados}`) })}>Correr ahora</button>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
                <span><b className="block text-sm font-semibold">Iniciar la renovación ahora</b><span className="text-xs text-mute">Lo mismo que la automática, pero hoy: todos repiten el proceso y tienen {c.DIAS_RENOVACION} días.</span></span>
                <button className="btn" onClick={() => sucio ? toast('Guarda los cambios primero: la renovación usa la configuración guardada.', true) : confirm(`Se pedirá la renovación de ${c.SEMESTRE} a todos los equipos en operación. ¿Continuar?`) && run(async () => { const r = await api('/procesos/renovacion', { method: 'POST' }); toast(`Renovación iniciada para ${r.equipos} equipos`) })}>Iniciar</button>
              </div>
            </div>
          </Card>
        </div>

        <Card titulo="Semanas que no cuentan" extra={<button className="btn" onClick={() => set('SEMANAS_EXCLUIDAS', [...c.SEMANAS_EXCLUIDAS, { inicio: '', motivo: '' }])}><Plus size={14} /> Agregar</button>}>
          <p className="mb-3 text-xs text-mute">Vacaciones, semanas especiales y cierres del campus: se excluyen del cálculo del corte. Basta cualquier día de esa semana.</p>
          <div className="space-y-2">
            {c.SEMANAS_EXCLUIDAS.map((s: any, i: number) => (
              <div key={i} className="flex gap-2">
                <input type="date" className="input !w-44" aria-label="Día de la semana excluida" value={s.inicio} onChange={e => lista('SEMANAS_EXCLUIDAS', i, 'inicio', e.target.value)} />
                <input className="input" placeholder="Motivo" aria-label="Motivo" value={s.motivo} onChange={e => lista('SEMANAS_EXCLUIDAS', i, 'motivo', e.target.value)} />
                <button className="btn btn-ghost !px-2 text-mute" aria-label="Quitar semana" title="Quitar" onClick={() => quitar('SEMANAS_EXCLUIDAS', i)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </Card>

        <Card titulo="Rúbrica de evaluación" extra={<button className="btn" onClick={() => set('RUBRICA', [...c.RUBRICA, { criterio: '', peso: 10 }])}><Plus size={14} /> Agregar</button>}>
          <div className="space-y-2">
            {c.RUBRICA.map((r: any, i: number) => (
              <div key={i} className="flex gap-2">
                <input className="input" placeholder="Criterio" aria-label="Criterio" value={r.criterio} onChange={e => lista('RUBRICA', i, 'criterio', e.target.value)} />
                <input type="number" min={0} className="input !w-20 font-mono" aria-label="Peso del criterio" value={r.peso} onChange={e => lista('RUBRICA', i, 'peso', Number(e.target.value))} />
                <button className="btn btn-ghost !px-2 text-mute" aria-label="Quitar criterio" title="Quitar" onClick={() => quitar('RUBRICA', i)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-mute">Cada criterio se califica de 1 a 5; los pesos suman {c.RUBRICA.reduce((s: number, r: any) => s + (r.peso || 0), 0)}.</p>
        </Card>

        <Card titulo="Catálogo de documentos" className="xl:col-span-2"
          extra={<button className="btn" onClick={() => set('CATALOGO_DOCS', [...c.CATALOGO_DOCS, { clave: `doc${Date.now() % 10000}`, nombre: '', nivel: 'Equipo', aplica: 'Todos', vigencia_meses: 6, obligatorio: true, modo: 'archivo' }])}><Plus size={14} /> Agregar</button>}>
          <div className="space-y-2">
            <div className="hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-mute md:flex"><span className="min-w-52 flex-1">Documento</span><span className="w-44">Cómo se entrega</span><span className="w-32">Nivel</span><span className="w-32">Aplica a</span><span className="w-28">Vigencia (meses)</span><span className="w-24">Obligatorio</span><span className="w-9" /></div>
            {c.CATALOGO_DOCS.map((d: any, i: number) => (
              <div key={d.clave} className="flex flex-wrap items-center gap-2">
                <input className="input min-w-52 flex-1" aria-label="Nombre del documento" value={d.nombre} onChange={e => lista('CATALOGO_DOCS', i, 'nombre', e.target.value)} />
                <select className="input !w-44" aria-label="Cómo se entrega" value={d.modo ?? 'archivo'} onChange={e => lista('CATALOGO_DOCS', i, 'modo', e.target.value)}><option value="archivo">Se sube archivo</option><option value="firma">Se acepta y firma</option></select>
                <select className="input !w-32" aria-label="Nivel" value={d.nivel} onChange={e => lista('CATALOGO_DOCS', i, 'nivel', e.target.value)}><option>Equipo</option><option>Persona</option></select>
                <select className="input !w-32" aria-label="Aplica a" value={d.aplica} disabled={d.nivel === 'Equipo'} onChange={e => lista('CATALOGO_DOCS', i, 'aplica', e.target.value)}><option>Todos</option><option>Internos</option><option>Externos</option></select>
                <input type="number" min={1} className="input !w-28 font-mono" aria-label="Vigencia en meses" placeholder="sin vencer" value={d.vigencia_meses ?? ''} onChange={e => lista('CATALOGO_DOCS', i, 'vigencia_meses', e.target.value ? Number(e.target.value) : null)} />
                <label className="flex w-24 items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={d.obligatorio} onChange={e => lista('CATALOGO_DOCS', i, 'obligatorio', e.target.checked)} /> Sí</label>
                <button className="btn btn-ghost !px-2 text-mute" aria-label="Quitar documento" title="Quitar" onClick={() => confirm('¿Quitar este documento del catálogo?') && quitar('CATALOGO_DOCS', i)}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-mute">«Internos» son alumnos y colaboradores; vigencia vacía significa sin vencimiento. Lo que «se acepta y firma» usa el texto de abajo y no guarda archivos.</p>
          <div className="mt-4"><Campo label="Texto de la carta compromiso" ayuda="Es lo que el equipo lee y acepta en el formulario. {{dias_minimos}} se reemplaza por el mínimo de visitas.">
            <textarea className="input min-h-56 text-[13px] leading-relaxed" value={c.CARTA_COMPROMISO ?? ''} onChange={e => set('CARTA_COMPROMISO', e.target.value)} />
          </Campo></div>
        </Card>
      </div>
    </Page>
  )
}
