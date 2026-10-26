import { CheckCircle2, ChevronRight, Download, FileSpreadsheet, RotateCcw, Sparkles, TriangleAlert, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { api, API_URL, fecha, useApi } from '../api'
import { Card, Chip, Estado, Page, useToast } from '../ui'

const CAMPOS: [string, string][] = [
  ['ignorar', 'No usar'],
  ['equipo', 'Equipo o proyecto'], ['estado', 'Estado'], ['decision', 'Decisión (aceptado o no)'], ['espacio', 'Número de espacio'],
  ['fecha_ingreso', 'Fecha de ingreso o de solicitud'], ['sector', 'Sector'], ['etapa', 'Etapa'], ['descripcion', 'Descripción'],
  ['respuesta', 'Respuesta del formulario (se guarda)'],
  ['nombre', 'Nombre de la persona'], ['correo', 'Correo'], ['tipo', 'Tipo de persona'], ['matricula', 'Matrícula o nómina'],
  ['lider', '¿Es líder? (sí/no)'], ['acceso_vence', 'Vencimiento del acceso'],
  ['integrantes_lista', 'Varios integrantes en una celda'],
]
const DE_PERSONA = ['nombre', 'correo', 'tipo', 'matricula', 'lider', 'acceso_vence']
const ALTA: Record<string, [string, string]> = {
  solicitud: ['Entra como solicitud', 'azul'], existente: ['Se agregan personas', 'verde'],
}
const EN_OPERACION = ['Activo – Coworking', 'Lista de espera', 'Espacio fijo', 'En riesgo', 'Alerta de baja']
const MODO: Record<string, string> = {
  ia: 'Columnas reconocidas con IA', plantilla: 'Formato de plantilla: leído directo', manual: 'Columnas ajustadas a mano', local: 'Columnas reconocidas por nombre',
}

export default function Importar() {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const { data: estado } = useApi('/importar/estado')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [res, setRes] = useState<any>(null)        // { plan, filas, notas, modo, mapa }
  const [hecho, setHecho] = useState<any>(null)
  const [ocupado, setOcupado] = useState('')
  const [cambios, setCambios] = useState('')
  const [pedidos, setPedidos] = useState<string[]>([])
  const importando = useRef(false)

  // Con una vista previa abierta, salir de la página descarta el mapeo ajustado: avisa antes de cerrar la pestaña.
  useEffect(() => {
    if (!res) return
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [res])

  const acomodar = async (file: File, opciones: { indicaciones?: string[]; mapa?: any[] }) => {
    setOcupado(opciones.mapa ? 'Aplicando tus cambios…' : opciones.indicaciones?.length ? 'Reconociendo las columnas otra vez…' : 'Leyendo el archivo y reconociendo sus columnas…')
    setHecho(null)
    const form = new FormData()
    form.append('archivo', file)
    if (opciones.mapa) form.append('mapa', JSON.stringify(opciones.mapa))
    else form.append('instrucciones', (opciones.indicaciones ?? []).join('\n'))
    try {
      setRes(await api('/importar/ia', { form }))
      if (!opciones.mapa) { setPedidos(opciones.indicaciones ?? []); setCambios('') }
      return true
    } catch (e) {
      toast((e as Error).message, true)
      return false
    } finally {
      setOcupado('')
    }
  }
  const elegir = async (file?: File) => {
    if (!file) return
    setArchivo(file)
    setRes(null)
    if (!(await acomodar(file, {}))) setArchivo(null)
  }
  /** Cambia una columna del mapeo y vuelve a acomodar aquí mismo, sin IA. */
  const ajustar = (hoja: string, columna: string | null, cambio: object) => {
    if (!archivo) return
    const mapa = res.mapa.map((h: any) => h.hoja !== hoja ? h : columna === null ? { ...h, ...cambio }
      : { ...h, columnas: h.columnas.map((c: any) => (c.columna === columna ? { ...c, ...cambio } : c)) })
    const previo = res
    setRes({ ...res, mapa })
    // Si falla, se regresa al mapeo anterior para que la lista no muestre un ajuste que la vista previa no refleja.
    void acomodar(archivo, { mapa }).then(ok => { if (!ok) setRes(previo) })
  }
  const importar = async () => {
    if (importando.current) return
    importando.current = true
    setOcupado('Importando…')
    try {
      const r = await api('/importar/aplicar', { body: { filas: res.filas } })
      setHecho(r.resultado)
      setRes(null)
      setArchivo(null)
      setPedidos([])
    } catch (e) {
      toast((e as Error).message, true)
    }
    importando.current = false
    setOcupado('')
  }
  const r = res?.plan.resumen
  // Dos columnas que se usan como el mismo dato de la misma persona: solo cuenta la primera que traiga valor.
  const repetidos: string[] = []
  for (const h of res?.mapa ?? []) {
    if (!h.usar) continue
    const vistos = new Set<string>()
    for (const c of h.columnas) {
      if (['ignorar', 'integrantes_lista', 'respuesta'].includes(c.campo)) continue
      const clave = `${c.campo}|${DE_PERSONA.includes(c.campo) ? c.persona : 1}`
      if (vistos.has(clave) && !repetidos.includes(c.campo)) repetidos.push(c.campo)
      vistos.add(clave)
    }
  }
  const total = r ? r.solicitudes + r.equipos_existentes : 0
  // Primero lo que tiene problema, para que no se pierda entre muchas solicitudes.
  const equipos = [...(res?.plan.equipos ?? [])].sort((a: any, b: any) => Number(a.importable) - Number(b.importable))

  return (
    <Page titulo="Importar datos" eyebrow="Solicitudes desde tu Excel; las columnas se acomodan solas"
      acciones={<a className="btn" href={`${API_URL}/importar/plantilla`}><Download size={14} /> Plantilla (opcional)</a>}>
      {hecho && (
        <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl bg-ink px-5 py-4 text-white">
          <CheckCircle2 size={28} className="text-spark" />
          <div className="flex-1">
            <p className="font-display text-lg font-bold">Importación terminada</p>
            <p className="text-sm text-white/65">
              {hecho.solicitudes} solicitud(es) por revisar y {hecho.personas} persona(s). Acéptalas desde Solicitudes. No se envió ningún correo.
            </p>
          </div>
          {hecho.solicitudes > 0 && <Link to="/solicitudes" className="btn btn-spark">Ver solicitudes</Link>}
        </div>
      )}

      <div className="space-y-5">
        <Card>
          <input ref={input} type="file" className="hidden" accept=".csv,.xlsx,.xlsm,.txt,.tsv" onChange={e => { void elegir(e.target.files?.[0]); e.target.value = '' }} />
          <button onClick={() => input.current?.click()} disabled={!!ocupado}
            onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!ocupado) void elegir(e.dataTransfer.files?.[0]) }}
            className={`flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-brand-400/60 bg-brand-50/50 px-6 text-center transition hover:bg-brand-50 disabled:cursor-wait ${res ? 'py-5' : 'py-10'}`}>
            {ocupado ? <Sparkles size={28} className="animate-pulse text-brand" /> : archivo ? <FileSpreadsheet size={28} className="text-brand" /> : <Upload size={28} className="text-brand" />}
            <span className="font-display text-xl font-bold">{ocupado || (archivo ? archivo.name : 'Elige o arrastra tu archivo')}</span>
            <span className="text-sm text-mute">{archivo ? 'Toca para cambiar de archivo' : 'Excel (.xlsx) o CSV, en el formato que ya tengas'}</span>
          </button>
          <p className="mt-3 text-xs text-mute">
            Nada se guarda hasta que aceptes. <b>Tus datos no salen de aquí:</b> para reconocer las columnas, a la IA solo se le mandan los títulos de las columnas, nunca los nombres ni los correos.
            {estado && !estado.ia && <b className="text-amber-800"> El reconocimiento con IA está apagado (falta OPENAI_API_KEY en backend/.env): se reconocen las columnas con nombres comunes y el resto se ajusta a mano.</b>}
          </p>
        </Card>

        {res && (
          <>
            <Card titulo={<span className="flex items-center gap-2"><Sparkles size={16} className="text-brand" /> 1 · Así se entendieron tus columnas</span>}
              extra={<Chip tono={res.modo === 'ia' ? 'azul' : 'gris'}>{MODO[res.modo]}{res.modo === 'ia' && estado?.modelo ? ` · ${estado.modelo}` : ''}</Chip>}>
              {res.notas.length > 0 && <ul className="mb-4 space-y-1 text-sm text-mute">{res.notas.map((n: string) => <li key={n} className="flex gap-2"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" />{n}</li>)}</ul>}
              {res.mapa.map((h: any) => (
                <div key={h.hoja} className="mb-4 last:mb-0">
                  {res.mapa.length > 1 && (
                    <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <input type="checkbox" className="size-4 accent-brand" checked={h.usar} disabled={!!ocupado} onChange={e => ajustar(h.hoja, null, { usar: e.target.checked })} />
                      Hoja «{h.hoja}» <span className="font-normal text-mute">· {h.filas} filas{!h.usar && ' · no se usa'}</span>
                    </label>
                  )}
                  {h.usar && (
                    <div className="overflow-x-auto rounded-xl border border-line">
                      <table className="w-full text-sm">
                        <thead><tr className="bg-slate-50"><th className="th">Columna de tu archivo</th><th className="th">Ejemplo</th><th className="th">Se usa como</th><th className="th">Persona</th></tr></thead>
                        <tbody>
                          {h.columnas.map((c: any) => {
                            const persona = DE_PERSONA.includes(c.campo)
                            return (
                              <tr key={c.columna} className={`border-t border-line ${c.campo === 'ignorar' ? 'text-mute' : ''}`}>
                                <td className="td font-semibold">{c.columna}</td>
                                <td className="td max-w-56 truncate text-mute">{c.ejemplo || '—'}</td>
                                <td className="td">
                                  <select className={`input !w-60 !py-1.5 ${c.campo === 'ignorar' ? 'text-mute' : 'font-semibold'}`} value={c.campo} disabled={!!ocupado}
                                    aria-label={`Campo para la columna ${c.columna}`} onChange={e => ajustar(h.hoja, c.columna, { campo: e.target.value })}>
                                    {CAMPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                  </select>
                                </td>
                                <td className="td">
                                  {persona && (
                                    <span className="flex items-center gap-3">
                                      <input type="number" min={1} max={30} className="input !w-16 !py-1.5 font-mono" value={c.persona} disabled={!!ocupado}
                                        title="Si en una misma fila vienen varias personas, cada una lleva su número" aria-label="Número de persona en la fila"
                                        onChange={e => ajustar(h.hoja, c.columna, { persona: Number(e.target.value) || 1 })} />
                                      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="size-4 accent-brand" checked={c.es_lider} disabled={!!ocupado}
                                        onChange={e => ajustar(h.hoja, c.columna, { es_lider: e.target.checked })} /> es el líder</label>
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
              {repetidos.length > 0 && (
                <p className="mt-3 flex items-start gap-1.5 text-sm text-amber-800"><TriangleAlert size={14} className="mt-0.5 shrink-0" />
                  Hay varias columnas usadas como «{repetidos.map(c => CAMPOS.find(x => x[0] === c)?.[1] ?? c).join('», «')}»: solo se toma la primera que traiga valor. Revisa si una debe ser «No usar» o de otra persona.
                </p>
              )}
              <p className="mt-3 text-xs text-mute">Si algo quedó mal, cámbialo en la lista: se vuelve a acomodar al instante y sin usar IA. «Persona» solo importa cuando una fila trae a varias personas en columnas distintas.</p>

              {estado?.ia && (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="label">O dile a la IA cómo leer las columnas</p>
                  {pedidos.length > 0 && <ul className="mb-2 list-disc pl-5 text-[13px] text-mute">{pedidos.map(p => <li key={p}>{p}</li>)}</ul>}
                  <div className="flex flex-wrap gap-2">
                    <input className="input min-w-64 flex-1" value={cambios} onChange={e => setCambios(e.target.value)}
                      placeholder="Ej.: «Mesa es el número de espacio», «Tutor no es integrante», «ignora la hoja Bajas»" />
                    <button className="btn" disabled={!!ocupado || !cambios.trim() || !archivo} onClick={() => archivo && acomodar(archivo, { indicaciones: [...pedidos, cambios.trim()] })}><RotateCcw size={14} /> Volver a intentar</button>
                    {(pedidos.length > 0 || res.modo === 'manual') && <button className="btn btn-ghost text-mute" disabled={!!ocupado || !archivo} onClick={() => archivo && acomodar(archivo, {})}>Empezar de cero</button>}
                  </div>
                </div>
              )}
            </Card>

            <div className="card flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
              <h2 className="w-full text-[15px] font-bold">2 · Vista previa de lo que se va a importar</h2>
              {([['Solicitudes por revisar', r.solicitudes], ['Equipos que ya existían', r.equipos_existentes],
                ['Personas a crear', r.personas], ['Ya registrados o repetidos', r.duplicados], ['Con problema', r.filas_con_problema]] as [string, number][])
                .filter(([l, v]) => v > 0 || ['Solicitudes por revisar', 'Personas a crear', 'Con problema'].includes(l)).map(([l, v]) => (
                  <div key={l}><p className="eyebrow">{l}</p><p className={`font-display text-3xl font-extrabold leading-none ${l === 'Con problema' && v ? 'text-red-600' : l === 'Ya registrados o repetidos' ? 'text-mute' : ''}`}>{v}</p></div>
                ))}
              <span className="flex-1" />
              <button className="btn btn-primary !px-4 !py-2.5 !text-sm" disabled={!!ocupado || !r.personas}
                onClick={() => confirm(`Se crearán ${r.solicitudes} solicitud(es) por revisar y ${r.personas} persona(s). No se enviará ningún correo. ¿Continuar?`) && importar()}>
                Importar {total} equipo{total === 1 ? '' : 's'} y {r.personas} persona{r.personas === 1 ? '' : 's'}
              </button>
              <p className="w-full text-sm text-mute">
                Todos los equipos nuevos entran a <b className="text-ink">Solicitudes</b> como «Por revisar» y desde ahí se aceptan (y se les asigna espacio). Si el archivo trae estado, decisión o espacio, queda anotado en la solicitud como referencia.
                {r.filas_con_problema > 0 && ' Lo marcado en rojo no se importa; lo demás sí.'} Lo que ya está registrado se ignora: puedes volver a subir el mismo archivo sin duplicar nada.
              </p>
            </div>

            {res.plan.duplicados.length > 0 && (
              <details className="card group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-5 text-[15px] font-bold">
                  <ChevronRight size={16} className="transition group-open:rotate-90" />
                  Ya registrados o repetidos <Chip>{res.plan.duplicados.length}</Chip>
                  <span className="text-sm font-normal text-mute">· se ignoran, no hace falta hacer nada</span>
                </summary>
                <div className="max-h-96 overflow-y-auto border-t border-line">
                  <table className="w-full text-sm">
                    <tbody>
                      {res.plan.duplicados.map((d: any, i: number) => (
                        <tr key={i} className="border-t border-line first:border-0">
                          <td className="td"><span className="font-semibold">{d.nombre || '—'}</span><p className="text-xs text-mute">{d.correo || 'sin correo'}</p></td>
                          <td className="td text-mute">{d.equipo}</td>
                          <td className="td text-[13px] text-mute">{d.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <div className="grid gap-5 xl:grid-cols-2">
              {equipos.map((e: any) => (
                <Card key={e.nombre} pad={false}
                  titulo={<span className="flex flex-wrap items-center gap-2">{e.nombre}<Estado estado={e.estado} />{e.espacio && <Chip tono="tinta">Espacio {e.espacio}</Chip>}{e.existe && <Chip tono="azul">ya existe</Chip>}</span>}
                  extra={e.importable ? <Chip tono={ALTA[e.alta]?.[1] ?? 'verde'}>{ALTA[e.alta]?.[0] ?? 'Se importa'}</Chip> : <Chip tono="rojo">No se importa</Chip>}>
                  <div className="space-y-1 px-5 pb-2 text-[13px]">
                    {(e.fecha_ingreso || e.sector || e.etapa) && <p className="text-mute">{[e.fecha_ingreso && `Fecha: ${fecha(e.fecha_ingreso)}`, e.sector, e.etapa].filter(Boolean).join(' · ')}</p>}
                    {e.descripcion && <p className="line-clamp-2 text-mute">{e.descripcion}</p>}
                    {e.respuestas?.length > 0 && <p className="text-xs text-mute">{e.respuestas.length} respuesta(s) del formulario se guardan en la solicitud.</p>}
                    {e.errores.map((x: string) => <p key={x} className="flex items-start gap-1.5 text-red-700"><TriangleAlert size={14} className="mt-0.5 shrink-0" />{x}</p>)}
                    {e.avisos.map((x: string) => <p key={x} className="text-amber-800">{x}</p>)}
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {e.integrantes.map((p: any) => (
                        <tr key={p.fila} className={`border-t border-line ${p.ok ? '' : 'bg-red-50/60'}`}>
                          <td className="td"><span className="font-semibold">{p.nombre || '—'}</span> {p.lider && <Chip tono="lima">Líder</Chip>}<p className="text-xs text-mute">{p.correo || 'sin correo'}</p></td>
                          <td className="td text-mute">{p.tipo}{p.matricula && <span className="mono block">{p.matricula}</span>}</td>
                          <td className="td text-[13px]">
                            {!p.ok ? <span className="font-semibold text-red-700">{p.nota}</span>
                              : p.nota ? <span className="text-amber-800">{p.nota}</span>
                              : EN_OPERACION.includes(e.estado)
                                ? (p.acceso_vence ? <span className="text-mute">acceso hasta {fecha(p.acceso_vence)}</span> : <span className="text-amber-800">acceso pendiente</span>) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ))}
            </div>
          </>
        )}

        {!res && (
          <Card titulo="Qué necesita traer tu archivo">
            <div className="grid gap-4 text-[13px] text-mute md:grid-cols-3">
              <p><b className="text-ink">Lo mínimo por persona:</b> equipo o proyecto, nombre y correo. Lo demás es opcional: tipo (alumno, colaborador, Exatec o externo), matrícula, etapa, descripción, si ya fue aceptado, espacio y vencimiento del acceso. Las demás preguntas de tu formulario se guardan en la solicitud.</p>
              <p><b className="text-ink">Cualquier acomodo sirve:</b> la exportación de tu formulario, una fila por persona, una por equipo con los demás integrantes en una celda, títulos arriba, varias hojas.</p>
              <p><b className="text-ink">Entra como solicitud:</b> cada equipo nuevo queda en Solicitudes como «Por revisar» para aceptarlo desde ahí; si el archivo trae estado, decisión o espacio, se anota como referencia. Lo que ya está registrado o viene repetido se ignora. No se envía ningún correo.</p>
            </div>
          </Card>
        )}
      </div>
    </Page>
  )
}
