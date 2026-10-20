import { FileUp, PauseCircle, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { fecha, useApi } from '../api'
import { Card, Estado, Filtros, Page, Tabla, Uso, Vacio } from '../ui'

export default function Equipos() {
  const { data, error } = useApi('/equipos')
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const nav = useNavigate()
  const estado = params.get('estado') ?? 'operacion'

  const lista = useMemo(() => {
    if (!data) return []
    const operacion = ['Activo – Coworking', 'Lista de espera', 'Espacio fijo', 'En riesgo', 'Alerta de baja']
    return data.equipos.filter((t: any) => {
      // Al buscar se mira en todos los estados: quien busca un equipo no sabe en qué pestaña está.
      const okEstado = q.trim() !== '' || estado === 'todos' || (estado === 'operacion' ? operacion.includes(t.estado) : t.estado === estado)
      const texto = [t.nombre, t.folio, t.lider_nombre, t.lider_correo, t.sector].filter(Boolean).join(' ').toLowerCase()
      return okEstado && texto.includes(q.trim().toLowerCase())
    })
  }, [data, estado, q])

  if (!data) return error ? <Page titulo="Equipos"><Vacio>{error}</Vacio></Page> : <p className="p-10 text-center text-sm text-mute" role="status">Cargando…</p>
  const cuenta = (e: string) => data.equipos.filter((t: any) => t.estado === e).length
  const opciones = [
    { id: 'operacion', label: 'En operación', n: data.equipos.filter((t: any) => ['Activo – Coworking', 'Lista de espera', 'Espacio fijo', 'En riesgo', 'Alerta de baja'].includes(t.estado)).length },
    ...data.estados.map((e: string) => ({ id: e, label: e, n: cuenta(e) })),
    { id: 'todos', label: 'Todos', n: data.equipos.length },
  ]
  return (
    <Page titulo="Equipos" eyebrow="Una sola fuente de verdad"
      acciones={<>
        <Link to="/importar" className="btn"><FileUp size={14} /> Importar desde Excel o CSV</Link>
        <label className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input className="input w-64 !pl-9" aria-label="Buscar equipo, folio o líder" placeholder="Buscar equipo, folio o líder" value={q} onChange={e => setQ(e.target.value)} />
        </label>
      </>}>
      <div className="mb-4"><Filtros opciones={opciones} valor={q.trim() ? '' : estado} onChange={id => { setQ(''); setParams({ estado: id }) }} /></div>
      {q.trim() && <p className="-mt-2 mb-3 text-sm text-mute">{lista.length} resultado(s) para «{q.trim()}» en todos los estados. <button className="cursor-pointer font-semibold text-brand hover:underline" onClick={() => setQ('')}>Quitar búsqueda</button></p>}
      <Card pad={false}>
        <Tabla vacio={lista.length === 0}
          cols={['Equipo', 'Estado', 'Espacio', 'Líder', 'Integrantes', <span title="Visitas del equipo por semana; la última celda es la semana en curso">Visitas · últimas semanas</span>, 'En este estado desde']}>
          {lista.map((t: any) => (
            <tr key={t.id} className="row cursor-pointer" onClick={() => nav(`/equipos/${t.id}`)}>
              <td className="td">
                <Link to={`/equipos/${t.id}`} className="whitespace-nowrap font-semibold hover:text-brand hover:underline" onClick={e => e.stopPropagation()}>{t.nombre}</Link>
                <p className="mono text-mute">{t.folio}{t.sector ? ` · ${t.sector}` : ''}</p>
              </td>
              <td className="td">
                <span className="flex items-center gap-1.5"><Estado estado={t.estado} />{t.en_pausa && <span title="En pausa justificada" className="inline-flex items-center gap-1 text-xs text-mute"><PauseCircle size={15} /> en pausa</span>}</span>
              </td>
              <td className="td">{t.espacio ? <span className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-xs font-semibold text-white">{t.espacio}</span> : <span className="text-mute">—</span>}</td>
              <td className="td"><p>{t.lider_nombre}</p><p className="text-xs text-mute">{t.lider_correo}</p></td>
              <td className="td font-mono">{t.integrantes}</td>
              <td className="td">{t.fecha_aceptacion ? <Uso dias={t.uso} minimo={data.minimo} /> : <span className="text-mute">—</span>}</td>
              <td className="td text-mute">{fecha(t.fecha_estado)}</td>
            </tr>
          ))}
        </Tabla>
      </Card>
    </Page>
  )
}
