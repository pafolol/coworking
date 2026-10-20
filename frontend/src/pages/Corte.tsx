import { ArrowRight, Check, RefreshCw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

import { api, fechaHora, semanaLabel, useApi } from '../api'
import { Card, Chip, EquipoLink, Estado, Estatus, Page, Tabla, useAccion, useToast, Vacio } from '../ui'

const ACCION: Record<string, { tono: string; mensaje: string }> = {
  Upgrade: { tono: 'lima', mensaje: 'Upgrade a Espacio Fijo' },
  'Lista de espera': { tono: 'azul', mensaje: 'Lista de espera' },
  'En riesgo': { tono: 'naranja', mensaje: 'Alerta de uso' },
  Downgrade: { tono: 'rojo', mensaje: 'Downgrade' },
  'Downgrade y alerta de baja': { tono: 'rojo', mensaje: 'Downgrade + Alerta de baja' },
  'Alerta de baja': { tono: 'rojo', mensaje: 'Alerta de baja' },
  Baja: { tono: 'tinta', mensaje: 'Baja' },
  Recupera: { tono: 'verde', mensaje: 'sin mensaje' },
  Reactivar: { tono: 'verde', mensaje: 'sin mensaje' },
}

export default function Corte() {
  const { data: lista, reload: reloadLista, error } = useApi('/cortes')
  const [id, setId] = useState<number | null>(null)
  const { data: corteRaw, reload: reloadCorte, error: errorCorte } = useApi(id ? `/cortes/${id}` : null)
  // useApi conserva el corte anterior mientras llega el nuevo: no se muestra con el id equivocado.
  const corte = corteRaw && corteRaw.id === id ? corteRaw : null
  const [verTodos, setVerTodos] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const reload = async () => { await reloadLista(); await reloadCorte() }
  const runBase = useAccion(reload)
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    if (busy) return false
    setBusy(true)
    try { return await runBase(fn, ok) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (lista && id === null && lista.cortes.length) setId((lista.cortes.find((c: any) => c.estado === 'Propuesta') ?? lista.cortes[0]).id)
  }, [lista, id])

  if (!lista) return error ? <Page titulo="Corte semanal"><Vacio>{error}</Vacio></Page> : <p className="p-10 text-center text-sm text-mute" role="status">Cargando…</p>
  const generar = async () => {
    if (busy) return
    setBusy(true)
    try {
      const c = await api('/cortes/generar', { method: 'POST' })
      setId(c.id)
      await reloadLista()
      toast(c.estado === 'Propuesta' ? 'Propuesta recalculada: se conservó lo que ya habías desmarcado' : 'Esa semana ya estaba aplicada o excluida: no se recalcula')
    } catch (e) {
      toast((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  const propuesta = corte?.estado === 'Propuesta'
  const cambios = corte?.items.filter((i: any) => i.accion !== 'Sin cambio') ?? []
  const sinCambio = corte?.items.filter((i: any) => i.accion === 'Sin cambio') ?? []
  const aprobadas = cambios.filter((i: any) => i.aprobada).length
  const bajas = cambios.filter((i: any) => i.aprobada && i.accion === 'Baja').length
  const resumen = Object.entries(cambios.reduce((acc: Record<string, number>, i: any) => ({ ...acc, [i.accion]: (acc[i.accion] ?? 0) + 1 }), {}))

  return (
    <Page titulo="Corte semanal" eyebrow="Cada lunes 7:00 · semana de lunes a domingo"
      acciones={<button className="btn" disabled={busy} onClick={generar}><RefreshCw size={14} /> Recalcular la semana del {semanaLabel(lista.semana_pendiente)}</button>}>
      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          {!corte && <Card>{lista.cortes.length === 0 ? <Vacio>Aún no hay cortes. Genera el primero con el botón de arriba.</Vacio> : <Vacio>{errorCorte || 'Cargando el corte…'}</Vacio>}</Card>}
          {corte && (
            <>
              <div className={`rounded-2xl p-5 ${propuesta ? 'bg-ink text-white' : 'card'}`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className={`eyebrow ${propuesta ? '!text-spark' : ''}`}>{propuesta ? 'Propuesta de corte · pendiente de aprobar' : `Aplicado por ${corte.aplicado_por} · ${fechaHora(corte.aplicado_en)}`}</p>
                    <h2 className="mt-1 text-2xl font-bold">Semana del {semanaLabel(corte.semana)}</h2>
                    {corte.nota && <p className="mt-1 text-sm opacity-70">{corte.nota}</p>}
                  </div>
                  {propuesta && (
                    <button className="btn btn-spark !px-4 !py-2.5 !text-sm" disabled={busy} onClick={() => confirm(`Se aplicarán ${aprobadas} de ${cambios.length} cambio(s)${bajas ? `, incluidas ${bajas} baja(s)` : ''}, y saldrán sus mensajes. Los desmarcados no se aplican. Esto no se puede deshacer. ¿Continuar?`) && run(() => api(`/cortes/${corte.id}/aplicar`, { method: 'POST' }), 'Corte aplicado: los mensajes están en Mensajes')}>
                      <Check size={16} /> Aprobar y aplicar {aprobadas} cambio{aprobadas === 1 ? '' : 's'}
                    </button>
                  )}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {resumen.length === 0 && <span className="text-sm opacity-70">Sin cambios esta semana.</span>}
                  {resumen.map(([accion, n]) => <Chip key={accion} tono={accion === 'Baja' && propuesta ? 'bg-white text-ink' : ACCION[accion]?.tono}>{n as number} · {accion}</Chip>)}
                  <Chip tono={propuesta ? 'bg-white/10 text-white/70' : 'gris'}>{sinCambio.length} sin cambio</Chip>
                </div>
                {propuesta && <p className="mt-3 text-xs text-white/55">Desmarca lo que no aplique (por ejemplo, un error de registro): así nadie recibe una baja por equivocación.</p>}
              </div>

              <Card pad={false}>
                <Tabla vacio={cambios.length === 0}
                  cols={[propuesta ? 'Aprobar' : 'Resultado', 'Equipo y motivo', <span title="Visitas en la semana anterior a la del corte">Semana anterior</span>, <span title="Visitas en la semana que mide este corte">Semana del corte</span>, 'Cambio de estado', 'Acción y mensaje que sale']}>
                  {cambios.map((i: any) => (
                    <tr key={i.id} className={`row ${i.aprobada ? '' : 'opacity-45'}`}>
                      <td className="td">
                        {propuesta
                          ? <input type="checkbox" className="size-4 accent-brand" checked={i.aprobada} disabled={busy} aria-label={`Aprobar ${i.accion} de ${i.equipo.nombre}`} onChange={e => run(() => api(`/cortes/items/${i.id}`, { method: 'PATCH', body: { aprobada: e.target.checked } }))} />
                          : <Estatus valor={i.resultado === 'Aplicada' ? 'Aplicada' : i.resultado || '—'} />}
                      </td>
                      <td className="td max-w-md"><EquipoLink equipo={i.equipo} /><p className="text-xs text-mute">{i.detalle}</p>
                        {(i.avisos ?? []).map((a: string) => <p key={a} className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-800"><TriangleAlert size={13} className="mt-px shrink-0" />{a}</p>)}</td>
                      <td className="td"><Dias n={i.dias_previa} min={lista.minimo} /></td>
                      <td className="td"><Dias n={i.dias} min={lista.minimo} /></td>
                      <td className="td"><span className="flex flex-wrap items-center gap-1.5"><Estado estado={i.estado_actual} /><ArrowRight size={13} className="text-mute" /><Estado estado={i.estado_nuevo} /></span></td>
                      <td className="td"><Chip tono={ACCION[i.accion]?.tono}>{i.accion}</Chip><p className="mt-1 text-xs text-mute">{ACCION[i.accion]?.mensaje === 'sin mensaje' ? 'no envía mensaje' : `mensaje: ${ACCION[i.accion]?.mensaje}`}</p></td>
                    </tr>
                  ))}
                </Tabla>
                <button className="w-full cursor-pointer border-t border-line px-5 py-3 text-left text-sm font-semibold text-mute hover:text-brand" onClick={() => setVerTodos(!verTodos)}>
                  {verTodos ? 'Ocultar' : 'Ver'} los {sinCambio.length} equipos sin cambio
                </button>
                {verTodos && (
                  <Tabla cols={['Equipo', 'Estado', 'Semana anterior', 'Semana del corte', 'Promedio', 'Nota']}>
                    {sinCambio.map((i: any) => (
                      <tr key={i.id} className="row">
                        <td className="td"><EquipoLink equipo={i.equipo} /></td>
                        <td className="td"><Estado estado={i.estado_actual} /></td>
                        <td className="td"><Dias n={i.dias_previa} min={lista.minimo} /></td>
                        <td className="td"><Dias n={i.dias} min={lista.minimo} /></td>
                        <td className="td mono text-mute">{i.promedio}</td>
                        <td className="td text-xs text-mute">{i.detalle}</td>
                      </tr>
                    ))}
                  </Tabla>
                )}
              </Card>
            </>
          )}
        </div>

        <div className="space-y-5">
          <Card titulo="Historial">
            <ul className="space-y-1.5">
              {lista.cortes.length === 0 && <Vacio>Sin cortes.</Vacio>}
              {lista.cortes.map((c: any) => (
                <li key={c.id}>
                  <button onClick={() => { setId(c.id); setVerTodos(false) }} aria-current={c.id === id} className={`flex w-full cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${c.id === id ? 'border-ink bg-ink text-white' : 'border-line hover:border-brand-400'}`}>
                    <span><b className="font-semibold">{semanaLabel(c.semana)}</b><span className={`block text-xs ${c.id === id ? 'text-white/55' : 'text-mute'}`}>{c.cambios} cambios · {c.equipos} equipos</span></span>
                    <Estatus valor={c.estado} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card titulo="Qué decide el corte">
            <ul className="space-y-2.5 text-[13px] leading-snug text-mute">
              <li><b className="text-ink">Upgrade:</b> {lista.minimo}+ visitas dos semanas seguidas y hay lugar.</li>
              <li><b className="text-ink">Lista de espera:</b> cumple la regla pero no hay lugar.</li>
              <li><b className="text-ink">En riesgo:</b> espacio fijo con menos de {lista.minimo} visitas en la semana.</li>
              <li><b className="text-ink">Downgrade:</b> dos semanas bajas seguidas; libera el lugar.</li>
              <li><b className="text-ink">Alerta de baja:</b> 0 visitas en dos semanas; 7 días para responder.</li>
              <li><b className="text-ink">Baja:</b> sin uso ni respuesta tras el aviso.</li>
            </ul>
            <p className="mt-3 text-xs text-mute">Aprobación automática: <b>{lista.automatica ? 'activada' : 'desactivada'}</b> (Configuración).</p>
          </Card>
        </div>
      </div>
    </Page>
  )
}

function Dias({ n, min }: { n: number; min: number }) {
  return <span className={`grid size-7 place-items-center rounded-md font-mono text-xs font-semibold ${n >= min ? 'bg-brand text-white' : n > 0 ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400'}`}>{n}</span>
}
