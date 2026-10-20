import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'

import { enDias, fecha, semanaLabel, useApi } from '../api'
import { Card, Chip, EquipoLink, ESTADO_STYLE, Page, Vacio } from '../ui'

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

/** Plano de los 33 lugares: lleno = cumple, naranja = en riesgo, punteado = libre. */
export function Plano({ espacios, minimo, onPick, activo }: { espacios: any[]; minimo: number; onPick?: (e: any) => void; activo?: number | null }) {
  const zonas = ['A', 'B', 'C']
  return (
    <div className="space-y-3">
      {zonas.map(z => (
        <div key={z} className="flex items-center gap-3">
          <span className="eyebrow w-4">{z}</span>
          <div className="grid flex-1 grid-cols-12 gap-1.5">
            {espacios.filter(e => e.zona === z).map(e => {
              const t = e.equipo
              const riesgo = t?.estado === 'En riesgo'
              const tono = !t ? 'border border-dashed border-brand-400/50 bg-white text-brand-400 hover:bg-brand-50'
                : riesgo ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-brand text-white hover:bg-brand-600'
              return (
                <button key={e.numero} onClick={() => onPick?.(e)}
                  title={t ? `${t.nombre} · ${t.estado}` : 'Libre'}
                  aria-label={`Espacio ${e.numero}: ${t ? `${t.nombre}, ${t.estado}` : 'libre'}`}
                  className={`group relative aspect-square cursor-pointer rounded-lg font-mono text-[12px] font-semibold transition hover:-translate-y-0.5 ${tono} ${activo === e.numero ? 'ring-4 ring-spark' : ''}`}>
                  {e.numero}
                  {t && e.dias !== undefined && e.dias !== null && (
                    <span className="absolute inset-x-1 bottom-1 flex justify-center gap-px">
                      {Array.from({ length: minimo }, (_, i) => <i key={i} className={`h-[3px] flex-1 rounded-full ${i < e.dias ? 'bg-spark' : 'bg-white/25'}`} />)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function Kpi({ label, valor, sub, to, acento = false }: { label: string; valor: number | string; sub?: string; to?: string; acento?: boolean }) {
  const inner = (
    <div className={`card h-full p-4 transition ${to ? 'hover:-translate-y-0.5 hover:border-brand-400' : ''} ${acento ? '!border-ink !bg-ink text-white' : ''}`}>
      <p className={`eyebrow ${acento ? '!text-white/50' : ''}`}>{label}</p>
      <p className="mt-2 font-display text-[40px] font-extrabold leading-none">{valor}</p>
      {sub && <p className={`mt-1.5 text-xs ${acento ? 'text-white/60' : 'text-mute'}`}>{sub}</p>}
    </div>
  )
  return to ? <Link to={to}>{inner}</Link> : inner
}

function Barras({ datos, max, alto = 120 }: { datos: { label: string; valor: number; sub?: string; tenue?: boolean }[]; max?: number; alto?: number }) {
  const tope = max ?? Math.max(1, ...datos.map(d => d.valor))
  return (
    <div className="flex items-end gap-1.5 overflow-hidden" style={{ height: alto + 34 }}>
      {datos.map((d, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <span className="font-mono text-[11px] font-semibold text-mute">{d.valor}</span>
          <div className={`w-full rounded-t-md transition-all ${d.tenue ? 'bg-brand-100' : 'bg-brand'}`} style={{ height: Math.max(3, (d.valor / tope) * alto) }} />
          <span className="whitespace-nowrap text-[10.5px] text-mute">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { data: d, error } = useApi('/dashboard')
  const nav = useNavigate()
  if (!d) return error ? <Page titulo="Inicio"><Vacio>{error}</Vacio></Page> : <p className="p-10 text-center text-sm text-mute" role="status">Cargando…</p>
  const { ocupacion: o, kpis: k } = d
  const flujo = d.por_estado as { estado: string; n: number }[]
  const pctOcupacion = o.total > 0 ? (o.ocupados / o.total) * 100 : 0
  const pasada = d.uso_semanal.at(-2)
  return (
    <Page titulo="Inicio" eyebrow={`Hoy · ${fecha(d.hoy.fecha)}`}>
      {d.corte && (
        <Link to="/corte" className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl bg-ink px-5 py-4 text-white transition hover:bg-navy">
          <span className="grid size-10 place-items-center rounded-xl bg-spark font-display text-lg font-extrabold text-ink">{d.corte.cambios}</span>
          <div className="flex-1">
            <p className="font-display text-lg font-bold leading-tight">Propuesta de corte lista para aprobar</p>
            <p className="text-[13px] text-white/60">Semana del {semanaLabel(d.corte.semana)} · {d.corte.cambios} cambios en {d.corte.equipos} equipos. Los mensajes salen al aprobar.</p>
          </div>
          <span className="btn btn-spark">Revisar <ArrowRight size={15} /></span>
        </Link>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <Card titulo={`Los ${o.total} espacios fijos`} extra={<Link to="/espacios" className="btn btn-ghost !text-brand">Ver plano <ArrowUpRight size={14} /></Link>}>
          <div className="mb-5 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="font-display text-[56px] font-extrabold leading-none">{o.ocupados}<span className="text-2xl text-mute">/{o.total}</span></p>
              <p className="mt-1 text-xs text-mute">ocupados · {o.libres} libre{o.libres === 1 ? '' : 's'}</p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1 text-xs text-mute">
              <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-brand" />Espacio fijo</span>
              <span className="flex items-center gap-1.5"><i className="size-3 rounded bg-orange-500" />En riesgo</span>
              <span className="flex items-center gap-1.5"><i className="size-3 rounded border border-dashed border-brand-400" />Libre</span>
              <span className="flex items-center gap-1.5"><i className="h-[3px] w-4 rounded-full bg-spark ring-1 ring-ink/10" />visitas esta semana (de {d.minimo})</span>
            </div>
          </div>
          <Plano espacios={d.espacios} minimo={d.minimo} onPick={e => nav(e.equipo ? `/equipos/${e.equipo.id}` : '/espacios')} />
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Kpi acento label="En el espacio hoy" valor={d.hoy.equipos} sub={`${d.hoy.checkins} check-ins registrados`} to="/checkins" />
          <Kpi label="Equipos en operación" valor={k.en_operacion} sub={`${k.en_riesgo} en riesgo · ${k.alerta_baja} en alerta`} to="/equipos" />
          <Kpi label="Tareas pendientes" valor={k.tareas} sub="evaluar, accesos, documentos" to="/tareas" />
          <Kpi label="Por evaluar" valor={k.por_evaluar} sub="solicitudes en comité" to="/solicitudes" />
          <Kpi label="Lista de espera" valor={k.lista_espera} sub="equipos que ya califican" to="/espacios" />
          <Kpi label="Mensajes en bandeja" valor={k.bandeja} sub="por revisar o enviar" to="/mensajes" />
        </div>
      </div>

      <Card titulo="Equipos por estado" className="mt-5" extra={<span className="text-xs text-mute">el ciclo de vida, de la solicitud a la operación</span>}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5 xl:grid-cols-10">
          {flujo.map((e, i) => (
            <Link key={e.estado} to={`/equipos?estado=${encodeURIComponent(e.estado)}`}
              className="group rounded-xl border border-line p-3 transition hover:-translate-y-0.5 hover:border-brand-400">
              <div className="flex items-center justify-between">
                <span className={`size-2 rounded-full ${ESTADO_STYLE[e.estado]?.dot ?? 'bg-slate-400'}`} />
                <span className="font-mono text-[10px] text-mute/60">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <p className="mt-2 font-display text-3xl font-extrabold leading-none">{e.n}</p>
              <p className="mt-1.5 text-[11.5px] font-medium leading-tight text-mute group-hover:text-brand">{e.estado}</p>
            </Link>
          ))}
        </div>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card titulo="Visitas por semana" extra={<span className="text-xs text-mute">suma de todos los equipos</span>}>
          <Barras datos={d.uso_semanal.map((u: any, i: number) => ({ label: `${Number(u.semana.slice(8))}/${Number(u.semana.slice(5, 7))}`, valor: u.dias_equipo, tenue: i === d.uso_semanal.length - 1 }))} />
          <p className="mt-3 text-xs text-mute">{pasada ? `La semana pasada ${pasada.cumplen} equipo(s) alcanzaron ${d.minimo}+ visitas.` : 'Aún no hay semanas anteriores para comparar.'} La barra clara es la semana en curso; la etiqueta es el lunes de cada semana.</p>
        </Card>
        <Card titulo="Check-ins por día" extra={<span className="text-xs text-mute">últimas 4 semanas</span>}>
          <Barras datos={d.checkins_por_dia.map((v: number, i: number) => ({ label: DIAS[i], valor: v }))} />
          <p className="mt-3 text-xs text-mute">Sirve para planear eventos y aforo.</p>
        </Card>
        <Card titulo="Este mes">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
            {[['Check-ins', d.mes.checkins], ['Solicitudes', d.mes.solicitudes], ['Equipos aceptados', d.mes.altas], ['Bajas', d.mes.bajas]].map(([l, v]) => (
              <div key={l}>
                <dt className="eyebrow">{l}</dt>
                <dd className="mt-1 font-display text-3xl font-extrabold leading-none">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5">
            <div className="mb-1 flex justify-between text-xs text-mute"><span>Ocupación</span><span className="font-mono">{Math.round(pctOcupacion)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-brand-100"><div className="h-full rounded-full bg-brand" style={{ width: `${pctOcupacion}%` }} /></div>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card titulo="Vencimientos de los próximos 30 días" pad={false}>
          {d.vencimientos.length === 0 ? <div className="p-5"><Vacio>Sin vencimientos cercanos.</Vacio></div> : (
            <ul className="max-h-[340px] overflow-y-auto">
              {d.vencimientos.map((v: any, i: number) => (
                <li key={`${v.tipo}-${v.quien}-${v.fecha}-${i}`} className="row flex items-center gap-3 px-5 py-2.5 text-sm">
                  <Chip tono={v.tipo === 'Acceso' ? 'azul' : 'gris'}>{v.tipo}</Chip>
                  <span className="min-w-0 flex-1 truncate" title={`${v.quien} · ${v.equipo?.nombre ?? ''}`}><b className="font-semibold">{v.quien}</b> <span className="text-mute">· <EquipoLink equipo={v.equipo} /></span></span>
                  <span className="mono text-mute">{fecha(v.fecha)}</span>
                  <Chip tono={v.dias <= 0 ? 'rojo' : v.dias <= 5 ? 'naranja' : v.dias <= 15 ? 'ambar' : 'gris'}>{enDias(v.dias)}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card titulo="Lista de espera" extra={<span className="text-xs text-mute">por promedio de uso</span>}>
          {d.lista_espera.length === 0 ? <Vacio>Nadie en espera: {o.libres > 0 ? `hay ${o.libres} lugar(es) libre(s).` : 'los lugares están completos.'}</Vacio> : (
            <ol className="space-y-2">
              {d.lista_espera.map((w: any) => (
                <li key={w.equipo.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-ink font-mono text-xs font-semibold text-spark">{w.posicion}</span>
                  <span className="flex-1"><EquipoLink equipo={w.equipo} /></span>
                  <span className="mono text-mute">{w.promedio} d/sem</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </Page>
  )
}
