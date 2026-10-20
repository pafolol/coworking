import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api, enDias, fechaHora, useApi } from '../api'
import { Card, Chip, EquipoLink, Filtros, Page, useAccion, Vacio } from '../ui'

const DESTINO: Record<string, string> = {
  Evaluar: '/solicitudes', 'Alta de acceso': '/accesos', 'Renovar acceso': '/accesos', 'Revocar acceso': '/accesos',
  'Validar documento': '/documentos', 'Documento vencido': '/documentos', 'Aprobar pausa': '/equipos', 'Aprobar corte': '/corte', 'Revisar check-in': '/checkins', 'Liberar espacio': '/espacios',
}
const ROLES = ['Administración', 'Evaluación', 'Accesos y documentos']

export default function Tareas() {
  const { data, error, reload } = useApi('/tareas')
  const run = useAccion(reload)
  const [rol, setRol] = useState('todos')
  const [hechas, setHechas] = useState(false)
  const [enCurso, setEnCurso] = useState<number | null>(null)
  if (!data) return error ? <Page titulo="Tareas"><Vacio>{error}</Vacio></Page> : null
  const cambiar = async (id: number, hecha: boolean, ok: string) => {
    if (enCurso !== null) return
    setEnCurso(id)
    await run(() => api(`/tareas/${id}`, { method: 'PATCH', body: { hecha } }), ok)
    setEnCurso(null)
  }
  // Los roles que el servidor mande y esta pantalla no conozca también se listan: así los conteos siempre cuadran con las listas.
  const roles = [...ROLES, ...new Set<string>(data.pendientes.map((t: any) => t.rol).filter((r: string) => !ROLES.includes(r)))]
  const dias = (v: string) => Math.round((new Date(`${v}T12:00:00`).getTime() - new Date(`${data.hoy}T12:00:00`).getTime()) / 864e5)
  const lista = data.pendientes.filter((t: any) => rol === 'todos' || t.rol === rol)
  return (
    <Page titulo="Tareas" eyebrow="Lo único que necesita a una persona"
      acciones={<button className="btn" onClick={() => setHechas(!hechas)}>{hechas ? `Ver pendientes (${data.pendientes.length})` : 'Ver hechas'}</button>}>
      {!hechas && (
        <>
          <div className="mb-4">
            <Filtros valor={rol} onChange={setRol} opciones={[
              { id: 'todos', label: 'Todas', n: data.pendientes.length },
              ...roles.map(r => ({ id: r, label: r, n: data.pendientes.filter((t: any) => t.rol === r).length })),
            ]} />
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {roles.filter(r => rol === 'todos' || r === rol).map(r => {
              const items = lista.filter((t: any) => t.rol === r)
              return (
                <Card key={r} titulo={<span className="flex items-center gap-2">{r}<span className="font-mono text-xs text-mute">{items.length}</span></span>}>
                  <div className="space-y-2">
                    {items.length === 0 && <Vacio>Al día.</Vacio>}
                    {items.map((t: any) => {
                      const d = t.vence ? dias(t.vence) : null
                      return (
                        <div key={t.id} className="flex items-start gap-3 rounded-xl border border-line p-3 transition hover:border-brand-400">
                          <input type="checkbox" title="Marcar hecha" aria-label={`Marcar como hecha: ${t.titulo}`} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-brand"
                            checked={false} disabled={enCurso !== null} onChange={() => cambiar(t.id, true, 'Tarea hecha')} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-snug">{t.titulo}</p>
                            {t.detalle && <p className="mt-0.5 text-xs text-mute">{t.detalle}</p>}
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <Chip tono="azul">{t.tipo}</Chip>
                              {d !== null && <Chip tono={d < 0 ? 'rojo' : d === 0 ? 'naranja' : 'gris'}>{d < 0 ? `atrasada ${-d} d` : d === 0 ? 'hoy' : enDias(d)}</Chip>}
                              {DESTINO[t.tipo] && <Link to={t.equipo && ['Evaluar', 'Aprobar pausa'].includes(t.tipo) ? `/equipos/${t.equipo.id}` : DESTINO[t.tipo]} className="text-xs font-semibold text-brand hover:underline">Ir →</Link>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )
            })}
          </div>
        </>
      )}
      {hechas && (
        <Card pad={false}>
          <ul>
            {data.hechas.length === 0 && <li className="p-5"><Vacio>Aún no hay tareas cerradas.</Vacio></li>}
            {data.hechas.map((t: any) => (
              <li key={t.id} className="row flex items-center gap-3 px-5 py-2.5 text-sm">
                <Chip tono="verde">Hecha</Chip>
                <span className="min-w-0 flex-1 truncate">{t.titulo}</span>
                <EquipoLink equipo={t.equipo} />
                <span className="mono text-mute">{fechaHora(t.cerrada)} · {t.cerrada_por}</span>
                <button className="btn btn-ghost !px-2 text-xs" disabled={enCurso !== null} onClick={() => cambiar(t.id, false, 'Tarea reabierta')}>Reabrir</button>
              </li>
            ))}
          </ul>
          {data.hechas.length >= 40 && <p className="px-5 py-3 text-xs text-mute">Se muestran las 40 más recientes.</p>}
        </Card>
      )}
    </Page>
  )
}
