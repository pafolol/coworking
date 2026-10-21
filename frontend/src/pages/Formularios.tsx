import { Copy, ExternalLink, Pencil } from 'lucide-react'
import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router-dom'

import { fechaHora, useApi } from '../api'
import { Card, Chip, EquipoLink, Estatus, Page, Tabla, useToast, Vacio } from '../ui'
import EditorFormulario from './EditorFormulario'
import FormulariosPropios from './FormulariosPropios'

export default function Formularios() {
  const { data: cfg, error, reload } = useApi('/config')
  const [editando, setEditando] = useState<any>(null)
  const { data: cambios, error: errorCambios } = useApi('/cambios')
  const toast = useToast()
  if (!cfg) return error ? <Page titulo="Formularios"><Vacio>{error}</Vacio></Page> : null
  const forms = [
    { clave: 'solicitud', titulo: 'Solicitud', url: cfg.links.solicitud, quien: 'Equipos que quieren entrar',
      que: 'Datos del proyecto, integrantes y documentos. Crea el equipo con folio, confirma el registro y revisa si falta algo.', llega: '/solicitudes', llegaA: 'Solicitudes' },
    { clave: 'checkin', titulo: 'Check-in', url: cfg.links.checkin, quien: 'Integrantes, al llegar (QR del espacio)',
      que: 'Una sola pregunta: el correo. Cada día con check-in de cualquier integrante es una visita del equipo.', llega: '/checkins', llegaA: 'Check-ins' },
    { clave: 'cambios', titulo: 'Cambios', url: cfg.links.cambios, quien: 'Líderes de equipos ya registrados',
      que: 'Altas y bajas de integrantes, subir o actualizar documentos, pedir pausa y confirmar la renovación del semestre.', llega: '/documentos', llegaA: 'Documentos y Tareas' },
  ]
  const copiar = (url: string) => { void navigator.clipboard.writeText(url); toast('Enlace copiado') }
  return (
    <Page titulo="Formularios" eyebrow="Los de siempre y los que armes tú; no hay que iniciar sesión para llenarlos">
      <div className="grid gap-5 lg:grid-cols-3">
        {forms.map((f, i) => (
          <div key={f.titulo} className={`flex flex-col rounded-2xl p-5 ${i === 0 ? 'bg-ink text-white' : 'card'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className={`eyebrow ${i === 0 ? '!text-spark' : ''}`}>{f.quien}</p>
                <h2 className="mt-1 text-2xl font-bold">{f.titulo}</h2>
              </div>
              <div className="rounded-lg bg-white p-1.5"><QRCodeSVG value={f.url} size={72} fgColor="#06123a" /></div>
            </div>
            <p className={`mt-3 flex-1 text-[13px] leading-relaxed ${i === 0 ? 'text-white/65' : 'text-mute'}`}>{f.que}</p>
            <p className={`mono mt-4 break-all rounded-lg px-2.5 py-2 ${i === 0 ? 'bg-white/10 text-white' : 'bg-brand-50 text-brand-600'}`}>{f.url}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className={`btn ${i === 0 ? 'btn-spark' : 'btn-primary'}`} href={f.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Abrir</a>
              <button className="btn" onClick={() => setEditando(f)}><Pencil size={14} /> Editar</button>
              <button className="btn" onClick={() => copiar(f.url)}><Copy size={14} /> Copiar enlace</button>
            </div>
            <p className={`mt-3 text-xs ${i === 0 ? 'text-white/50' : 'text-mute'}`}>Lo que llega se ve en <Link to={f.llega} className="font-semibold underline">{f.llegaA}</Link>.</p>
          </div>
        ))}
      </div>
      <FormulariosPropios />

      <p className="mt-3 text-xs text-mute">Los enlaces usan la dirección pública configurada ({cfg.config.PUBLIC_URL}). Cámbiala en Configuración cuando publiques el sitio en un dominio; el QR de check-in se imprime y se rota en Check-ins.</p>

      <Card titulo="Lo que ha llegado por el formulario de cambios" className="mt-5" pad={false}>
        {errorCambios && <p className="px-5 pt-3 text-sm text-red-700">No se pudieron cargar los cambios: {errorCambios}</p>}
        {!cambios && !errorCambios && <p className="px-5 pt-3 text-sm text-mute">Cargando…</p>}
        <Tabla cols={['Cuándo', 'Equipo', 'Tipo', 'Detalle', 'Estado']} vacio={cambios?.cambios.length === 0}>
          {cambios?.cambios.map((c: any) => (
            <tr key={c.id} className="row">
              <td className="td mono whitespace-nowrap text-mute">{fechaHora(c.ts)}</td>
              <td className="td"><EquipoLink equipo={c.equipo} /></td>
              <td className="td"><Chip tono="azul">{c.tipo}</Chip></td>
              <td className="td text-mute">{c.detalle}</td>
              <td className="td"><Estatus valor={c.estado} /></td>
            </tr>
          ))}
        </Tabla>
      </Card>
      {editando && <EditorFormulario clave={editando.clave} nombre={editando.titulo} url={editando.url} todos={cfg.formularios} onClose={() => setEditando(null)} reload={reload} />}
    </Page>
  )
}
