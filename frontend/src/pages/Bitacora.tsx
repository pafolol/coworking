import { useState } from 'react'

import { fechaHora, useApi } from '../api'
import { Card, Chip, EquipoLink, Filtros, Page, Tabla, Vacio } from '../ui'

const TONO: Record<string, string> = { Estado: 'azul', Correo: 'lima', Sistema: 'gris', Acceso: 'verde', Documento: 'ambar', Cambio: 'naranja' }

export default function Bitacora() {
  const [tipo, setTipo] = useState('')
  const { data, error } = useApi(`/bitacora${tipo ? `?tipo=${tipo}` : ''}`)
  return (
    <Page titulo="Bitácora" eyebrow="Cada cambio de estado y cada correo">
      <div className="mb-4">
        <Filtros valor={tipo} onChange={setTipo} opciones={[{ id: '', label: 'Todo' }, ...Object.keys(TONO).map(t => ({ id: t, label: t }))]} />
      </div>
      {error && <div className="mb-4"><Vacio>{error}</Vacio></div>}
      <Card pad={false}>
        <Tabla cols={['Cuándo', 'Tipo', 'Equipo', 'Qué pasó', 'Quién']} vacio={data?.bitacora.length === 0}>
          {data?.bitacora.map((l: any) => (
            <tr key={l.id} className="row">
              <td className="td mono whitespace-nowrap text-mute">{fechaHora(l.ts)}</td>
              <td className="td"><Chip tono={TONO[l.tipo]}>{l.tipo}</Chip></td>
              <td className="td"><EquipoLink equipo={l.equipo} /></td>
              <td className="td">{l.detalle}</td>
              <td className="td text-mute">{l.actor || '—'}</td>
            </tr>
          ))}
        </Tabla>
        {!data && !error && <p className="px-5 py-6 text-center text-sm text-mute" role="status">Cargando…</p>}
      </Card>
      {data?.bitacora.length >= 400 && <p className="mt-2 text-xs text-mute">Se muestran los 400 movimientos más recientes{tipo ? ` de tipo «${tipo}»` : ''}.</p>}
    </Page>
  )
}
