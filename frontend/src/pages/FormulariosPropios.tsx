import { Copy, Download, Eye, Inbox, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'

import { api, API_URL, fechaHora, useApi } from '../api'
import { Campo, Chip, EquipoLink, Estatus, Filtros, Modal, useAccion, useToast } from '../ui'
import { type CampoForm, CampoRespuesta, EditorCampos, revisarCampos, SelectorColor, ValorRespuesta } from './campos'
import { Interruptor } from './EditorFormulario'
import { type Filtro, FiltroPersonas, useDestinatarios } from './Mensajes'

/** Puntos de partida para no empezar en blanco. */
const MODELOS: { nombre: string; descripcion: string; datos: any }[] = [
  { nombre: 'En blanco', descripcion: 'Arma tus propias preguntas.', datos: { titulo: 'Nuevo formulario', intro: '', campos: [] } },
  {
    nombre: 'Actualización de datos', descripcion: 'Teléfono, correo alterno y cambios del proyecto.',
    datos: {
      titulo: 'Actualiza tus datos', intro: 'Ayúdanos a mantener tu información al día.', campos: [
        { id: 'tel', etiqueta: 'Teléfono celular', tipo: 'telefono', obligatoria: true },
        { id: 'correo2', etiqueta: 'Correo alterno', tipo: 'correo' },
        { id: 'cambio', etiqueta: '¿Qué cambió en tu proyecto o en tu equipo?', tipo: 'parrafo' },
      ],
    },
  },
  {
    nombre: 'Firma de documento', descripcion: 'Que lean un texto y lo acepten con su nombre.',
    datos: {
      titulo: 'Firma de aceptación', intro: 'Lee el documento y acéptalo con tu nombre completo.', campos: [
        { id: 'firma', etiqueta: 'Documento', tipo: 'firma', obligatoria: true, texto: 'Pega aquí el texto que deben aceptar.' },
      ],
    },
  },
  {
    nombre: 'Entrega de documentos', descripcion: 'Pide uno o varios archivos (PDF o imagen).',
    datos: {
      titulo: 'Entrega de documentos', intro: 'Sube los documentos que te pedimos. Aceptamos PDF o imagen de hasta 10 MB.', campos: [
        { id: 'doc1', etiqueta: 'Identificación oficial', tipo: 'archivo', obligatoria: true },
        { id: 'doc2', etiqueta: 'Comprobante', tipo: 'archivo' },
        { id: 'nota', etiqueta: 'Comentarios', tipo: 'parrafo' },
      ],
    },
  },
]

export default function FormulariosPropios() {
  const { data, error, reload } = useApi('/formas')
  const [editando, setEditando] = useState<any>(null)
  const [viendo, setViendo] = useState<number | null>(null)
  const [enviando, setEnviando] = useState<any>(null)
  const [eligiendo, setEligiendo] = useState(false)
  const run = useAccion(reload)
  const toast = useToast()
  const lista: any[] = data?.formularios ?? []
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Hechos por ti</p>
          <h2 className="text-2xl font-bold">Formularios propios</h2>
          <p className="text-sm text-mute">Para pedir datos, archivos o firmas cuando haya un cambio. Se mandan por correo: cada persona recibe su propio enlace.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEligiendo(true)}><Plus size={14} /> Nuevo formulario</button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {data && lista.length === 0 && (
        <button onClick={() => setEligiendo(true)} className="w-full cursor-pointer rounded-2xl border-2 border-dashed border-line px-6 py-10 text-center text-sm text-mute transition hover:border-brand-400 hover:bg-brand-50/40">
          Aún no hay formularios propios. <b className="text-brand">Crea el primero</b>
        </button>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {lista.map(f => (
          <div key={f.id} className={`card flex flex-col overflow-hidden ${f.activo ? '' : 'opacity-70'}`}>
            <div className="h-1.5" style={{ background: f.color || '#06123a' }} />
            <div className="flex flex-1 flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-lg font-bold leading-tight">{f.titulo}</h3>
                <span className="flex shrink-0 gap-1">{!f.activo && <Chip>pausado</Chip>}{f.abierto && <Chip tono="azul">abierto</Chip>}</span>
              </div>
              <p className="mt-1 text-xs text-mute">{f.campos.filter((c: any) => c.tipo !== 'seccion').length} pregunta(s){f.campos.some((c: any) => c.tipo === 'archivo') && ' · pide archivos'}{f.campos.some((c: any) => c.tipo === 'firma') && ' · pide firma'}</p>
              <div className="mt-4 flex gap-6">
                <div><p className="eyebrow">Respondieron</p><p className="font-display text-3xl font-extrabold leading-none">{f.respondidos}</p></div>
                <div><p className="eyebrow">Pendientes</p><p className={`font-display text-3xl font-extrabold leading-none ${f.pendientes ? 'text-amber-600' : 'text-slate-300'}`}>{f.pendientes}</p></div>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <button className="btn btn-primary" disabled={!f.activo} onClick={() => setEnviando(f)}><Send size={14} /> Enviar</button>
                <button className="btn" onClick={() => setViendo(f.id)}><Inbox size={14} /> Respuestas</button>
                <button className="btn" onClick={() => setEditando(f)}><Pencil size={14} /> Editar</button>
                <button className="btn btn-ghost !px-2 text-mute" title="Duplicar" aria-label={`Duplicar ${f.titulo}`} onClick={() => run(() => api('/formas', { body: { duplicar: f.id } }), 'Formulario duplicado')}><Copy size={14} /></button>
                {f.abierto && <button className="btn btn-ghost !px-2 text-mute" title="Copiar enlace abierto" aria-label="Copiar enlace abierto" onClick={() => { void navigator.clipboard.writeText(f.url); toast('Enlace copiado') }}><Eye size={14} /></button>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {eligiendo && (
        <Modal titulo="Nuevo formulario" onClose={() => setEligiendo(false)} ancho="max-w-2xl">
          <p className="mb-3 text-sm text-mute">Empieza con un modelo; todo se puede cambiar después.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {MODELOS.map(m => (
              <button key={m.nombre} className="cursor-pointer rounded-xl border border-line p-4 text-left transition hover:border-brand hover:bg-brand-50/50"
                onClick={() => { setEligiendo(false); setEditando({ nuevo: true, color: '', boton: 'Enviar', mensaje_final: '¡Gracias! Recibimos tus respuestas.', abierto: false, activo: true, ...structuredClone(m.datos) }) }}>
                <b className="block">{m.nombre}</b><span className="text-sm text-mute">{m.descripcion}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {editando && <EditorPropio inicial={editando} onClose={() => setEditando(null)} reload={reload} />}
      {viendo !== null && <RespuestasPropio id={viendo} onClose={() => setViendo(null)} reloadLista={reload} onEnviar={f => { setViendo(null); setEnviando(f) }} />}
      {enviando && <EnviarPropio f={enviando} onClose={() => setEnviando(null)} reload={reload} />}
    </section>
  )
}

function EditorPropio({ inicial, onClose, reload }: { inicial: any; onClose: () => void; reload: () => unknown }) {
  const [f, setF] = useState<any>(() => structuredClone(inicial))
  const [vista, setVista] = useState<'editar' | 'previa'>('editar')
  const [guardando, setGuardando] = useState(false)
  const [previa, setPrevia] = useState<Record<string, any>>({})
  const inicialJson = useRef(JSON.stringify(inicial))
  const sucio = inicial.nuevo || JSON.stringify(f) !== inicialJson.current
  const run = useAccion(reload)
  const toast = useToast()
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const cerrar = () => { if (!sucio || confirm('Hay cambios sin guardar. ¿Cerrar y descartarlos?')) onClose() }
  const guardar = async () => {
    if (guardando) return
    if (!String(f.titulo ?? '').trim()) return toast('Ponle un título al formulario.', true)
    const { error, limpios } = revisarCampos(f.campos)
    if (error) return toast(error, true)
    if (!limpios.some(c => c.tipo !== 'seccion')) return toast('Agrega al menos una pregunta.', true)
    setGuardando(true)
    const body = { titulo: f.titulo.trim(), intro: f.intro, campos: limpios, boton: f.boton, mensaje_final: f.mensaje_final, color: f.color, abierto: f.abierto, activo: f.activo }
    const ok = await run(() => (f.nuevo ? api('/formas', { body }) : api(`/formas/${f.id}`, { method: 'PUT', body })), f.nuevo ? 'Formulario creado' : 'Formulario guardado')
    setGuardando(false)
    if (ok) onClose()
  }
  const borrar = async () => {
    if (!confirm(`¿Borrar «${f.titulo}»? También se borran sus ${f.respondidos ?? 0} respuesta(s) y los archivos que subieron.`)) return
    if (await run(() => api(`/formas/${f.id}`, { method: 'DELETE' }), 'Formulario borrado')) onClose()
  }
  const campos: CampoForm[] = f.campos
  return (
    <Modal titulo={f.nuevo ? 'Nuevo formulario' : `Editar · ${inicial.titulo}`} onClose={cerrar} ancho="max-w-4xl">
      <div className="mb-4"><Filtros valor={vista} onChange={v => setVista(v as 'editar' | 'previa')} opciones={[{ id: 'editar', label: 'Editar' }, { id: 'previa', label: 'Vista previa' }]} /></div>
      {vista === 'editar' ? (
        <div className="space-y-4">
          <Campo label="Título"><input className="input font-display text-lg font-bold" value={f.titulo} onChange={e => set('titulo', e.target.value)} /></Campo>
          <Campo label="Introducción" ayuda="Aparece arriba del formulario. Explica para qué es y qué necesitan tener a la mano.">
            <textarea className="input min-h-20" value={f.intro} onChange={e => set('intro', e.target.value)} />
          </Campo>
          <div>
            <p className="label">Preguntas</p>
            <EditorCampos campos={campos} onChange={c => set('campos', c)} vacio="Agrega preguntas, pide archivos o una firma." />
          </div>
          <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div><p className="label">Color</p><SelectorColor valor={f.color} onChange={c => set('color', c)} /></div>
              <Campo label="Texto del botón"><input className="input" value={f.boton} onChange={e => set('boton', e.target.value)} /></Campo>
              <Campo label="Mensaje al terminar"><textarea className="input min-h-16" value={f.mensaje_final} onChange={e => set('mensaje_final', e.target.value)} /></Campo>
            </div>
            <div className="space-y-2">
              <p className="label">Quién lo puede llenar</p>
              <Interruptor on={!!f.activo} onChange={v => set('activo', v)} label="Recibe respuestas" nota="Apágalo para pausarlo: los enlaces dejan de funcionar." />
              <Interruptor on={!!f.abierto} onChange={v => set('abierto', v)} label="Enlace abierto" nota="Además del enlace personal por correo, cualquiera con el enlace general puede responder (se le pide nombre y correo)." />
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-slate-50">
          <div className="px-6 pb-8 pt-6 text-white" style={{ background: f.color || '#06123a' }}>
            <h2 className="text-3xl font-extrabold">{f.titulo || 'Sin título'}</h2>
            {f.intro && <p className="mt-2 whitespace-pre-line text-sm text-white/75">{f.intro}</p>}
          </div>
          <div className="space-y-4 p-6">
            {revisarCampos(campos).limpios.map(q => <CampoRespuesta key={q.id} q={q} valor={previa[q.id]} onChange={v => setPrevia({ ...previa, [q.id]: v })} />)}
            <button type="button" className="btn btn-primary w-full !py-3" style={f.color ? { backgroundColor: f.color, borderColor: f.color } : undefined} onClick={() => toast('Así se ve; en la vista previa no se envía nada.')}>{f.boton || 'Enviar'}</button>
          </div>
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        {!f.nuevo ? <button className="btn btn-ghost text-red-700" onClick={borrar}><Trash2 size={14} /> Borrar</button> : <span />}
        <div className="flex gap-2"><button className="btn" onClick={cerrar}>Cancelar</button><button className="btn btn-primary" disabled={guardando || !sucio} onClick={guardar}>{guardando ? 'Guardando…' : f.nuevo ? 'Crear formulario' : 'Guardar cambios'}</button></div>
      </div>
    </Modal>
  )
}

function EnviarPropio({ f, onClose, reload }: { f: any; onClose: () => void; reload: () => unknown }) {
  const { data: catalogo } = useApi('/personas')
  const [filtro, setFiltro] = useState<Filtro>({ modo: 'personas', tipo: 'todos', roles: ['Líder', 'Integrante'], estados: [], equipos: [], personas: [] })
  const [usarFiltro, setUsarFiltro] = useState(true)
  const [correos, setCorreos] = useState('')
  const [asunto, setAsunto] = useState(f.asunto)
  const [mensaje, setMensaje] = useState(f.mensaje)
  const [mandando, setMandando] = useState(false)
  const toast = useToast()
  useEffect(() => { if (catalogo) setFiltro(x => ({ ...x, estados: catalogo.en_operacion })) }, [catalogo])
  const dest = useDestinatarios(filtro)
  const sueltos = correos.split(/[\s,;]+/).map(c => c.trim()).filter(Boolean)
  const total = (usarFiltro ? dest?.total ?? 0 : 0) + sueltos.length
  const enviar = async () => {
    if (mandando || !total) return
    if (!confirm(`Se enviará «${f.titulo}» a ${total} persona(s), cada una con su enlace. ¿Continuar?`)) return
    setMandando(true)
    try {
      const r = await api(`/formas/${f.id}/enviar`, { body: { filtro: usarFiltro ? filtro : null, correos: sueltos, asunto, mensaje } })
      toast(`Listo: ${r.enviados} correo(s) en la bandeja de salida$.`)
      void reload()
      onClose()
    } catch (e) {
      toast((e as Error).message, true)
    }
    setMandando(false)
  }
  return (
    <Modal titulo={`Enviar · ${f.titulo}`} onClose={onClose} ancho="max-w-4xl">
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <label className="mb-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" className="size-4 accent-brand" checked={usarFiltro} onChange={e => setUsarFiltro(e.target.checked)} /> Personas registradas</label>
          {usarFiltro && (catalogo ? <FiltroPersonas catalogo={catalogo} valor={filtro} onChange={setFiltro} /> : <p className="text-sm text-mute">Cargando personas…</p>)}
          <div className="mt-4"><Campo label="Otros correos" ayuda="Separados por coma o renglón. Sirve para personas que aún no están registradas.">
            <textarea className="input min-h-16" value={correos} onChange={e => setCorreos(e.target.value)} placeholder="persona@correo.com, otra@correo.com" />
          </Campo></div>
        </div>
        <div className="space-y-3">
          <Campo label="Asunto"><input className="input" value={asunto} onChange={e => setAsunto(e.target.value)} /></Campo>
          <Campo label="Mensaje" ayuda="{{enlace_formulario}} se cambia por el enlace personal de cada quien (si no lo pones, no sabrán dónde responder). También: {{nombre}}, {{equipo}}, {{titulo_formulario}}, {{coworking}}.">
            <textarea className="input min-h-56 font-mono text-[13px]" value={mensaje} onChange={e => setMensaje(e.target.value)} />
          </Campo>
          {!mensaje.includes('{{enlace_formulario}}') && <p className="text-sm font-medium text-red-700">El mensaje no incluye {'{{enlace_formulario}}'}.</p>}
          <p className="text-xs text-mute">A quien ya tiene el formulario pendiente se le reenvía el mismo enlace; no se duplica. Los correos salen por la bandeja de salida, como el resto de los mensajes.</p>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-sm"><b className="font-display text-2xl">{total}</b> <span className="text-mute">destinatario(s){usarFiltro && dest && ` · ${dest.descripcion}`}</span></p>
        <div className="flex gap-2"><button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={mandando || !total || !mensaje.includes('{{enlace_formulario}}')} onClick={enviar}><Send size={14} /> {mandando ? 'Enviando…' : 'Enviar'}</button></div>
      </div>
    </Modal>
  )
}

function RespuestasPropio({ id, onClose, reloadLista, onEnviar }: { id: number; onClose: () => void; reloadLista: () => unknown; onEnviar: (f: any) => void }) {
  const { data: f, error, reload } = useApi(`/formas/${id}`)
  const [filtro, setFiltro] = useState('Respondido')
  const [abierta, setAbierta] = useState<number | null>(null)
  const run = useAccion(async () => { await reload(); await reloadLista() })
  if (!f) return <Modal titulo="Respuestas" onClose={onClose}>{error ? <p className="text-sm text-red-700">{error}</p> : <p className="text-sm text-mute">Cargando…</p>}</Modal>
  const lista = f.respuestas.filter((r: any) => filtro === 'todas' || r.estado === filtro)
  return (
    <Modal titulo={`Respuestas · ${f.titulo}`} onClose={onClose} ancho="max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Filtros valor={filtro} onChange={setFiltro} opciones={[
          { id: 'Respondido', label: 'Respondieron', n: f.respondidos }, { id: 'Pendiente', label: 'Pendientes', n: f.pendientes }, { id: 'todas', label: 'Todas' },
        ]} />
        <div className="flex gap-2">
          <a className="btn" href={`${API_URL}/formas/${f.id}/exportar`}><Download size={14} /> Excel</a>
          {f.activo && <button className="btn btn-primary" onClick={() => onEnviar(f)}><Send size={14} /> Enviar</button>}
        </div>
      </div>
      {lista.length === 0 ? <p className="py-10 text-center text-sm text-mute">{filtro === 'Pendiente' ? 'Nadie tiene este formulario pendiente.' : 'Todavía no hay respuestas.'}</p> : (
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <tbody>
              {lista.map((r: any) => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer border-b border-line hover:bg-brand-50/40" onClick={() => setAbierta(abierta === r.id ? null : r.id)}>
                    <td className="td"><b className="font-semibold">{r.nombre || r.correo}</b>{r.nombre && <p className="text-xs text-mute">{r.correo}</p>}</td>
                    <td className="td">{r.equipo ? <EquipoLink equipo={r.equipo} /> : <span className="text-mute">—</span>}</td>
                    <td className="td"><Estatus valor={r.estado} /></td>
                    <td className="td mono whitespace-nowrap text-mute">{r.respondido ? fechaHora(r.respondido) : `enviado ${fechaHora(r.creado)}`}</td>
                    <td className="td text-right">
                      <button className="btn btn-ghost !px-2 text-mute" title="Borrar" aria-label={`Borrar la respuesta de ${r.nombre || r.correo}`}
                        onClick={e => { e.stopPropagation(); if (confirm(r.estado === 'Pendiente' ? `¿Cancelar el enlace de ${r.correo}? Ya no podrá responder con él.` : `¿Borrar la respuesta de ${r.nombre || r.correo} y sus archivos?`)) void run(() => api(`/formas/respuestas/${r.id}`, { method: 'DELETE' }), 'Borrado') }}>
                        <Trash2 size={14} /></button>
                    </td>
                  </tr>
                  {abierta === r.id && r.estado === 'Respondido' && (
                    <tr className="border-b border-line bg-slate-50/70">
                      <td colSpan={5} className="px-5 py-4">
                        <dl className="grid gap-3 sm:grid-cols-2">
                          {r.respuestas.map((x: any) => (
                            <div key={x.id}><dt className="eyebrow">{x.etiqueta}</dt><dd className="text-[13px]"><ValorRespuesta r={x} href={`/formas/respuestas/${r.id}/archivo/${x.id}`} /></dd></div>
                          ))}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-mute">Toca una respuesta para verla completa. Los archivos se abren en otra pestaña.</p>
    </Modal>
  )
}
