import { useState } from 'react'

import { enDias, fecha, useApi } from '../api'
import { Card, Chip, EquipoLink, Estatus, Filtros, Page, Tabla, Vacio } from '../ui'
import { AccesoModal, PersonaLink } from './shared'

export default function Accesos() {
  const { data, reload, error } = useApi('/accesos')
  const [filtro, setFiltro] = useState('atencion')
  const [sel, setSel] = useState<any>(null)
  if (!data) return error ? <Page titulo="Accesos"><Vacio>{error}</Vacio></Page> : <p className="p-10 text-center text-sm text-mute" role="status">Cargando…</p>
  const vivos = data.accesos.filter((a: any) => a.integrante_activo && a.equipo.estado !== 'Baja')
  const porVencer = (a: any) => a.estado === 'Activo' && a.dias !== null && a.dias <= 15
  const grupos: Record<string, (a: any) => boolean> = {
    atencion: a => a.estado === 'Pendiente' || a.estado === 'Vencido' || porVencer(a),
    Pendiente: a => a.estado === 'Pendiente',
    vencer: porVencer,
    Vencido: a => a.estado === 'Vencido',
    Activo: a => a.estado === 'Activo',
    todos: () => true,
  }
  const base = filtro === 'todos' ? data.accesos : vivos
  const lista = base.filter(grupos[filtro]).sort((a: any, b: any) => (a.dias ?? -999) - (b.dias ?? -999) || a.persona.localeCompare(b.persona, 'es'))
  const n = (k: string) => (k === 'todos' ? data.accesos : vivos).filter(grupos[k]).length
  return (
    <Page titulo="Accesos" eyebrow="Espejo de la plataforma de accesos del campus">
      <p className="mb-4 max-w-3xl text-sm text-mute">
        Los accesos se siguen dando a mano en la plataforma del campus. Aquí se captura el vencimiento de cada persona: la revisión diaria avisa a 15 y 5 días y crea la tarea de renovación.
      </p>
      <div className="mb-4">
        <Filtros valor={filtro} onChange={setFiltro} opciones={[
          { id: 'atencion', label: 'Requieren atención', n: n('atencion') },
          { id: 'Pendiente', label: 'Por dar de alta', n: n('Pendiente') },
          { id: 'vencer', label: 'Por vencer (15 d)', n: n('vencer') },
          { id: 'Vencido', label: 'Vencidos', n: n('Vencido') },
          { id: 'Activo', label: 'Activos', n: n('Activo') },
          { id: 'todos', label: 'Todos', n: n('todos') },
        ]} />
      </div>
      <Card pad={false}>
        <Tabla cols={['Persona', 'Equipo', 'Tipo', 'Estado', 'Alta', 'Vence', '']} vacio={lista.length === 0}>
          {lista.map((a: any) => (
            <tr key={a.id} className="row">
              <td className="td"><p><PersonaLink id={a.member_id} nombre={a.persona} reload={reload} /></p><p className="text-xs text-mute">{a.correo}</p></td>
              <td className="td"><EquipoLink equipo={a.equipo} /><p className="text-xs text-mute">{a.equipo.estado}</p></td>
              <td className="td text-mute">{a.tipo_persona}</td>
              <td className="td"><Estatus valor={a.estado} /></td>
              <td className="td mono text-mute">{fecha(a.fecha_alta)}</td>
              <td className="td">
                {a.vencimiento ? <span className="flex items-center gap-2"><span className="mono text-mute">{fecha(a.vencimiento)}</span>
                  {a.estado !== 'Revocado' && a.dias !== null && <Chip tono={a.dias <= 0 ? 'rojo' : a.dias <= 5 ? 'naranja' : a.dias <= 15 ? 'ambar' : 'gris'}>{enDias(a.dias)}</Chip>}</span> : <span className="text-mute">—</span>}
              </td>
              <td className="td text-right">
                {a.estado !== 'Revocado' && a.integrante_activo
                  ? <button className={`btn ${a.estado === 'Pendiente' ? 'btn-primary' : ''}`} onClick={() => setSel(a)}>{a.estado === 'Pendiente' ? 'Dar de alta' : 'Renovar / revocar'}</button>
                  : a.estado === 'Activo' && <button className="btn btn-danger" onClick={() => setSel(a)}>Revocar</button>}
              </td>
            </tr>
          ))}
        </Tabla>
      </Card>
      {sel && <AccesoModal acceso={sel} persona={sel.persona} meses={data.meses} onClose={() => setSel(null)} reload={reload} />}
    </Page>
  )
}
