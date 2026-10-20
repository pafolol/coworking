import { Check, ExternalLink, Eye, Upload, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, fecha, fechaHora, useApi } from '../api'
import { Campo, Chip, Estado, Estatus, Modal, useAccion, Vacio } from '../ui'

const enMeses = (n: number) => {
  const d = new Date()
  d.setMonth(d.getMonth() + n)
  // Fecha local: toISOString() es UTC y por la tarde ya daría el día siguiente.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Espejo del alta manual en la plataforma de accesos: captura el vencimiento y marca Activo. */
export function AccesoModal({ acceso, persona, meses = 6, onClose, reload }: { acceso: any; persona: string; meses?: number; onClose: () => void; reload: () => unknown }) {
  const [venc, setVenc] = useState(enMeses(meses))
  const run = useAccion(reload)
  const [busy, setBusy] = useState(false)
  const guardar = async (estado: string) => {
    if (busy) return
    if (estado === 'Revocado' && !confirm(`¿Revocar el acceso de ${persona}?`)) return
    setBusy(true)
    const ok = await run(() => api(`/accesos/${acceso.id}`, { method: 'PATCH', body: { estado, vencimiento: estado === 'Activo' ? venc : null } }),
      estado === 'Activo' ? 'Acceso activo: se avisó al integrante' : 'Acceso revocado')
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <Modal titulo={`Acceso de ${persona}`} onClose={onClose} ancho="max-w-md">
      <p className="mb-4 text-sm text-mute">
        Primero da de alta (o renueva) a la persona en la plataforma de accesos del campus. Después captura aquí la fecha de vencimiento: el integrante recibe su aviso de acceso activo.
      </p>
      <Campo label="Vence el"><input type="date" className="input" value={venc} onChange={e => setVenc(e.target.value)} /></Campo>
      <div className="mt-5 flex justify-between gap-2">
        {acceso.estado !== 'Pendiente' ? <button className="btn btn-danger" disabled={busy} onClick={() => guardar('Revocado')}>Marcar revocado</button> : <span />}
        <button className="btn btn-primary" disabled={busy || !venc} onClick={() => guardar('Activo')}>{acceso.estado === 'Pendiente' ? 'Marcar acceso activo' : 'Renovar acceso'}</button>
      </div>
    </Modal>
  )
}

function useSubir(doc: any, reload: () => unknown) {
  const run = useAccion(reload)
  const ref = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)
  const input = (
    <input ref={ref} type="file" className="hidden" accept=".pdf,image/*" aria-label={`Archivo de ${doc.nombre}`}
      onChange={async e => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file || subiendo) return
        const form = new FormData()
        form.append('archivo', file)
        setSubiendo(true)
        await run(() => api(`/documentos/${doc.id}/archivo`, { form }), 'Archivo subido: queda por validar')
        setSubiendo(false)
      }} />
  )
  return { input, subiendo, abrir: () => ref.current?.click() }
}

/** Revisor: el documento a la izquierda, sus datos y la decisión a la derecha. */
export function DocVisor({ doc, onClose, reload }: { doc: any; onClose: () => void; reload: () => unknown }) {
  const run = useAccion(reload)
  const subir = useSubir(doc, async () => { await reload(); onClose() })
  const [busy, setBusy] = useState(false)
  const set = async (estado: string) => {
    if (busy) return
    if (estado === 'Rechazado' && !confirm('¿Rechazar este documento? Se le pedirá de nuevo al equipo.')) return
    setBusy(true)
    const ok = await run(() => api(`/documentos/${doc.id}`, { method: 'PATCH', body: { estado } }), estado === 'Validado' ? 'Documento validado' : 'Documento rechazado: se pidió de nuevo al equipo')
    setBusy(false)
    if (ok) onClose()
  }
  const url = `/api/archivos/${doc.id}`
  const { data: info } = useApi(doc.firma ? '/public/info' : null)
  return (
    <Modal titulo={doc.nombre} onClose={onClose} ancho="max-w-6xl">
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div className="h-[72vh] overflow-hidden rounded-xl border border-line bg-slate-100">
          {doc.firma ? (
            <div className="size-full overflow-y-auto bg-white p-8">
              <p className="eyebrow">Aceptada en el formulario, sin archivo</p>
              <h4 className="mt-1 font-display text-2xl font-bold">{doc.nombre}</h4>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-ink/80">{info?.carta}</p>
              <div className="mt-6 border-t border-line pt-4">
                <p className="font-display text-xl font-bold">{doc.firma}</p>
                <p className="text-sm text-mute">leyó y aceptó el {fecha(doc.fecha_carga)}</p>
              </div>
            </div>
          ) : doc.tiene_archivo
            ? doc.tipo_archivo === 'pdf'
              ? <iframe src={url} title={doc.nombre} className="size-full" />
              : <div className="grid size-full place-items-center overflow-auto p-3"><img src={url} alt={doc.nombre} className="max-h-full max-w-full rounded-lg" /></div>
            : (
              <div className="grid size-full place-items-center p-6 text-center text-sm text-mute">
                {doc.enlace ? <a className="btn" href={doc.enlace} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir el enlace del documento</a>
                  : <span>Este documento no tiene archivo guardado{doc.fecha_carga ? ' (se recibió por otro medio)' : ''}.<br />Puedes subirlo desde aquí.</span>}
              </div>
            )}
        </div>
        <div className="flex flex-col gap-4 text-sm">
          <dl className="space-y-3">
            <div><dt className="eyebrow">Equipo</dt><dd><Link className="font-semibold hover:text-brand" to={`/equipos/${doc.equipo.id}`} onClick={onClose}>{doc.equipo.nombre}</Link> <span className="mono text-mute">{doc.equipo.folio}</span></dd></div>
            <div><dt className="eyebrow">De</dt><dd>{doc.persona ?? 'Todo el equipo'}</dd></div>
            <div><dt className="eyebrow">Estado</dt><dd><Estatus valor={doc.estado} /></dd></div>
            <div className="grid grid-cols-2 gap-3">
              <div><dt className="eyebrow">Cargado</dt><dd>{fecha(doc.fecha_carga)}</dd></div>
              <div><dt className="eyebrow">Vence</dt><dd>{doc.vencimiento ? fecha(doc.vencimiento) : doc.estado === 'Validado' ? 'sin vencimiento' : '—'}</dd></div>
            </div>
          </dl>
          <div className="mt-auto space-y-2">
            {doc.estado === 'Por validar' && (
              <>
                <button className="btn btn-primary w-full !py-2.5" disabled={busy} onClick={() => set('Validado')}><Check size={15} /> Validar documento</button>
                <button className="btn btn-danger w-full" disabled={busy} onClick={() => set('Rechazado')}><X size={15} /> Rechazar y pedirlo de nuevo</button>
              </>
            )}
            {doc.estado === 'Validado' && <button className="btn btn-danger w-full" disabled={busy} onClick={() => set('Rechazado')}>Ya no es válido: pedirlo de nuevo</button>}
            {subir.input}
            {!doc.firma && <button className="btn w-full" disabled={subir.subiendo} onClick={subir.abrir}><Upload size={14} /> {subir.subiendo ? 'Subiendo…' : doc.tiene_archivo ? 'Reemplazar archivo' : 'Subir archivo'}</button>}
            {doc.tiene_archivo && <a className="btn btn-ghost w-full text-mute" href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir en otra pestaña</a>}
          </div>
        </div>
      </div>
    </Modal>
  )
}

export function DocAcciones({ doc, reload }: { doc: any; reload: () => unknown }) {
  const [ver, setVer] = useState(false)
  const subir = useSubir(doc, reload)
  const hay = doc.tiene_archivo || doc.enlace || doc.firma
  return (
    <div className="flex items-center justify-end gap-1">
      {subir.input}
      {hay
        ? <button className={`btn !px-2.5 ${doc.estado === 'Por validar' ? 'btn-primary' : ''}`} onClick={() => setVer(true)}><Eye size={14} /> {doc.estado === 'Por validar' ? 'Revisar' : 'Ver'}</button>
        : <button className="btn !px-2.5" disabled={subir.subiendo} onClick={subir.abrir}><Upload size={14} /> {subir.subiendo ? 'Subiendo…' : 'Subir'}</button>}
      {ver && <DocVisor doc={doc} onClose={() => setVer(false)} reload={reload} />}
    </div>
  )
}

/** Ficha de una persona: datos, acceso, documentos (consultables) y visitas recientes. */
export function PersonaModal({ id, onClose, reload }: { id: number; onClose: () => void; reload?: () => unknown }) {
  const { data: p, reload: recargar } = useApi(`/integrantes/${id}`)
  const todo = async () => { await recargar(); await reload?.() }
  return (
    <Modal titulo={p?.nombre ?? 'Persona'} onClose={onClose} ancho="max-w-3xl">
      {!p ? <p className="py-10 text-center text-sm text-mute">Cargando…</p> : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-mute">{p.correo}</span>
            <Chip>{p.tipo}</Chip>
            {p.matricula && <span className="mono text-mute">{p.matricula}</span>}
            {p.rol === 'Líder' && <Chip tono="lima">Líder</Chip>}
            {!p.activo && <Chip tono="tinta">Baja</Chip>}
            <span className="flex-1" />
            <Link to={`/equipos/${p.equipo.id}`} onClick={onClose} className="font-semibold hover:text-brand">{p.equipo.nombre}</Link>
            <Estado estado={p.equipo.estado} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-line p-3"><p className="eyebrow">Acceso</p><p className="mt-1">{p.acceso ? <Estatus valor={p.acceso.estado} /> : '—'}</p></div>
            <div className="rounded-xl border border-line p-3"><p className="eyebrow">Vence</p><p className="mt-1 font-semibold">{fecha(p.acceso?.vencimiento)}</p></div>
            <div className="rounded-xl border border-line p-3"><p className="eyebrow">Días con visita</p><p className="mt-1 font-display text-xl font-bold leading-none">{p.dias_con_visita}</p></div>
          </div>
          {[['Sus documentos', p.documentos], ['Documentos del equipo', p.documentos_equipo]].map(([titulo, docs]: any) => (
            <div key={titulo}>
              <p className="label">{titulo}</p>
              {docs.length === 0 ? <Vacio>Sin documentos.</Vacio> : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {docs.map((d: any) => (
                    <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1"><b className="block truncate font-medium">{d.nombre}</b><span className="text-xs text-mute">cargado {fecha(d.fecha_carga)} · {d.vencimiento ? `vence ${fecha(d.vencimiento)}` : 'sin vencimiento'}</span></span>
                      <Estatus valor={d.estado} />
                      <DocAcciones doc={d} reload={todo} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div>
            <p className="label">Últimas visitas</p>
            {p.visitas.length === 0 ? <p className="text-sm text-mute">Sin check-ins registrados.</p>
              : <div className="flex flex-wrap gap-1.5">{p.visitas.map((v: string) => <span key={v} className="mono rounded-md bg-brand-50 px-2 py-1 text-brand-600">{fechaHora(v)}</span>)}</div>}
          </div>
        </div>
      )}
    </Modal>
  )
}

/** Nombre de persona que abre su ficha. */
export function PersonaLink({ id, nombre, reload }: { id?: number | null; nombre?: string | null; reload?: () => unknown }) {
  const [abierta, setAbierta] = useState(false)
  if (!id || !nombre) return <span className="text-mute">{nombre ?? 'Equipo'}</span>
  return (
    <>
      <button className="cursor-pointer text-left font-semibold hover:text-brand hover:underline" onClick={e => { e.stopPropagation(); setAbierta(true) }}>{nombre}</button>
      {abierta && <PersonaModal id={id} onClose={() => setAbierta(false)} reload={reload} />}
    </>
  )
}
