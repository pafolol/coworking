import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { api, useApi } from '../api'
import { Card, EquipoLink, Estado, Filtros, Page, Tabla, useAccion, useToast, Vacio } from '../ui'

// Un tono por escalón, del más bajo al más alto.
const TONOS = ['bg-slate-200 text-slate-700', 'bg-brand-100 text-brand-600', 'bg-brand text-white', 'bg-ink text-spark', 'bg-spark text-ink']
const tono = (i: number) => TONOS[Math.min(i, TONOS.length - 1)]

export default function Niveles() {
  const { data, reload, error } = useApi('/niveles')
  const run = useAccion(reload)
  const toast = useToast()
  const [guardando, setGuardando] = useState(false)
  const [edit, setEdit] = useState<any[] | null>(null)
  const [filtro, setFiltro] = useState('todos')
  if (!data) return error ? <Page titulo="Niveles y beneficios"><Vacio>{error}</Vacio></Page> : <p className="p-10 text-center text-sm text-mute" role="status">Cargando…</p>
  const niveles: any[] = edit ?? data.niveles
  const cambiar = (i: number, cambios: object) => setEdit(niveles.map((n, j) => (j === i ? { ...n, ...cambios } : n)))
  const guardar = async () => {
    const limpio = niveles.filter(n => n.nombre.trim()).map(n => ({ ...n, nombre: n.nombre.trim(), promedio_min: Number(n.promedio_min) || 0, racha_min: Number(n.racha_min) || 0, beneficios: n.beneficios.map((b: string) => b.trim()).filter(Boolean) }))
    if (guardando) return
    if (!niveles[0]?.nombre.trim()) return toast('El primer nivel necesita un nombre.', true)
    const nombres = limpio.map(n => n.nombre.toLowerCase())
    if (new Set(nombres).size !== nombres.length) return toast('Hay dos niveles con el mismo nombre: cada uno debe llamarse distinto.', true)
    for (let i = 2; i < limpio.length; i++) {
      if (limpio[i].promedio_min < limpio[i - 1].promedio_min || limpio[i].racha_min < limpio[i - 1].racha_min) return toast(`«${limpio[i].nombre}» debe pedir al menos el promedio y la racha del nivel anterior.`, true)
    }
    setGuardando(true)
    const ok = await run(() => api('/config', { method: 'PUT', body: { NIVELES: limpio } }), 'Niveles guardados')
    setGuardando(false)
    if (ok) { setEdit(null); setFiltro('todos') }
  }
  const lista = data.equipos.filter((e: any) => filtro === 'todos' || e.nivel === filtro)

  return (
    <Page titulo="Niveles y beneficios" eyebrow="Reconocer a los equipos más constantes"
      acciones={edit
        ? <><button className="btn" onClick={() => setEdit(null)}>Cancelar</button><button className="btn btn-primary" disabled={guardando} onClick={guardar}>Guardar niveles</button></>
        : <button className="btn" onClick={() => setEdit(structuredClone(data.niveles))}><Pencil size={14} /> Editar niveles y beneficios</button>}>
      <p className="mb-5 max-w-3xl text-sm text-mute">
        El nivel se calcula solo con los check-ins: un equipo está en el nivel más alto del que cumple los dos requisitos, el <b>promedio de visitas por semana</b> (últimas {data.semanas_promedio} semanas)
        y la <b>racha</b> de semanas seguidas con {data.minimo}+ visitas. Si baja su uso, baja de nivel en el siguiente corte.
      </p>

      <div className={`grid gap-4 ${edit ? 'lg:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-4'}`}>
        {niveles.map((n, i) => {
          const cuantos = data.equipos.filter((e: any) => e.nivel === n.nombre).length
          return (
            <div key={i} className="card flex flex-col overflow-hidden">
              <div className={`flex items-center justify-between px-5 py-3 ${tono(i)}`}>
                <span className="font-mono text-xs opacity-70">NIVEL {i + 1}</span>
                {edit
                  ? i > 0 && <button className="cursor-pointer opacity-70 hover:opacity-100" title="Quitar nivel" aria-label={`Quitar el nivel ${i + 1}`} onClick={() => setEdit(niveles.filter((_, j) => j !== i))}><Trash2 size={15} /></button>
                  : <span className="font-mono text-xs opacity-70">{cuantos} equipo{cuantos === 1 ? '' : 's'}</span>}
              </div>
              <div className="flex flex-1 flex-col p-5">
                {edit ? (
                  <div className="space-y-3">
                    <input className="input font-display text-lg font-bold" aria-label={`Nombre del nivel ${i + 1}`} value={n.nombre} placeholder="Nombre del nivel" onChange={e => cambiar(i, { nombre: e.target.value })} />
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-mute">Promedio mínimo (visitas/sem)
                        <input type="number" step="0.5" min={0} disabled={i === 0} className="input mt-1 font-mono" value={n.promedio_min} onChange={e => cambiar(i, { promedio_min: e.target.value })} />
                      </label>
                      <label className="text-xs font-semibold text-mute">Racha mínima (semanas)
                        <input type="number" min={0} disabled={i === 0} className="input mt-1 font-mono" value={n.racha_min} onChange={e => cambiar(i, { racha_min: e.target.value })} />
                      </label>
                    </div>
                    <label className="block text-xs font-semibold text-mute">Beneficios (uno por línea)
                      <textarea className="input mt-1 min-h-32 text-[13px] leading-relaxed" value={n.beneficios.join('\n')} onChange={e => cambiar(i, { beneficios: e.target.value.split('\n') })} />
                    </label>
                    {i === 0 && <p className="text-xs text-mute">El primer nivel es la base: lo tiene todo equipo en operación.</p>}
                  </div>
                ) : (
                  <>
                    <h2 className="text-2xl font-bold">{n.nombre}</h2>
                    <p className="mt-1 text-[13px] text-mute">
                      {i === 0 ? 'Todo equipo en operación.' : <>Promedio de <b className="text-ink">{n.promedio_min}+</b> visitas por semana y <b className="text-ink">{n.racha_min}+</b> semanas seguidas cumpliendo.</>}
                    </p>
                    <ul className="mt-4 space-y-2 text-sm">
                      {n.beneficios.map((b: string, k: number) => <li key={k} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{b}</li>)}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )
        })}
        {edit && (
          <button className="grid min-h-40 cursor-pointer place-items-center rounded-2xl border border-dashed border-brand-400 text-sm font-semibold text-brand hover:bg-brand-50"
            onClick={() => setEdit([...niveles, { nombre: '', promedio_min: 5, racha_min: 12, beneficios: [] }])}>
            <span className="flex items-center gap-2"><Plus size={16} /> Agregar un nivel más alto</span>
          </button>
        )}
      </div>
      {!edit && <p className="mt-3 text-xs text-mute">Los beneficios son un borrador de ejemplo: cámbialos por los que el espacio sí puede ofrecer. Cada nivel incluye los de los anteriores.</p>}

      {!edit && (
        <>
          <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">En qué nivel está cada equipo</h2>
            <Filtros valor={filtro} onChange={setFiltro} opciones={[{ id: 'todos', label: 'Todos', n: data.equipos.length }, ...data.niveles.map((n: any) => ({ id: n.nombre, label: n.nombre, n: data.equipos.filter((e: any) => e.nivel === n.nombre).length })).reverse()]} />
          </div>
          <Card pad={false}>
            <Tabla cols={['Equipo', 'Nivel', 'Promedio', 'Racha', 'Estado', 'Para subir de nivel']} vacio={lista.length === 0}>
              {lista.map((e: any) => (
                <tr key={e.id} className="row">
                  <td className="td"><EquipoLink equipo={e} /><p className="text-xs text-mute">{e.lider}{e.espacio && ` · espacio ${e.espacio}`}</p></td>
                  <td className="td"><span className={`inline-block rounded-md px-2 py-1 text-xs font-bold ${tono(e.indice)}`}>{e.nivel}</span></td>
                  <td className="td"><span className="font-mono font-semibold">{e.promedio}</span> <span className="text-xs text-mute">visitas/sem</span></td>
                  <td className="td"><span className="font-mono font-semibold">{e.racha}{e.racha_tope ? '+' : ''}</span> <span className="text-xs text-mute">sem.</span></td>
                  <td className="td"><Estado estado={e.estado} /></td>
                  <td className="td text-[13px] text-mute">{e.siguiente ? <><b className="text-ink">{e.siguiente}:</b> {e.falta}</> : 'Ya está en el nivel más alto'}</td>
                </tr>
              ))}
            </Tabla>
          </Card>
        </>
      )}
    </Page>
  )
}
