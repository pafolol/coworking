import { ArrowLeft, PauseCircle, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { api, enDias, fecha, fechaHora, useApi } from '../api'
import { Campo, Card, Chip, Estado, Estatus, Modal, Page, Tabla, useAccion, Vacio } from '../ui'
import { AccesoModal, DocAcciones, PersonaLink } from './shared'

const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function MapaUso({ t }: { t: any }) {
  const con = new Set<string>(t.dias_con_checkin)
  const hoy = iso(new Date())
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      <div className="flex flex-col gap-1">
        {DIAS.map((d, i) => <span key={i} className="grid h-5 place-items-center font-mono text-[10px] text-mute">{d}</span>)}
      </div>
      {t.semanas.map((s: string, w: number) => {
        const lunes = new Date(`${s}T12:00:00`)
        const n = t.uso[w]
        const excluida = t.excluidas.includes(s)
        return (
          <div key={s} className="flex flex-col items-center gap-1">
            {DIAS.map((_, i) => {
              const dia = iso(new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i))
              return <span key={i} title={con.has(dia) ? `${dia} · con visita` : dia} className={`size-5 rounded-[5px] ${con.has(dia) ? 'bg-brand' : dia > hoy ? 'border border-dashed border-line' : i > 4 ? 'bg-slate-50' : 'bg-slate-100'}`} />
            })}
            <span className={`mt-1 grid size-6 place-items-center rounded-md font-mono text-[11px] font-semibold ${excluida ? 'bg-slate-100 text-slate-400 line-through' : n >= t.minimo ? 'bg-spark text-ink' : n > 0 ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400'}`}>{n}</span>
            <span className="font-mono text-[9.5px] text-mute">{lunes.getDate()}/{lunes.getMonth() + 1}</span>
          </div>
        )
      })}
    </div>
  )
}

export function Evaluar({ t, onClose, reload }: { t: any; onClose: () => void; reload: () => unknown }) {
  const [rubrica, setRubrica] = useState<Record<string, number>>({})
  const faltan = t.rubrica_config.filter((r: any) => !rubrica[r.criterio]).length
  const [retro, setRetro] = useState('')
  const run = useAccion(reload)
  const [busy, setBusy] = useState(false)
  const total = t.rubrica_config.reduce((s: number, r: any) => s + r.peso, 0) || 1
  const puntaje = Math.round(t.rubrica_config.reduce((s: number, r: any) => s + ((rubrica[r.criterio] ?? 0) / 5) * r.peso, 0) / total * 100)
  const decidir = async (decision: string) => {
    if (busy) return
    setBusy(true)
    const ok = await run(() => api(`/equipos/${t.id}/evaluar`, { body: { decision, rubrica, retroalimentacion: retro } }),
      decision === 'Aceptado' ? 'Aceptado: salió el mensaje de bienvenida y la tarea de accesos' : 'No aceptado: salió el mensaje con la retroalimentación')
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <Modal titulo={`Evaluar a ${t.nombre}`} onClose={onClose} ancho="max-w-xl">
      <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm">
        <p className="eyebrow">{t.folio} · {t.sector || 'sin sector'} · {t.etapa || 'sin etapa'} · {t.integrantes} integrante(s)</p>
        <p className="mt-1 max-h-28 overflow-y-auto text-ink/80">{t.descripcion || 'Sin descripción.'}</p>
        {(t.respuestas ?? []).map((r: any) => <p key={r.etiqueta} className="mt-1.5 text-[13px]"><b>{r.etiqueta}:</b> <span className="text-ink/80">{r.valor}</span></p>)}
      </div>
      {t.faltantes.length > 0 && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Aún falta: {t.faltantes.join('; ')}.</p>}
      <div className="space-y-3">
        {t.rubrica_config.map((r: any) => (
          <div key={r.criterio} className="flex items-center gap-3">
            <div className="flex-1"><p className="text-sm font-semibold">{r.criterio}</p><p className="text-xs text-mute">peso {r.peso}%</p></div>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRubrica({ ...rubrica, [r.criterio]: n })} aria-label={`${r.criterio}: ${n} de 5`} aria-pressed={rubrica[r.criterio] === n}
                  className={`size-8 cursor-pointer rounded-lg font-mono text-sm font-semibold transition ${rubrica[r.criterio] >= n ? 'bg-brand text-white' : 'bg-slate-100 text-slate-400 hover:bg-brand-100'}`}>{n}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="my-5 flex items-center justify-between rounded-xl bg-ink px-4 py-3 text-white">
        <span className="eyebrow !text-white/50">Puntaje</span>
        <span className="font-display text-3xl font-extrabold">{faltan ? '—' : puntaje}<span className="text-base text-white/50">/100</span></span>
      </div>
      <Campo label="Retroalimentación del comité" ayuda="Obligatoria si no se acepta: va tal cual en el mensaje al equipo.">
        <textarea className="input min-h-24" required value={retro} onChange={e => setRetro(e.target.value)} />
      </Campo>
      <div className="mt-5 flex justify-end gap-2">
        {faltan > 0 && <span className="mr-auto self-center text-xs text-mute">Califica {faltan === t.rubrica_config.length ? 'los criterios' : `${faltan} criterio(s) más`} para poder decidir.</span>}
        <button className="btn btn-danger" disabled={faltan > 0 || busy || !retro.trim()} title={!retro.trim() ? 'Escribe la retroalimentación para poder marcar No aceptado' : undefined} onClick={() => confirm(`¿Marcar a ${t.nombre} como NO aceptado? Sale el mensaje con la retroalimentación.`) && decidir('No aceptado')}>No aceptado</button>
        <button className="btn btn-primary" disabled={faltan > 0 || busy} onClick={() => confirm(`¿Aceptar a ${t.nombre}? Sale el mensaje de bienvenida.`) && decidir('Aceptado')}>Aceptado</button>
      </div>
    </Modal>
  )
}

export default function EquipoDetalle() {
  const { id } = useParams()
  // key: al cambiar de equipo se reinicia todo el estado (modales, formularios y datos del equipo anterior).
  return <EquipoVista key={id} id={id} />
}

function EquipoVista({ id }: { id?: string }) {
  const { data: t, reload, error } = useApi(`/equipos/${id}`)
  const runBase = useAccion(reload)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    if (busy) return false
    setBusy(true)
    try { return await runBase(fn, ok) } finally { setBusy(false) }
  }
  const [modal, setModal] = useState<'evaluar' | 'estado' | 'pausa' | 'integrante' | null>(null)
  const [acceso, setAcceso] = useState<any>(null)
  const [form, setForm] = useState<any>({})
  if (!t) return error ? <Page titulo="Equipo"><Link to="/equipos" className="mb-4 inline-flex items-center gap-1 text-sm text-mute hover:text-brand"><ArrowLeft size={14} /> Equipos</Link><Vacio>{error}</Vacio></Page> : <p className="p-10 text-center text-sm text-mute" role="status">Cargando…</p>
  const preDecision = ['Solicitud recibida', 'Documentación pendiente', 'En evaluación'].includes(t.estado)
  const abrir = (m: typeof modal, inicial: any = {}) => { setForm(inicial); setModal(m) }
  const cerrar = () => setModal(null)
  const enviar = async (fn: () => Promise<unknown>, ok: string) => { if (await run(fn, ok)) cerrar() }

  return (
    <Page titulo={t.nombre} eyebrow={`${t.folio} · ${t.sector || 'sin sector'} · ${t.etapa || 'sin etapa'}`}
      acciones={
        <>
          {preDecision && <button className="btn btn-primary" onClick={() => setModal('evaluar')}>Evaluar con rúbrica</button>}
          {t.fecha_aceptacion && t.estado !== 'Baja' && (t.en_pausa
            ? <button className="btn" disabled={busy} onClick={() => run(() => api(`/equipos/${t.id}/pausa`, { body: { quitar: true } }), 'Pausa terminada')}><PauseCircle size={14} /> Terminar pausa</button>
            : <button className="btn" onClick={() => abrir('pausa', { semanas: 1 })}><PauseCircle size={14} /> Pausa justificada</button>)}
          <button className="btn" onClick={() => abrir('estado', { estado: t.estado, motivo: '' })}>Cambiar estado</button>
        </>
      }>
      <Link to="/equipos" className="-mt-3 mb-4 inline-flex items-center gap-1 text-sm text-mute hover:text-brand"><ArrowLeft size={14} /> Equipos</Link>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Estado estado={t.estado} />
        {t.espacio && <Chip tono="tinta">Espacio {t.espacio}</Chip>}
        {t.nivel && <Link to="/niveles"><Chip tono="lima">Nivel {t.nivel.nivel}</Chip></Link>}
        {t.en_pausa && <Chip tono="gris"><PauseCircle size={12} /> En pausa hasta {fecha(t.pausa_hasta)}</Chip>}
        {t.alerta_limite && <Chip tono="rojo">Responder antes del {fecha(t.alerta_limite)}</Chip>}
        {!t.renovacion_confirmada && t.renovacion_limite && <Chip tono="ambar">Renovación sin confirmar · límite {fecha(t.renovacion_limite)}</Chip>}
        {t.faltantes.length > 0 && <Chip tono="ambar">{t.faltantes.length} documento(s) por resolver</Chip>}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <div className="space-y-5">
          {t.fecha_aceptacion && (
            <Card titulo="Uso del espacio" extra={<span className="text-xs text-mute">12 semanas · el número son las visitas del equipo; lima = cumple {t.minimo}+</span>}>
              <MapaUso t={t} />
              <p className="mt-3 text-xs text-mute">Último check-in: {fecha(t.ultimo_checkin)}. Un día con check-in de cualquier integrante es una visita del equipo, vengan uno o todos.</p>
            </Card>
          )}

          <Card titulo="Integrantes y accesos" pad={false} extra={<button className="btn" onClick={() => abrir('integrante', { nombre: '', correo: '', tipo: 'Alumno', matricula: '' })}><Plus size={14} /> Agregar</button>}>
            <Tabla cols={['Persona', 'Tipo', 'Acceso', 'Vence', '']}>
              {t.miembros.map((m: any) => (
                <tr key={m.id} className={`row ${m.activo ? '' : 'opacity-45'}`}>
                  <td className="td"><p><PersonaLink id={m.id} nombre={m.nombre} reload={reload} /> {m.rol === 'Líder' && <Chip tono="lima">Líder</Chip>}</p><p className="text-xs text-mute">{m.correo}</p></td>
                  <td className="td text-mute">{m.tipo}{m.matricula && <span className="mono block">{m.matricula}</span>}</td>
                  <td className="td">{!m.activo ? <Chip>Baja</Chip> : m.acceso ? <Estatus valor={m.acceso.estado} /> : <span className="text-mute">—</span>}</td>
                  <td className="td mono text-mute">{fecha(m.acceso?.vencimiento)}</td>
                  <td className="td">
                    <div className="flex justify-end gap-1">
                      {m.activo && m.acceso && <button className="btn" onClick={() => setAcceso({ acceso: m.acceso, persona: m.nombre })}>{m.acceso.estado === 'Pendiente' ? 'Dar de alta' : 'Renovar'}</button>}
                      {m.activo && m.rol !== 'Líder' && <button className="btn btn-ghost !px-2 text-mute" title="Dar de baja" aria-label={`Dar de baja a ${m.nombre}`} disabled={busy} onClick={() => confirm(`¿Dar de baja a ${m.nombre}? Se cierra su acceso y deja de contar como integrante del equipo.`) && run(() => api(`/integrantes/${m.id}`, { method: 'DELETE' }), 'Integrante dado de baja')}><Trash2 size={14} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </Tabla>
          </Card>

          <Card titulo="Documentos" pad={false}>
            <Tabla cols={['Documento', 'De', 'Estado', 'Vence', '']} vacio={t.documentos.length === 0}>
              {t.documentos.map((d: any) => (
                <tr key={d.id} className="row">
                  <td className="td font-medium">{d.nombre}</td>
                  <td className="td"><PersonaLink id={d.member_id} nombre={d.persona} reload={reload} /></td>
                  <td className="td"><Estatus valor={d.estado} /></td>
                  <td className="td mono text-mute">{d.vencimiento ? fecha(d.vencimiento) : d.estado === 'Validado' ? 'sin vencimiento' : '—'}</td>
                  <td className="td"><DocAcciones doc={d} reload={reload} /></td>
                </tr>
              ))}
            </Tabla>
          </Card>

          <Card titulo="Mensajes al equipo" pad={false}>
            {t.mensajes.length === 0 ? <div className="p-5"><Vacio>Aún no hay mensajes.</Vacio></div> : (
              <ul className="max-h-72 overflow-y-auto">
                {t.mensajes.map((m: any) => (
                  <li key={m.id} className="row flex items-center gap-3 px-5 py-2.5 text-sm">
                    <Estatus valor={m.estado} />
                    <span className="min-w-0 flex-1 truncate" title={m.asunto}>{m.asunto}</span>
                    <span className="mono text-mute">{fechaHora(m.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {t.nivel && (
            <Card titulo={`Nivel ${t.nivel.nivel}`} extra={<Link to="/niveles" className="text-xs font-semibold text-brand">Ver niveles</Link>}>
              <p className="text-sm text-mute">Promedio de <b className="text-ink">{t.nivel.promedio}</b> visitas por semana · <b className="text-ink">{t.nivel.racha}{t.nivel.racha_tope ? '+' : ''}</b> semana(s) seguidas cumpliendo.</p>
              <ul className="mt-3 space-y-1.5 text-sm">{t.nivel.beneficios.map((b: string) => <li key={b} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{b}</li>)}</ul>
              {t.nivel.siguiente && <p className="mt-3 border-t border-line pt-3 text-xs text-mute">Para subir a <b className="text-ink">{t.nivel.siguiente}</b>: {t.nivel.falta}.</p>}
            </Card>
          )}

          <Card titulo="Ficha">
            <dl className="space-y-3 text-sm">
              <div><dt className="eyebrow">Líder</dt><dd className="font-semibold">{t.lider_nombre}</dd><dd className="text-mute">{t.lider_correo}</dd></div>
              <div><dt className="eyebrow">Proyecto</dt><dd className="text-mute">{t.descripcion || '—'}</dd></div>
              {(t.respuestas ?? []).map((r: any) => <div key={r.etiqueta}><dt className="eyebrow">{r.etiqueta}</dt><dd className="whitespace-pre-line text-mute">{r.valor}</dd></div>)}
              <div className="grid grid-cols-2 gap-3">
                <div><dt className="eyebrow">Solicitud</dt><dd>{fecha(t.fecha_solicitud)}</dd></div>
                <div><dt className="eyebrow">Aceptación</dt><dd>{fecha(t.fecha_aceptacion)}</dd></div>
                <div><dt className="eyebrow">Puntaje</dt><dd className="font-display text-xl font-bold">{t.puntaje ?? '—'}</dd></div>
                <div><dt className="eyebrow">Pausa usada</dt><dd>{t.pausa_semanas_usadas} de {t.max_pausa} sem.</dd></div>
              </div>
              {t.retroalimentacion && <div><dt className="eyebrow">Retroalimentación</dt><dd className="text-mute">{t.retroalimentacion}</dd></div>}
              {t.fecha_reaplicacion && <div><dt className="eyebrow">Puede reaplicar</dt><dd>{fecha(t.fecha_reaplicacion)}</dd></div>}
            </dl>
          </Card>

          {t.tareas.length > 0 && (
            <Card titulo="Tareas pendientes">
              <ul className="space-y-2">
                {t.tareas.map((k: any) => (
                  <li key={k.id} className="flex items-start gap-2 rounded-xl border border-line p-3 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 accent-brand" checked={false} disabled={busy} aria-label={`Marcar como hecha: ${k.titulo}`} onChange={() => run(() => api(`/tareas/${k.id}`, { method: 'PATCH', body: { hecha: true } }), 'Tarea hecha')} />
                    <span className="flex-1">{k.titulo}{k.vence && <span className="ml-1 text-xs text-mute">· {enDias(Math.round((new Date(`${k.vence}T12:00:00`).getTime() - new Date(`${iso(new Date())}T12:00:00`).getTime()) / 864e5))}</span>}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card titulo="Bitácora" pad={false}>
            {t.bitacora.length === 0 && <div className="p-5"><Vacio>Sin movimientos todavía.</Vacio></div>}
            <ol className="max-h-[420px] overflow-y-auto px-5 pb-4">
              {t.bitacora.map((l: any) => (
                <li key={l.id} className="relative border-l border-line pb-3 pl-4 last:pb-0">
                  <i className={`absolute -left-[4.5px] top-1.5 size-2 rounded-full ${l.tipo === 'Estado' ? 'bg-brand' : l.tipo === 'Correo' ? 'bg-spark ring-1 ring-ink/20' : 'bg-slate-300'}`} />
                  <p className="text-[13px] leading-snug">{l.detalle}</p>
                  <p className="text-[11px] text-mute">{fechaHora(l.ts)} · {l.actor}</p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      {modal === 'evaluar' && <Evaluar t={t} onClose={cerrar} reload={reload} />}
      {acceso && <AccesoModal {...acceso} onClose={() => setAcceso(null)} reload={reload} />}
      {modal === 'estado' && (
        <Modal titulo="Cambiar estado a mano" onClose={cerrar} ancho="max-w-md">
          <p className="mb-4 text-sm text-mute">Es una excepción: queda en la bitácora y <b>no envía correos</b>. Lo normal es que el estado lo mueva una decisión registrada o el corte semanal.</p>
          <Campo label="Nuevo estado">
            <select className="input" value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value })}>
              {['Solicitud recibida', 'Documentación pendiente', 'En evaluación', 'No aceptado', 'Activo – Coworking', 'Lista de espera', 'Espacio fijo', 'En riesgo', 'Alerta de baja', 'Baja'].map(e => <option key={e}>{e}</option>)}
            </select>
          </Campo>
          <div className="mt-3"><Campo label="Motivo"><input className="input" value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} placeholder="Por qué se hace la excepción" /></Campo></div>
          <div className="mt-5 flex justify-end"><button className="btn btn-primary" disabled={busy || form.estado === t.estado} onClick={() => (['Baja', 'No aceptado'].includes(form.estado) ? confirm(`¿Pasar a ${t.nombre} a «${form.estado}»? ${form.estado === 'Baja' ? 'Libera su lugar y deja de operar.' : 'Sale de la evaluación.'}`) : true) && enviar(() => api(`/equipos/${t.id}`, { method: 'PATCH', body: form }), 'Estado actualizado')}>Guardar</button></div>
        </Modal>
      )}
      {modal === 'pausa' && (
        <Modal titulo="Pausa justificada" onClose={cerrar} ancho="max-w-md">
          <p className="mb-4 text-sm text-mute">El equipo conserva su lugar y el corte no lo evalúa durante la pausa. Máximo {t.max_pausa} semanas por semestre; lleva {t.pausa_semanas_usadas}.</p>
          <Campo label="Semanas (incluye la actual)">
            <select className="input" value={form.semanas} onChange={e => setForm({ semanas: Number(e.target.value) })}>
              {Array.from({ length: t.max_pausa }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select>
          </Campo>
          <div className="mt-5 flex justify-end"><button className="btn btn-primary" disabled={busy} onClick={() => enviar(() => api(`/equipos/${t.id}/pausa`, { body: form }), 'Pausa aprobada')}>Aprobar pausa</button></div>
        </Modal>
      )}
      {modal === 'integrante' && (
        <Modal titulo="Agregar integrante" onClose={cerrar} ancho="max-w-md">
          <div className="space-y-3">
            <Campo label="Nombre completo"><input className="input" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} /></Campo>
            <Campo label="Correo"><input className="input" type="email" value={form.correo} onChange={e => setForm({ ...form, correo: e.target.value })} /></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Tipo"><select className="input" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}><option>Alumno</option><option>Colaborador</option><option>Externo</option></select></Campo>
              <Campo label="Matrícula o nómina"><input className="input" value={form.matricula} onChange={e => setForm({ ...form, matricula: e.target.value })} /></Campo>
            </div>
          </div>
          <div className="mt-5 flex justify-end"><button className="btn btn-primary" disabled={busy || !form.nombre?.trim() || !form.correo?.includes('@')} onClick={() => enviar(() => api(`/equipos/${t.id}/integrantes`, { body: form }), 'Integrante agregado: se creó la tarea de acceso')}>Agregar</button></div>
        </Modal>
      )}
    </Page>
  )
}
