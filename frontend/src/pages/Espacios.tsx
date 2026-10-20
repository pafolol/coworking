import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, fecha, useApi } from '../api'
import { Card, Estado, Page, Uso, useAccion, Vacio } from '../ui'
import { Plano } from './Dashboard'

export default function Espacios() {
  const { data, reload, error } = useApi('/espacios')
  const runBase = useAccion(reload)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    if (busy) return false
    setBusy(true)
    try { return await runBase(fn, ok) } finally { setBusy(false) }
  }
  const [sel, setSel] = useState<number | null>(null)
  const [team, setTeam] = useState('')
  const detalle = useRef<HTMLDivElement>(null)
  // El detalle queda justo bajo el plano; si aun así no se ve, la página baja hasta él.
  useEffect(() => { if (sel !== null) detalle.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [sel])
  if (!data) return error ? <Page titulo="Espacios"><Vacio>{error}</Vacio></Page> : <p className="p-10 text-center text-sm text-mute" role="status">Cargando…</p>
  const espacios = data.espacios.map((e: any) => ({ ...e, dias: e.equipo ? e.equipo.uso.at(-1) : null }))
  const actual = espacios.find((e: any) => e.numero === sel)
  const libres = espacios.filter((e: any) => !e.equipo).length
  const elegir = (n: number) => { setSel(n); setTeam('') }
  return (
    <Page titulo="Espacios" eyebrow={`${espacios.length} lugares fijos · ${libres} libre${libres === 1 ? '' : 's'}`}>
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <Card titulo="Plano" extra={<span className="text-xs text-mute">toca un lugar para ver o cambiar quién lo ocupa</span>}>
            <Plano espacios={espacios} minimo={data.minimo} onPick={e => elegir(e.numero)} activo={sel} />
            <div ref={detalle} className="mt-5 scroll-mt-6 rounded-xl border border-line bg-slate-50 p-4">
              {!actual && <p className="text-sm text-mute">Elige un lugar del plano para ver su detalle aquí.</p>}
              {actual?.equipo && (
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <span className="grid size-12 place-items-center rounded-xl bg-brand font-mono text-lg font-semibold text-white">{actual.numero}</span>
                  <div className="min-w-48 flex-1">
                    <Link to={`/equipos/${actual.equipo.id}`} className="font-display text-xl font-bold hover:text-brand">{actual.equipo.nombre}</Link>
                    <p className="text-sm text-mute">{actual.equipo.lider} · zona {actual.zona} · desde {fecha(actual.desde)}</p>
                  </div>
                  <div className="flex items-center gap-3"><Estado estado={actual.equipo.estado} /><Uso dias={actual.equipo.uso} minimo={data.minimo} grande /></div>
                  <button className="btn btn-danger" disabled={busy} onClick={() => confirm(`¿Liberar el espacio ${actual.numero}? ${actual.equipo.nombre} pasa a Activo – Coworking sin enviar correo.`) && run(() => api(`/espacios/${actual.numero}`, { body: { liberar: true } }), 'Espacio liberado')}>Liberar a mano</button>
                  <p className="w-full text-xs text-mute">Visitas por semana (la última celda es la semana en curso). Necesita {data.minimo}+ para conservarlo; el corte lo libera solo tras dos semanas bajas.</p>
                </div>
              )}
              {actual && !actual.equipo && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid size-12 place-items-center rounded-xl border border-dashed border-brand-400 bg-white font-mono text-lg font-semibold text-brand">{actual.numero}</span>
                  <div className="min-w-48 flex-1">
                    <p className="font-display text-xl font-bold">Espacio {actual.numero} · libre</p>
                    <p className="text-sm text-mute">Lo normal es que el corte se lo dé al primero de la lista de espera. Asignarlo a mano no envía correo.</p>
                  </div>
                  <select className="input !w-64" value={team} onChange={e => setTeam(e.target.value)} aria-label="Equipo al que se asigna">
                    <option value="">Elegir equipo…</option>
                    {data.candidatos.map((t: any) => <option key={t.id} value={t.id}>{t.nombre} · {t.estado}</option>)}
                  </select>
                  {data.candidatos.length === 0 && <p className="w-full text-xs text-mute">No hay equipos activos o en lista de espera a quienes asignar este lugar.</p>}
                  <button className="btn btn-primary" disabled={!team || busy} onClick={async () => { if (await run(() => api(`/espacios/${actual.numero}`, { body: { team_id: Number(team) } }), 'Espacio asignado')) setTeam('') }}>Asignar</button>
                </div>
              )}
            </div>
          </Card>
          <Card titulo="Ocupantes" pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className="th">#</th><th className="th">Equipo</th><th className="th">Estado</th><th className="th">Visitas · últimas semanas</th><th className="th">Desde</th></tr></thead>
                <tbody>
                  {espacios.filter((e: any) => e.equipo).map((e: any) => (
                    <tr key={e.numero} className={`row cursor-pointer ${sel === e.numero ? 'bg-brand-50' : ''}`} onClick={() => elegir(e.numero)}>
                      <td className="td"><span title={`Espacio ${e.numero}`} className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-xs font-semibold text-white">{e.numero}</span></td>
                      <td className="td"><Link className="whitespace-nowrap font-semibold hover:text-brand" to={`/equipos/${e.equipo.id}`} onClick={ev => ev.stopPropagation()}>{e.equipo.nombre}</Link><p className="text-xs text-mute">{e.equipo.lider}</p></td>
                      <td className="td"><Estado estado={e.equipo.estado} />{e.equipo.en_pausa && <span className="ml-1 text-xs text-mute">en pausa</span>}</td>
                      <td className="td"><Uso dias={e.equipo.uso} minimo={data.minimo} /></td>
                      <td className="td whitespace-nowrap text-mute">{fecha(e.desde)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {libres === espacios.length && <p className="px-5 py-10 text-center text-sm text-mute">Ningún espacio está ocupado todavía.</p>}
            </div>
          </Card>
        </div>

        <Card titulo="Lista de espera" extra={<span className="text-xs text-mute">promedio de 4 semanas</span>} className="xl:sticky xl:top-5 xl:self-start">
          {data.lista_espera.length === 0 ? <Vacio>Nadie en espera.</Vacio> : (
            <ol className="space-y-2">
              {data.lista_espera.map((w: any) => (
                <li key={w.equipo.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-ink font-mono text-xs font-semibold text-spark">{w.posicion}</span>
                  <Link to={`/equipos/${w.equipo.id}`} className="min-w-0 flex-1 truncate font-semibold hover:text-brand" title={w.equipo.nombre}>{w.equipo.nombre}</Link>
                  <span className="mono text-mute">{w.promedio} visitas/sem</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-mute">Quien está en la lista recibe el siguiente lugar que se libere, siempre que esa semana haya vuelto a cumplir el mínimo.</p>
        </Card>
      </div>
    </Page>
  )
}
