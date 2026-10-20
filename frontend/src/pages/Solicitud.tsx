import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'

import { api, useApi } from '../api'
import { Campo, Chip } from '../ui'
import { Archivo, Bloque, Carta, Marco, Pregunta } from './Publico'

const NUEVO = { nombre: '', correo: '', externo: false, tipo: 'Alumno', matricula: '' }

/** Formulario de solicitud: internos solo dan su matrícula; a los externos se les pide identificación. */
export function FormSolicitud() {
  const { data: info, error: errInfo, reload } = useApi('/public/info')
  const [f, setF] = useState({ nombre: '', descripcion: '', etapa: 'Idea', sector: '' })
  const [gente, setGente] = useState([{ ...NUEVO }])
  const [ids, setIds] = useState<Record<number, File | undefined>>({})
  const [carta, setCarta] = useState({ acepta: false, nombre: '' })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState<any>(null)
  const [extra, setExtra] = useState<Record<string, string | boolean>>({})
  if (!info) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center text-sm text-mute">
        {errInfo ? (
          <div>
            <p className="mb-3 text-red-700">{errInfo}</p>
            <button className="btn" onClick={() => void reload()}>Reintentar</button>
          </div>
        ) : 'Cargando…'}
      </div>
    )
  }
  const cf = info.formularios.solicitud
  const etapas: string[] = cf.etapas?.length ? cf.etapas : ['Idea']
  const dominios: string[] = info.dominios ?? []
  const dominio: string = dominios[0] ?? ''
  const listaDominios = dominios.map(d => `@${d}`).join(' o ')
  // Igual que el servidor: vale el dominio exacto o cualquier subdominio, de cualquiera de los dominios configurados.
  const fueraDeDominio = (p: typeof NUEVO) => {
    if (p.externo || !dominios.length || !p.correo.includes('@')) return false
    const host = p.correo.trim().toLowerCase().split('@').pop() ?? ''
    return !dominios.some(d => host === d || host.endsWith(`.${d}`))
  }
  const persona = (i: number, cambios: object) => setGente(gente.map((p, j) => (j === i ? { ...p, ...cambios } : p)))
  const quitar = (i: number) => {
    setGente(gente.filter((_, j) => j !== i))
    // Los archivos van por posición: se recorren junto con la lista.
    setIds(Object.fromEntries(Object.entries(ids).filter(([k]) => Number(k) !== i).map(([k, v]) => [Number(k) > i ? Number(k) - 1 : Number(k), v])))
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (enviando) return
    setError('')
    if (gente.some(fueraDeDominio)) return setError(`Los alumnos y colaboradores deben registrarse con su correo ${listaDominios}. Corrige los correos marcados o marca «Es externo».`)
    if (!carta.acepta || !carta.nombre.trim()) return setError('Para enviar la solicitud hay que leer y aceptar la carta compromiso, y escribir el nombre de quien la acepta.')
    setEnviando(true)
    const form = new FormData()
    form.append('datos', JSON.stringify({
      ...f, nombre: f.nombre.trim(), etapa: etapas.includes(f.etapa) ? f.etapa : etapas[0], carta, respuestas: extra,
      integrantes: gente.map(p => ({ nombre: p.nombre.trim(), correo: p.correo.trim(), tipo: p.externo ? 'Externo' : p.tipo, matricula: p.matricula.trim() })),
    }))
    gente.forEach((p, i) => { if (p.externo && ids[i]) form.append(`archivo:identificacion:${i}`, ids[i]!) })
    try {
      setHecho(await api('/public/solicitud', { form }))
      window.scrollTo(0, 0)
    } catch (err) {
      setError((err as Error).message)  // el formulario conserva todo lo capturado para corregir y reenviar
    }
    setEnviando(false)
  }

  if (hecho) {
    return (
      <Marco nombre={info.nombre} titulo="¡Solicitud recibida!">
        <Bloque titulo="Guarda tu folio">
          <p className="mb-3 text-sm text-mute">Lo necesitas para subir documentos o pedir cambios. Toma una captura de pantalla o cópialo.</p>
          <p className="rounded-2xl bg-ink py-6 text-center font-mono text-4xl font-semibold tracking-wider text-spark">{hecho.folio}</p>
          <p className="mt-4 text-sm text-mute">{cf.mensaje_final} Plazo: máximo {info.dias_decision} días hábiles.</p>
          {hecho.faltantes.length > 0 && (
            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              <b>Tu solicitud queda en pausa hasta recibir:</b>
              <ul className="mt-1 list-disc pl-5">{hecho.faltantes.map((x: string) => <li key={x}>{x}</li>)}</ul>
              <a className="btn mt-3" href={`/f/cambios?folio=${hecho.folio}`}>Subirlo ahora <ArrowRight size={14} /></a>
            </div>
          )}
        </Bloque>
      </Marco>
    )
  }

  return (
    <Marco nombre={info.nombre} titulo={cf.titulo} intro={cf.intro}>
      <form onSubmit={enviar}>
        <Bloque n="1" titulo="El proyecto">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Campo label="Nombre del equipo o proyecto"><input required className="input" value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} /></Campo></div>
            <div className="sm:col-span-2"><Campo label={cf.pregunta_descripcion}><textarea required className="input min-h-28" value={f.descripcion} onChange={e => setF({ ...f, descripcion: e.target.value })} /></Campo></div>
            <Campo label="Etapa"><select className="input" value={f.etapa} onChange={e => setF({ ...f, etapa: e.target.value })}>{etapas.map(x => <option key={x}>{x}</option>)}</select></Campo>
            {cf.pedir_sector && <Campo label="Sector"><input className="input" placeholder="Fintech, salud, educación…" value={f.sector} onChange={e => setF({ ...f, sector: e.target.value })} /></Campo>}
            {(cf.preguntas ?? []).map((q: any) => (
              <div key={q.id} className={q.tipo === 'parrafo' || q.tipo === 'casilla' ? 'sm:col-span-2' : ''}>
                <Pregunta q={q} valor={extra[q.id]} onChange={v => setExtra({ ...extra, [q.id]: v })} />
              </div>
            ))}
          </div>
        </Bloque>

        <Bloque n="2" titulo="Integrantes">
          <p className="-mt-2 mb-4 text-sm text-mute">Alumnos y colaboradores se registran con su correo{dominio && <> <b className="text-ink">{listaDominios}</b></>} y su matrícula o nómina. Si alguien es externo, márcalo y sube su identificación. Todos los campos son obligatorios, salvo los que dicen «opcional».</p>
          <div className="space-y-3">
            {gente.map((p, i) => (
              <div key={i} className={`rounded-xl border p-3 ${p.externo ? 'border-amber-300 bg-amber-50/40' : 'border-line'}`}>
                <div className="mb-2 flex items-center justify-between">
                  {i === 0 ? <Chip tono="lima">Líder del equipo</Chip> : <span className="eyebrow">Integrante {i + 1}</span>}
                  <div className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                      <input type="checkbox" className="size-5 accent-brand" checked={p.externo} onChange={e => persona(i, { externo: e.target.checked, matricula: '' })} />
                      Es externo
                    </label>
                    {i > 0 && <button type="button" aria-label={`Quitar al integrante ${i + 1}`} title="Quitar integrante" className="btn btn-ghost !p-2 text-mute" onClick={() => quitar(i)}><Trash2 size={16} /></button>}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input required className="input" aria-label={`Nombre completo${i === 0 ? ' del líder' : ` del integrante ${i + 1}`}`} autoComplete={i === 0 ? 'name' : 'off'} placeholder="Nombre completo" value={p.nombre} onChange={e => persona(i, { nombre: e.target.value })} />
                  <div>
                    <input required type="email" inputMode="email" autoCapitalize="none" spellCheck={false} aria-invalid={fueraDeDominio(p)} className={`input ${fueraDeDominio(p) ? '!border-red-400' : ''}`} aria-label={`Correo${i === 0 ? ' del líder' : ` del integrante ${i + 1}`}`} autoComplete={i === 0 ? 'email' : 'off'}
                      placeholder={p.externo || !dominio ? 'Correo' : `Correo ${listaDominios}`} value={p.correo} onChange={e => persona(i, { correo: e.target.value })} />
                    {fueraDeDominio(p) && <p className="mt-1 text-xs text-red-700">Debe ser su correo {listaDominios}. Si no pertenece a la institución, marca «Es externo».</p>}
                  </div>
                  {p.externo ? (
                    <>
                      <input className="input" aria-label="Organización o empresa (opcional)" placeholder="Organización o empresa (opcional)" value={p.matricula} onChange={e => persona(i, { matricula: e.target.value })} />
                      <Archivo label="Identificación oficial" sub="INE o pasaporte · PDF o imagen" file={ids[i]} onChange={file => setIds({ ...ids, [i]: file })} />
                    </>
                  ) : (
                    <>
                      <select className="input" aria-label={`Tipo de integrante ${i + 1}`} value={p.tipo} onChange={e => persona(i, { tipo: e.target.value })}><option>Alumno</option><option>Colaborador</option></select>
                      <input required className="input" aria-label={`Matrícula o nómina del integrante ${i + 1}`} autoCapitalize="characters" autoComplete="off" placeholder={p.tipo === 'Alumno' ? 'Matrícula' : 'Número de nómina'} value={p.matricula} onChange={e => persona(i, { matricula: e.target.value })} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="btn mt-3" onClick={() => setGente([...gente, { ...NUEVO }])}><Plus size={14} /> Agregar integrante</button>
          <p className="mt-2 text-xs text-mute">El correo de cada integrante es el que usará para hacer check-in con el QR.</p>
        </Bloque>

        <Bloque n="3" titulo="Carta compromiso">
          <Carta texto={info.carta} valor={carta} onChange={setCarta} sugerido={gente[0].nombre} />
        </Bloque>

        {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button className="btn btn-primary w-full !py-3 !text-base" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar solicitud'} <ArrowRight size={16} /></button>
      </form>
    </Marco>
  )
}
