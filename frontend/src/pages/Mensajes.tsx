import { CalendarClock, Download, FilePenLine, Pause, Play, Plus, Send, Trash2 } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, fecha, fechaHora, useApi } from '../api'
import { Campo, Card, Chip, Estado, Estatus, Filtros, Page, useAccion, Vacio } from '../ui'

function Bandeja({ data, reload }: { data: any; reload: () => unknown }) {
  const run = useAccion(reload)
  const [filtro, setFiltro] = useState('Bandeja')
  const [id, setId] = useState<number | null>(null)
  const [edit, setEdit] = useState<any>(null)
  const lista = data.mensajes.filter((m: any) => filtro === 'todos' || m.estado === filtro)
  const sel = data.mensajes.find((m: any) => m.id === id) ?? lista[0]
  useEffect(() => { setEdit(sel ? { para: sel.para, cc: sel.cc, asunto: sel.asunto, cuerpo: sel.cuerpo } : null) }, [sel?.id])
  const editable = sel && ['Bandeja', 'Error'].includes(sel.estado)
  const enBandeja = data.mensajes.filter((m: any) => m.estado === 'Bandeja').length
  const [ocupado, setOcupado] = useState(false)
  const enCurso = async (fn: () => Promise<unknown>) => {
    if (ocupado) return
    setOcupado(true)
    try { await fn() } finally { setOcupado(false) }
  }
  const accion = (a: string, ok: string) => enCurso(() => run(async () => {
    const r = await api(`/mensajes/${sel.id}`, { method: 'PATCH', body: { ...(editable ? edit : {}), accion: a } })
    // El servidor responde 200 aunque Gmail falle: el mensaje queda en «Error» y no hay que anunciar un éxito.
    if (r.estado === 'Error') { await reload(); throw new Error(r.error || 'Gmail no aceptó el mensaje. Revisa el error en el mensaje.') }
  }, ok))
  const enviarUno = () => {
    const destino = data.modo_prueba ? 'Modo prueba: saldrá solo al equipo operativo.' : `Saldrá a ${edit.para}.`
    if (confirm(`Se enviará por Gmail «${sel.asunto}». ${destino} ¿Continuar?`)) void accion('enviar', 'Mensaje enviado')
  }
  const lote = (a: string) => confirm(a === 'enviar' ? `Se enviarán por Gmail los ${enBandeja} mensajes de la bandeja${data.modo_prueba ? ' (modo prueba: solo al equipo operativo)' : ''}. ¿Continuar?` : `Se crearán ${enBandeja} borradores en Gmail con los mensajes de la bandeja. ¿Continuar?`)
    && enCurso(() => run(async () => {
      const r = await api('/mensajes/entregar', { body: { accion: a } })
      if (!r.entregados) { await reload(); throw new Error('No se entregó ningún mensaje; revisa los errores.') }
      if (r.entregados < enBandeja) { await reload(); throw new Error(`Solo se entregaron ${r.entregados} de ${enBandeja}; revisa los que quedaron en Error.`) }
    }, a === 'enviar' ? 'Mensajes enviados' : 'Borradores creados en Gmail'))

  return (
    <>
      <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${data.cuenta ? 'border-line bg-white' : 'border-amber-200 bg-amber-50'}`}>
        {data.cuenta ? (
          <>
            <span className="size-2 rounded-full bg-emerald-500" />
            <span>Gmail conectado: <b>{data.cuenta}</b></span>
            <Chip tono="azul">{{ bandeja: 'Revisión manual', borrador: 'Borradores automáticos', enviar: 'Envío automático' }[data.modo_envio as string]}</Chip>
            {data.modo_prueba && <Chip tono="lima">Modo prueba</Chip>}
            <span className="flex-1" />
            {enBandeja > 0 && <>
              <button className="btn" disabled={ocupado} onClick={() => lote('borrador')}><FilePenLine size={14} /> Crear {enBandeja} borradores en Gmail</button>
              <button className="btn btn-primary" disabled={ocupado} onClick={() => lote('enviar')}><Send size={14} /> Enviar los {enBandeja}</button>
            </>}
          </>
        ) : (
          <>
            <span className="size-2 rounded-full bg-amber-500" />
            <span className="flex-1">Sin cuenta de Gmail conectada: los mensajes se quedan aquí, listos para revisar. {data.google ? 'Inicia sesión con Google para crear borradores o enviarlos.' : 'Configura Google OAuth para crear borradores o enviarlos.'}</span>
            <Link to="/config" className="btn">Configurar correo</Link>
          </>
        )}
      </div>
      <div className="mb-4">
        <Filtros valor={filtro} onChange={f => { setFiltro(f); setId(null) }} opciones={[
          ...['Bandeja', 'Borrador', 'Enviado', 'Error', 'Descartado'].map(e => ({ id: e, label: e === 'Bandeja' ? 'Por revisar' : e, n: data.mensajes.filter((m: any) => m.estado === e).length })),
          { id: 'todos', label: 'Todos', n: data.mensajes.length },
        ]} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(320px,0.9fr)_1.3fr]">
        <Card pad={false}>
          <ul className="max-h-[680px] overflow-y-auto">
            {lista.length === 0 && <li className="p-5"><Vacio>Nada en esta vista.</Vacio></li>}
            {lista.map((m: any) => (
              <li key={m.id}>
                <button onClick={() => setId(m.id)} className={`w-full cursor-pointer border-b border-line px-4 py-3 text-left transition ${sel?.id === m.id ? 'bg-brand-50' : 'hover:bg-brand-50/50'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold">{m.equipo?.nombre ?? m.para}</span>
                    <span className="mono shrink-0 text-[11px] text-mute">{fechaHora(m.ts)}</span>
                  </div>
                  <p className="truncate text-[13px] text-mute">{m.asunto}</p>
                  <div className="mt-1 flex gap-1.5"><Estatus valor={m.estado} />{m.prueba && <Chip tono="lima">prueba</Chip>}</div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="lg:sticky lg:top-5 lg:self-start">
          {!sel || !edit ? <Vacio>Elige un mensaje.</Vacio> : (
            <div className="space-y-3">
              <div className="flex items-center gap-2"><Estatus valor={sel.estado} />{sel.equipo && <Link className="text-sm font-semibold text-brand hover:underline" to={`/equipos/${sel.equipo.id}`}>{sel.equipo.nombre}</Link>}<span className="mono ml-auto text-mute">{sel.plantilla}</span></div>
              {sel.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{sel.error}</p>}
              <Campo label="Para"><input className="input" disabled={!editable} value={edit.para} onChange={e => setEdit({ ...edit, para: e.target.value })} /></Campo>
              <Campo label="Con copia"><input className="input" disabled={!editable} value={edit.cc} onChange={e => setEdit({ ...edit, cc: e.target.value })} /></Campo>
              <Campo label="Asunto"><input className="input font-semibold" disabled={!editable} value={edit.asunto} onChange={e => setEdit({ ...edit, asunto: e.target.value })} /></Campo>
              <Campo label="Mensaje"><textarea className="input min-h-56 leading-relaxed" disabled={!editable} value={edit.cuerpo} onChange={e => setEdit({ ...edit, cuerpo: e.target.value })} /></Campo>
              {sel.estado !== 'Enviado' && (
                <div className="flex flex-wrap justify-end gap-2 pt-1">
                  {sel.estado !== 'Descartado' && <button className="btn btn-ghost text-mute" disabled={ocupado} onClick={() => confirm('¿Descartar este mensaje? No se enviará.') && accion('descartar', 'Mensaje descartado')}><Trash2 size={14} /> Descartar</button>}
                  {editable && <button className="btn" disabled={ocupado} onClick={() => accion('guardar', 'Cambios guardados')}>Guardar cambios</button>}
                  {sel.estado !== 'Borrador' && <button className="btn" disabled={!data.cuenta || ocupado} onClick={() => accion('borrador', 'Borrador creado en Gmail')}><FilePenLine size={14} /> Crear borrador en Gmail</button>}
                  <button className="btn btn-primary" disabled={!data.cuenta || ocupado} onClick={enviarUno}><Send size={14} /> {sel.estado === 'Borrador' ? 'Enviar el borrador' : 'Enviar ahora'}</button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

function Plantillas({ data, reload }: { data: any; reload: () => unknown }) {
  const run = useAccion(reload)
  const [clave, setClave] = useState<string>(data.plantillas[0].clave)
  const nueva = clave === 'nueva'
  const tpl = nueva ? { nombre: '', asunto: '', cuerpo: '', propia: true } : data.plantillas.find((t: any) => t.clave === clave) ?? data.plantillas[0]
  const [edit, setEdit] = useState({ nombre: tpl.nombre, asunto: tpl.asunto, cuerpo: tpl.cuerpo })
  useEffect(() => setEdit({ nombre: tpl.nombre, asunto: tpl.asunto, cuerpo: tpl.cuerpo }), [clave, tpl.clave])
  const sucia = edit.nombre !== tpl.nombre || edit.asunto !== tpl.asunto || edit.cuerpo !== tpl.cuerpo
  const [ocupado, setOcupado] = useState(false)
  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    if (ocupado) return
    setOcupado(true)
    await run(fn, ok)
    setOcupado(false)
  }
  const elegir = (c: string) => (!sucia || confirm('Tienes cambios sin guardar en esta plantilla. ¿Descartarlos?')) && setClave(c)
  const guardar = () => ejecutar(async () => {
    if (nueva) setClave((await api('/plantillas', { body: edit })).clave)
    else await api(`/plantillas/${tpl.clave}`, { method: 'PUT', body: edit })
  }, nueva ? 'Plantilla creada' : 'Plantilla guardada')
  const borrar = () => confirm(`¿Borrar la plantilla «${tpl.nombre}»? También se borran sus envíos programados.`)
    && ejecutar(async () => { await api(`/plantillas/${tpl.clave}`, { method: 'DELETE' }); setClave(data.plantillas[0].clave) }, 'Plantilla borrada')
  const variables = [...new Set(`${edit.asunto} ${edit.cuerpo}`.match(/\{\{\w+\}\}/g) ?? [])]
  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      <Card pad={false}>
        <div className="border-b border-line px-4 pb-3">
          <button className="btn w-full justify-center" onClick={() => elegir('nueva')}><Plus size={14} /> Nueva plantilla</button>
        </div>
        <ul className="max-h-[640px] overflow-y-auto">
          {data.plantillas.map((t: any) => (
            <li key={t.clave}>
              <button onClick={() => elegir(t.clave)} className={`flex w-full cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 text-left text-sm transition ${t.clave === clave ? 'bg-ink text-white' : 'hover:bg-brand-50'}`}>
                <span className={`font-mono text-xs ${t.clave === clave ? 'text-spark' : 'text-mute'}`}>{String(t.numero).padStart(2, '0')}</span>
                <span className="flex-1 font-medium">{t.nombre}</span>
                {t.propia && <Chip tono={t.clave === clave ? 'lima' : 'azul'}>propia</Chip>}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <Card titulo={nueva ? 'Nueva plantilla' : `${tpl.numero}. ${tpl.nombre}`}
        extra={!nueva && <button className="btn" disabled={ocupado || sucia} title={sucia ? 'Guarda la plantilla primero: la prueba usa la versión guardada' : undefined} onClick={() => ejecutar(() => api('/plantillas/probar', { body: { clave } }), 'Prueba creada: está en la bandeja')}>Enviarme una prueba</button>}>
        <div className="space-y-3">
          {tpl.propia && <Campo label="Nombre de la plantilla"><input className="input" value={edit.nombre} placeholder="Ej. Aviso de evento" onChange={e => setEdit({ ...edit, nombre: e.target.value })} /></Campo>}
          <Campo label="Asunto"><input className="input font-semibold" value={edit.asunto} onChange={e => setEdit({ ...edit, asunto: e.target.value })} /></Campo>
          <Campo label="Cuerpo" ayuda={tpl.propia ? 'Variables por persona: {{nombre}}, {{equipo}}, {{folio}}, {{lider}}, {{espacio}}, {{coworking}}, {{semestre}}, {{link_formulario_cambios}}.' : 'Los campos entre llaves dobles se rellenan solos al enviar.'}>
            <textarea className="input min-h-52 leading-relaxed" value={edit.cuerpo} onChange={e => setEdit({ ...edit, cuerpo: e.target.value })} />
          </Campo>
          <div className="flex flex-wrap gap-1.5">{variables.map(v => <span key={v} className="mono rounded-md bg-brand-50 px-1.5 py-0.5 text-brand-600">{v}</span>)}</div>
          <div className="flex flex-wrap justify-between gap-2 pt-2">
            {nueva ? <span /> : tpl.propia
              ? <button className="btn btn-ghost text-mute" disabled={ocupado} onClick={borrar}><Trash2 size={14} /> Borrar plantilla</button>
              : <button className="btn btn-ghost text-mute" disabled={ocupado} onClick={() => confirm(`Se crearán ${data.plantillas.length} mensajes de prueba en la bandeja. ¿Continuar?`) && ejecutar(() => api('/plantillas/probar', { body: {} }), `Se crearon las ${data.plantillas.length} pruebas en la bandeja`)}>Enviarme las {data.plantillas.length} de prueba</button>}
            <button className="btn btn-primary" disabled={ocupado || !sucia} onClick={guardar}>{nueva ? 'Crear plantilla' : sucia ? 'Guardar plantilla' : 'Sin cambios'}</button>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ---------- a quién: filtro de personas ----------

export type Filtro = { modo: string; tipo: string; roles: string[]; estados: string[]; equipos: number[]; personas: number[] }

const alternar = <T,>(lista: T[], x: T) => lista.includes(x) ? lista.filter(y => y !== x) : [...lista, x]
const coincide = (q: string, ...textos: string[]) => !q || textos.some(t => t?.toLowerCase().includes(q.toLowerCase()))

function Casilla({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={activa} onClick={onClick}
      className={`cursor-pointer rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition ${activa ? 'border-brand bg-brand-50 text-brand-600' : 'border-line bg-white text-mute hover:border-brand-400'}`}>
      {children}
    </button>
  )
}

function FiltroPersonas({ catalogo, valor, onChange }: { catalogo: any; valor: Filtro; onChange: (f: Filtro) => void }) {
  const [q, setQ] = useState('')
  const set = (cambio: Partial<Filtro>) => onChange({ ...valor, ...cambio })
  return (
    <div className="space-y-4">
      <Filtros valor={valor.modo} onChange={modo => { setQ(''); set({ modo }) }} opciones={[
        { id: 'segmento', label: 'Por grupo' }, { id: 'equipos', label: 'Por equipo', n: valor.equipos.length || undefined },
        { id: 'personas', label: 'Por persona', n: valor.personas.length || undefined },
      ]} />
      {valor.modo !== 'personas' && <>
        <div>
          <span className="label">Tipo de persona</span>
          <Filtros valor={valor.tipo} onChange={tipo => set({ tipo })} opciones={[
            { id: 'todos', label: 'Todos' }, { id: 'internos', label: 'Internos (alumnos y colaboradores)' }, { id: 'externos', label: 'Externos' },
          ]} />
        </div>
        <div>
          <span className="label">Rol en el equipo</span>
          <div className="flex flex-wrap gap-1.5">
            {['Líder', 'Integrante'].map(r => <Casilla key={r} activa={valor.roles.includes(r)} onClick={() => set({ roles: alternar(valor.roles, r) })}>{r === 'Líder' ? 'Líderes' : 'Integrantes'}</Casilla>)}
          </div>
        </div>
      </>}
      {valor.modo === 'segmento' && (
        <div>
          <span className="label">Estado del equipo</span>
          <div className="mb-2 flex gap-2 text-xs">
            <button type="button" className="cursor-pointer font-semibold text-brand hover:underline" onClick={() => set({ estados: catalogo.en_operacion })}>Solo en operación</button>
            <button type="button" className="cursor-pointer font-semibold text-brand hover:underline" onClick={() => set({ estados: [] })}>Cualquier estado</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {catalogo.estados.map((e: string) => <Casilla key={e} activa={valor.estados.includes(e)} onClick={() => set({ estados: alternar(valor.estados, e) })}>{e}</Casilla>)}
          </div>
          {!valor.estados.length && <p className="mt-1 text-xs text-mute">Sin estados marcados = equipos en cualquier estado.</p>}
        </div>
      )}
      {valor.modo !== 'segmento' && (
        <div>
          <input className="input mb-2" placeholder={valor.modo === 'equipos' ? 'Buscar equipo…' : 'Buscar por nombre, correo o equipo…'} value={q} onChange={e => setQ(e.target.value)} />
          <ul className="max-h-72 overflow-y-auto rounded-xl border border-line">
            {valor.modo === 'equipos'
              ? catalogo.equipos.filter((t: any) => coincide(q, t.nombre, t.folio)).map((t: any) => (
                <li key={t.id} className="border-b border-line last:border-0">
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-brand-50/50">
                    <input type="checkbox" checked={valor.equipos.includes(t.id)} onChange={() => set({ equipos: alternar(valor.equipos, t.id) })} />
                    <span className="flex-1 font-medium">{t.nombre}</span><Estado estado={t.estado} />
                  </label>
                </li>))
              : catalogo.personas.filter((p: any) => coincide(q, p.nombre, p.correo, p.equipo.nombre)).slice(0, 300).map((p: any) => (
                <li key={p.id} className="border-b border-line last:border-0">
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-brand-50/50">
                    <input type="checkbox" checked={valor.personas.includes(p.id)} onChange={() => set({ personas: alternar(valor.personas, p.id) })} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.nombre}</span><span className="block truncate text-xs text-mute">{p.correo} · {p.equipo.nombre}</span></span>
                    <Chip tono={p.tipo === 'Externo' ? 'naranja' : 'gris'}>{p.tipo}</Chip>
                  </label>
                </li>))}
          </ul>
          {(valor.modo === 'equipos' ? valor.equipos : valor.personas).length > 0 &&
            <button type="button" className="mt-1 cursor-pointer text-xs font-semibold text-brand hover:underline" onClick={() => set(valor.modo === 'equipos' ? { equipos: [] } : { personas: [] })}>Quitar selección</button>}
        </div>
      )}
    </div>
  )
}

/** Cuántas y cuáles personas cumplen el filtro (se recalcula al cambiarlo). */
function useDestinatarios(filtro: Filtro) {
  const [res, setRes] = useState<any>(null)
  const clave = JSON.stringify(filtro)
  useEffect(() => {
    let vigente = true
    const t = setTimeout(() => { api('/destinatarios', { body: { filtro } }).then(r => vigente && setRes(r)).catch(() => vigente && setRes(null)) }, 250)
    return () => { vigente = false; clearTimeout(t) }
  }, [clave])
  return res
}

const urlExportar = (f: Filtro) => `/api/personas/exportar?filtro=${encodeURIComponent(JSON.stringify(f))}`
const FRECUENCIAS: Record<string, string> = { una_vez: 'Una sola vez', diaria: 'Cada día', semanal: 'Cada semana', mensual: 'Cada mes' }
const hoyIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

function Grupos({ data, reload, alProgramar }: { data: any; reload: () => unknown; alProgramar: () => void }) {
  const { data: catalogo, error } = useApi('/personas')
  const run = useAccion(reload)
  const [filtro, setFiltro] = useState<Filtro>({ modo: 'segmento', tipo: 'todos', roles: ['Líder', 'Integrante'], estados: [], equipos: [], personas: [] })
  useEffect(() => { if (catalogo) setFiltro(f => ({ ...f, estados: catalogo.en_operacion })) }, [catalogo])
  const dest = useDestinatarios(filtro)
  const [plantilla, setPlantilla] = useState('')
  const [prog, setProg] = useState({ nombre: '', frecuencia: 'semanal', proxima: hoyIso() })
  const [ocupado, setOcupado] = useState(false)
  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    if (ocupado) return
    setOcupado(true)
    await run(fn, ok)
    setOcupado(false)
  }
  if (!catalogo) return error ? <Vacio>{error}</Vacio> : null
  const total = dest?.total ?? 0
  const tplNombre = data.plantillas.find((t: any) => t.clave === plantilla)?.nombre
  const enviar = () => confirm(`Se creará un mensaje «${tplNombre}» para cada una de las ${total} personas${data.modo_prueba ? ' (modo prueba: saldrán solo al equipo operativo)' : ''}. Se entregan según el modo de envío de Configuración. ¿Continuar?`)
    && ejecutar(async () => { await api('/mensajes/grupo', { body: { plantilla, filtro } }) }, `${total} mensajes creados`)
  const programar = () => ejecutar(async () => {
    await api('/automatizaciones', { body: { ...prog, plantilla, filtro } })
    setProg({ ...prog, nombre: '' })
    alProgramar()
  }, 'Envío programado')

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      <Card titulo="¿A quién?">
        <FiltroPersonas catalogo={catalogo} valor={filtro} onChange={setFiltro} />
      </Card>
      <div className="space-y-5">
        <Card titulo={dest ? `${total} persona${total === 1 ? '' : 's'}` : 'Calculando…'}
          extra={<a className={`btn ${total ? '' : 'pointer-events-none opacity-50'}`} href={urlExportar(filtro)} download><Download size={14} /> Exportar a Excel</a>}>
          {dest && <p className="mb-2 text-xs text-mute">{dest.descripcion}. El Excel trae nombre y correo.</p>}
          {!dest || total === 0 ? <Vacio>Nadie cumple el filtro.</Vacio> : (
            <ul className="max-h-60 overflow-y-auto text-sm">
              {dest.personas.map((p: any) => (
                <li key={p.id} className="flex items-center gap-2 border-b border-line py-1.5 last:border-0">
                  <span className="min-w-0 flex-1 truncate"><b className="font-semibold">{p.nombre}</b> <span className="text-mute">{p.correo}</span></span>
                  <span className="truncate text-xs text-mute">{p.equipo.nombre}</span>
                </li>
              ))}
              {total > dest.personas.length && <li className="pt-2 text-xs text-mute">… y {total - dest.personas.length} más</li>}
            </ul>
          )}
        </Card>
        <Card titulo="Mandarles una plantilla">
          <div className="space-y-3">
            <Campo label="Plantilla">
              <select className="input" value={plantilla} onChange={e => setPlantilla(e.target.value)}>
                <option value="">Elige una plantilla…</option>
                {data.plantillas.map((t: any) => <option key={t.clave} value={t.clave}>{t.numero}. {t.nombre}{t.propia ? ' (propia)' : ''}</option>)}
              </select>
            </Campo>
            <p className="text-xs text-mute">Cada persona recibe su propio correo con sus datos ({'{{nombre}}'}, {'{{equipo}}'}…), sin copia a nadie más.</p>
            <div className="flex justify-end">
              <button className="btn btn-primary" disabled={ocupado || !plantilla || !total} onClick={enviar}><Send size={14} /> Crear {total} mensajes ahora</button>
            </div>
            <div className="border-t border-line pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><CalendarClock size={15} /> O programarlo (automático)</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Campo label="Nombre"><input className="input" placeholder="Ej. Recordatorio semanal" value={prog.nombre} onChange={e => setProg({ ...prog, nombre: e.target.value })} /></Campo>
                <Campo label="Frecuencia">
                  <select className="input" value={prog.frecuencia} onChange={e => setProg({ ...prog, frecuencia: e.target.value })}>
                    {Object.entries(FRECUENCIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Campo>
                <Campo label={prog.frecuencia === 'una_vez' ? 'Fecha' : 'Primer envío'}><input type="date" className="input" min={hoyIso()} value={prog.proxima} onChange={e => setProg({ ...prog, proxima: e.target.value })} /></Campo>
              </div>
              <p className="mt-1 text-xs text-mute">El filtro se vuelve a calcular en cada envío: si entra o sale gente del grupo, la lista se actualiza sola. Sale alrededor de las 8:05 de ese día.</p>
              <div className="mt-2 flex justify-end">
                <button className="btn" disabled={ocupado || !plantilla || !prog.nombre.trim() || !prog.proxima} onClick={programar}><CalendarClock size={14} /> Programar envío</button>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Programados({ reload: recargarMensajes }: { reload: () => unknown }) {
  const { data, error, reload } = useApi('/automatizaciones')
  const run = useAccion(async () => { await reload(); await recargarMensajes() })
  if (!data) return error ? <Vacio>{error}</Vacio> : null
  const lista = data.automatizaciones
  return (
    <Card pad={false}>
      {lista.length === 0 ? <div className="p-5"><Vacio>No hay envíos programados. Créalos desde «Grupos y exportar».</Vacio></div> : (
        <ul>
          {lista.map((a: any) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b className="text-[14px]">{a.nombre}</b>
                  <Chip tono={a.activa ? 'verde' : 'gris'}>{a.activa ? 'Activo' : 'Pausado'}</Chip>
                  <Chip tono="azul">{FRECUENCIAS[a.frecuencia]}</Chip>
                </div>
                <p className="mt-0.5 text-[13px] text-mute">«{a.plantilla_nombre}» → {a.descripcion} · <b>{a.total}</b> persona(s) hoy</p>
                <p className="text-xs text-mute">Próximo: {a.activa && a.proxima ? fecha(a.proxima) : '—'}{a.ultima && ` · último: ${fechaHora(a.ultima)} (${a.ultimo_total})`}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn" onClick={() => confirm(`Se crearán ${a.total} mensajes ahora. ¿Continuar?`) && run(() => api(`/automatizaciones/${a.id}`, { method: 'PATCH', body: { accion: 'ejecutar' } }), 'Mensajes creados')}><Send size={14} /> Enviar ahora</button>
                {a.activa
                  ? <button className="btn" onClick={() => run(() => api(`/automatizaciones/${a.id}`, { method: 'PATCH', body: { activa: false } }), 'Envío pausado')}><Pause size={14} /> Pausar</button>
                  : <button className="btn" onClick={() => {
                    const f = prompt('¿Fecha del próximo envío? (AAAA-MM-DD)', a.proxima && a.proxima >= hoyIso() ? a.proxima : hoyIso())
                    if (f) void run(() => api(`/automatizaciones/${a.id}`, { method: 'PATCH', body: { activa: true, proxima: f } }), 'Envío reactivado')
                  }}><Play size={14} /> Reactivar</button>}
                <button className="btn btn-ghost text-mute" aria-label="Borrar" onClick={() => confirm(`¿Borrar el envío programado «${a.nombre}»?`) && run(() => api(`/automatizaciones/${a.id}`, { method: 'DELETE' }), 'Envío borrado')}><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export default function Mensajes() {
  const { data, error, reload } = useApi('/mensajes')
  const [tab, setTab] = useState('bandeja')
  if (!data) return error ? <Page titulo="Mensajes"><Vacio>{error}</Vacio></Page> : null
  return (
    <Page titulo="Mensajes" eyebrow={`${data.plantillas.length} plantillas · envíos por evento, a grupos y programados`}
      acciones={<Filtros valor={tab} onChange={setTab} opciones={[
        { id: 'bandeja', label: 'Bandeja de salida' }, { id: 'plantillas', label: 'Plantillas' },
        { id: 'grupos', label: 'Grupos y exportar' }, { id: 'programados', label: 'Programados' },
      ]} />}>
      {tab === 'bandeja' && <Bandeja data={data} reload={reload} />}
      {tab === 'plantillas' && <Plantillas data={data} reload={reload} />}
      {tab === 'grupos' && <Grupos data={data} reload={reload} alProgramar={() => setTab('programados')} />}
      {tab === 'programados' && <Programados reload={reload} />}
    </Page>
  )
}
