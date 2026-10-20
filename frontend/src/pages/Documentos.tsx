import { useState } from 'react'
import { Link } from 'react-router-dom'

import { fecha, useApi } from '../api'
import { Card, Chip, EquipoLink, Estatus, Filtros, Page, Tabla, Vacio } from '../ui'
import { DocAcciones, PersonaLink } from './shared'

export default function Documentos() {
  const { data, error, reload } = useApi('/documentos')
  const [filtro, setFiltro] = useState('Por validar')
  const [q, setQ] = useState('')
  if (!data) return error ? <Page titulo="Documentos"><Vacio>{error}</Vacio></Page> : null
  const estados = ['Por validar', 'Faltante', 'Rechazado', 'Vencido', 'Validado']
  const lista = data.documentos.filter((d: any) => (filtro === 'todos' || d.estado === filtro)
    && `${d.nombre} ${d.equipo.nombre} ${d.equipo.folio} ${d.persona ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  return (
    <Page titulo="Documentos" eyebrow="Se suben, se revisan y se consultan aquí"
      acciones={<input className="input w-72 max-w-full" aria-label="Buscar documentos" placeholder="Buscar por persona, equipo o documento" value={q} onChange={e => { setQ(e.target.value); if (e.target.value) setFiltro('todos') }} />}>
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div>
          <div className="mb-4">
            <Filtros valor={filtro} onChange={setFiltro} opciones={[
              ...estados.map(e => ({ id: e, label: e, n: data.documentos.filter((d: any) => d.estado === e).length })),
              { id: 'todos', label: 'Todos', n: data.documentos.length },
            ]} />
          </div>
          <Card pad={false}>
            <Tabla cols={['Documento', 'Equipo', 'De', 'Estado', 'Carga', 'Vence', '']} vacio={lista.length === 0}>
              {lista.slice(0, 200).map((d: any) => (
                <tr key={d.id} className="row">
                  <td className="td font-medium">{d.nombre}</td>
                  <td className="td"><EquipoLink equipo={d.equipo} /></td>
                  <td className="td"><PersonaLink id={d.member_id} nombre={d.persona} reload={reload} /></td>
                  <td className="td"><Estatus valor={d.estado} /></td>
                  <td className="td mono text-mute">{fecha(d.fecha_carga)}</td>
                  <td className="td mono text-mute">{d.vencimiento ? fecha(d.vencimiento) : d.estado === 'Validado' ? 'sin vencimiento' : '—'}</td>
                  <td className="td"><DocAcciones doc={d} reload={reload} /></td>
                </tr>
              ))}
            </Tabla>
          </Card>
          {lista.length > 200 && <p className="mt-2 text-xs text-mute">Se muestran 200 de {lista.length}. Usa el buscador o un filtro para acotar.</p>}
        </div>
        <Card titulo="Catálogo" extra={<Link to="/config" className="text-xs font-semibold text-brand">Editar</Link>}>
          <ul className="space-y-3">
            {data.catalogo.map((c: any) => (
              <li key={c.clave} className="rounded-xl border border-line p-3">
                <p className="text-sm font-semibold leading-tight">{c.nombre}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Chip tono="azul">{c.nivel}</Chip>
                  <Chip tono={c.modo === 'firma' ? 'verde' : 'gris'}>{c.modo === 'firma' ? 'se acepta en el formulario' : 'se sube archivo'}</Chip>
                  {c.nivel === 'Persona' && <Chip>{c.aplica}</Chip>}
                  <Chip>{c.vigencia_meses ? `vigencia ${c.vigencia_meses} meses` : 'sin vencimiento'}</Chip>
                  {c.obligatorio && <Chip tono="lima">obligatorio</Chip>}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-mute">Al validar, el vencimiento se calcula con la vigencia del catálogo. Los archivos llegan por el formulario de solicitud o de cambios, o los subes tú desde aquí. Toca el nombre de una persona para ver todos sus documentos.</p>
        </Card>
      </div>
    </Page>
  )
}
