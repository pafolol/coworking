import { Copy, Printer, RefreshCw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'

import { api, fecha, fechaHora, useApi } from '../api'
import { Card, Chip, EquipoLink, Filtros, Page, Tabla, useAccion, useToast, Vacio } from '../ui'
import { PersonaLink } from './shared'

export default function Checkins() {
  const { data, reload, error } = useApi('/checkins')
  const run = useAccion(reload)
  const toast = useToast()
  const [correo, setCorreo] = useState('')
  const [dia, setDia] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [enviando, setEnviando] = useState(false)
  const [rotando, setRotando] = useState(false)
  if (!data) return error ? <Page titulo="Check-ins"><Vacio>{error}</Vacio></Page> : <p className="p-10 text-center text-sm text-mute" role="status">Cargando…</p>
  const lista = data.checkins.filter((c: any) => filtro === 'todos' || (filtro === 'invalidos' ? !c.valido : c.fecha === data.hoy))
  const manual = async () => {
    if (enviando) return
    setEnviando(true)
    try {
      const r = await api('/checkins', { body: { correo: correo.trim(), fecha: dia || undefined } })
      toast(r.ok ? (r.ya_registrado ? `Esa persona ya tenía check-in ese día (${r.equipo}); no se duplicó.` : `Check-in registrado para ${r.equipo}`) : r.mensaje, !r.ok)
      if (r.ok) setCorreo('')
      await reload()
    } catch (e) {
      toast((e as Error).message, true)
    } finally {
      setEnviando(false)
    }
  }
  return (
    <Page titulo="Check-ins" eyebrow="El QR mide el uso real">
      <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          <Card titulo="QR del espacio">
            <div className="grid place-items-center rounded-2xl bg-ink p-6">
              <div className="rounded-xl bg-white p-3"><QRCodeSVG value={data.link} size={190} fgColor="#06123a" /></div>
              <p className="mt-4 font-display text-xl font-bold text-white">Escanea al llegar</p>
              <p className="text-xs text-white/55">un check-in al día = una visita de tu equipo</p>
            </div>
            <p className="mono mt-3 break-all text-mute">{data.link}</p>
            <div className="no-print mt-3 flex flex-wrap gap-2">
              <button className="btn" onClick={() => window.print()}><Printer size={14} /> Imprimir</button>
              <button className="btn" onClick={() => { navigator.clipboard.writeText(data.link).then(() => toast('Enlace copiado'), () => toast('No se pudo copiar: selecciona el enlace y cópialo a mano.', true)) }}><Copy size={14} /> Copiar</button>
              <button className="btn btn-danger" disabled={rotando} onClick={async () => { if (!confirm('El QR impreso dejará de funcionar y nadie podrá hacer check-in hasta que imprimas el nuevo. ¿Rotar?')) return; setRotando(true); await run(() => api('/qr/rotar', { method: 'POST' }), 'QR rotado: imprime el nuevo'); setRotando(false) }}><RefreshCw size={14} /> Rotar QR</button>
            </div>
            <p className="mt-3 text-xs text-mute">Pégalo solo dentro del espacio. Si detectas uso remoto, rótalo: el sistema solo acepta el QR vigente.</p>
          </Card>
          <Card titulo="Check-in manual" className="no-print">
            <p className="mb-3 text-xs text-mute">Para corregir un día en que alguien no pudo escanear. Queda en la bitácora.</p>
            <form className="space-y-2" onSubmit={e => { e.preventDefault(); void manual() }}>
              <input className="input" type="email" aria-label="Correo del integrante" placeholder="correo del integrante" value={correo} onChange={e => setCorreo(e.target.value)} />
              <input className="input" type="date" aria-label="Día del check-in (vacío = hoy)" value={dia} onChange={e => setDia(e.target.value)} max={data.hoy} />
              <p className="text-xs text-mute">Si dejas el día vacío se registra hoy.</p>
              <button type="submit" className="btn btn-primary w-full" disabled={!correo.includes('@') || enviando}>{enviando ? 'Registrando…' : 'Registrar'}</button>
            </form>
          </Card>
        </div>

        <Card pad={false} className="no-print" titulo="Últimos 14 días"
          extra={<Filtros valor={filtro} onChange={setFiltro} opciones={[
            { id: 'todos', label: 'Todos', n: data.checkins.length },
            { id: 'hoy', label: 'Hoy', n: data.checkins.filter((c: any) => c.fecha === data.hoy).length },
            { id: 'invalidos', label: 'Inválidos', n: data.checkins.filter((c: any) => !c.valido).length },
          ]} />}>
          <Tabla cols={['Cuándo', 'Persona', 'Equipo', 'Origen', 'Estado']} vacio={lista.length === 0}>
            {lista.slice(0, 150).map((c: any) => (
              <tr key={c.id} className="row">
                <td className="td mono text-mute">{c.fecha === data.hoy ? `hoy · ${c.ts.slice(11, 16)}` : fechaHora(c.ts)}</td>
                <td className="td"><p>{c.member_id ? <PersonaLink id={c.member_id} nombre={c.persona} reload={reload} /> : <span className="text-mute">Sin identificar</span>}</p><p className="text-xs text-mute">{c.correo}</p></td>
                <td className="td"><EquipoLink equipo={c.equipo} /></td>
                <td className="td text-mute">{c.origen}</td>
                <td className="td">{c.valido ? <Chip tono={c.nota ? 'ambar' : 'verde'}>{c.nota || 'Válido'}</Chip> : <Chip tono="rojo">{c.nota || 'Inválido'}</Chip>}</td>
              </tr>
            ))}
          </Tabla>
          {lista.length > 150 && <p className="px-5 py-3 text-xs text-mute">Mostrando los 150 más recientes de {lista.length} (el más antiguo mostrado es del {fecha(lista[149].fecha)}).</p>}
        </Card>
      </div>
    </Page>
  )
}
