import { Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { fecha, useApi } from '../api'
import { Chip, Page, useToast, Vacio } from '../ui'
import { Revisar } from './EquipoDetalle'

type Vista = 'evaluar' | 'documentos' | 'aceptadas' | 'no'

const VISTAS: { id: Vista; titulo: string; ayuda: string; vacio: string }[] = [
  { id: 'evaluar', titulo: 'Por revisar', ayuda: 'Abre cada solicitud con «Revisar» para ver todo del equipo y de sus integrantes, y acéptala o recházala.', vacio: 'No hay solicitudes por revisar.' },
  { id: 'documentos', titulo: 'Esperando al equipo', ayuda: 'Les falta algo (por ejemplo, la identificación de un externo). Ya se les avisó; también puedes revisarlas y decidir sin esperar.', vacio: 'Ningún equipo tiene pendientes.' },
  { id: 'aceptadas', titulo: 'Aceptadas (30 días)', ayuda: 'Ya recibieron su bienvenida y están en operación.', vacio: 'Sin aceptaciones recientes.' },
  { id: 'no', titulo: 'Rechazadas', ayuda: 'Recibieron el aviso y la fecha desde la que pueden volver a aplicar.', vacio: 'Sin solicitudes rechazadas.' },
]

const vistaDe = (s: any): Vista =>
  s.estado === 'En evaluación' ? 'evaluar' : s.estado === 'No aceptado' ? 'no' : ['Solicitud recibida', 'Documentación pendiente'].includes(s.estado) ? 'documentos' : 'aceptadas'

export default function Solicitudes() {
  const { data, error, reload } = useApi('/solicitudes')
  const [vista, setVista] = useState<Vista>('evaluar')
  const [revisando, setRevisando] = useState<number | null>(null)
  const toast = useToast()
  if (!data) return error ? <Page titulo="Solicitudes"><Vacio>{error}</Vacio></Page> : null
  const lista = data.solicitudes.filter((s: any) => vistaDe(s) === vista)
  const actual = VISTAS.find(v => v.id === vista)!
  return (
    <Page titulo="Solicitudes" eyebrow="Convocatoria abierta"
      acciones={<>
        <button className="btn" onClick={() => { void navigator.clipboard.writeText(data.link); toast('Enlace del formulario copiado') }}><Copy size={14} /> Copiar enlace del formulario</button>
        <a className="btn btn-primary" href={data.link} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir formulario</a>
      </>}>
      <div className="border border-line bg-white shadow-card">
        {/* Pestañas: una por momento de la solicitud */}
        <div className="grid grid-cols-2 border-b border-line md:grid-cols-4">
          {VISTAS.map(v => {
            const n = data.solicitudes.filter((s: any) => vistaDe(s) === v.id).length
            const activa = v.id === vista
            return (
              <button key={v.id} aria-pressed={activa} onClick={() => setVista(v.id)}
                className={`cursor-pointer border-b-[3px] px-5 py-4 text-left transition ${activa ? 'border-brand bg-brand-50' : 'border-transparent hover:bg-slate-50'}`}>
                <span className={`font-display text-3xl font-extrabold leading-none ${activa ? 'text-brand' : n ? 'text-ink' : 'text-slate-300'}`}>{n}</span>
                <span className={`mt-1 block text-sm font-semibold ${activa ? 'text-brand' : 'text-mute'}`}>{v.titulo}</span>
              </button>
            )
          })}
        </div>
        <p className="border-b border-line bg-slate-50 px-5 py-2.5 text-[13px] text-mute">{actual.ayuda}</p>

        {lista.length === 0 ? <p className="px-5 py-14 text-center text-sm text-mute">{actual.vacio}</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="th">Proyecto</th>
                <th className="th hidden xl:table-cell">Líder</th>
                <th className="th">Integrantes</th>
                <th className="th">Recibida</th>
                <th className="th">{vista === 'evaluar' ? 'Plazo para decidir' : vista === 'documentos' ? 'Qué falta' : vista === 'aceptadas' ? 'Resultado' : 'Puede reaplicar'}</th>
                <th className="th" />
              </tr>
            </thead>
            <tbody>
              {lista.map((s: any) => {
                const restan = data.meta - s.dias_habiles
                return (
                  <tr key={s.id} className="border-b border-line align-top last:border-0 hover:bg-brand-50/40">
                    <td className="td max-w-md !py-4">
                      <Link to={`/equipos/${s.id}`} className="font-display text-[17px] font-bold leading-tight hover:text-brand">{s.nombre}</Link>
                      <p className="mono mt-0.5 text-mute">{s.folio}{s.sector && ` · ${s.sector}`}{s.etapa && ` · ${s.etapa}`}{s.importada && <Chip tono="azul" className="ml-2 font-sans">importada</Chip>}</p>
                      <p className="mt-1.5 line-clamp-2 text-[13px] text-mute">{s.descripcion}</p>
                      <p className="mt-1 text-xs text-mute xl:hidden">Líder: {s.lider}</p>
                    </td>
                    <td className="td hidden !py-4 xl:table-cell"><p className="font-medium">{s.lider}</p><p className="text-xs text-mute">{s.lider_correo}</p></td>
                    <td className="td !py-4"><p className="font-mono font-semibold">{s.integrantes}</p>{s.externos > 0 && <p className="text-xs text-mute">{s.externos} externo{s.externos > 1 ? 's' : ''}</p>}</td>
                    <td className="td whitespace-nowrap !py-4 text-mute">{fecha(s.fecha_solicitud)}</td>
                    <td className="td !py-4">
                      {vista === 'evaluar' && (
                        <div className="w-44">
                          <p className={`text-[13px] font-semibold ${restan < 0 ? 'text-red-600' : restan <= 3 ? 'text-orange-600' : 'text-ink'}`}>
                            {restan < 0 ? `Atrasada ${-restan} día(s) hábil(es)` : restan === 0 ? 'Vence hoy' : `Quedan ${restan} días hábiles`}
                          </p>
                          <div className="mt-1.5 h-1.5 bg-slate-100"><div className={`h-full ${restan < 0 ? 'bg-red-500' : restan <= 3 ? 'bg-orange-500' : 'bg-brand'}`} style={{ width: `${Math.min(100, (s.dias_habiles / data.meta) * 100)}%` }} /></div>
                          <p className="mt-1 text-xs text-mute">día {s.dias_habiles} de {data.meta}{s.por_validar > 0 && ` · ${s.por_validar} identificación(es) por revisar`}</p>
                        </div>
                      )}
                      {vista === 'documentos' && (
                        s.faltantes.length ? <ul className="list-disc space-y-0.5 pl-4 text-[13px] text-amber-800">{s.faltantes.map((x: string) => <li key={x}>{x}</li>)}</ul> : <span className="text-mute">En revisión</span>
                      )}
                      {vista === 'aceptadas' && <p className="text-[13px]"><b className="text-emerald-700">Aceptada</b> el {fecha(s.fecha_aceptacion)}</p>}
                      {vista === 'no' && <p className="text-[13px] text-mute">desde el {fecha(s.fecha_reaplicacion)}</p>}
                    </td>
                    <td className="td whitespace-nowrap !py-4 text-right">
                      {vista === 'evaluar' || vista === 'documentos'
                        ? <button className={`btn ${vista === 'evaluar' ? 'btn-primary' : ''}`} onClick={() => setRevisando(s.id)}>Revisar</button>
                        : <Link className="btn" to={`/equipos/${s.id}`}>Ver ficha</Link>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
        )}
      </div>
      <p className="mt-3 text-xs text-mute">Meta de servicio: decisión en máximo {data.meta} días hábiles desde que se recibe la solicitud.</p>
      {revisando && <Revisar id={revisando} onClose={() => setRevisando(null)} reload={reload} />}
    </Page>
  )
}
