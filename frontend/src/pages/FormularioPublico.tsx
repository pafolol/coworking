import { ArrowRight, Check } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'

import { api, useApi } from '../api'
import { Campo } from '../ui'
import { agregarRespuestas, type CampoForm, CampoRespuesta, faltante, type Valor } from './campos'
import { Bloque, Marco } from './Publico'

/** Formulario hecho en el editor. Con el enlace personal (?t=) ya se sabe quién responde; si es abierto, se pide nombre y correo. */
export function FormPropio() {
  const { slug } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const { data: f, error: errorCarga } = useApi(`/public/forma/${slug}${token ? `?t=${encodeURIComponent(token)}` : ''}`)
  const [valores, setValores] = useState<Record<string, Valor>>({})
  const [quien, setQuien] = useState({ nombre: '', correo: '' })
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [hecho, setHecho] = useState('')

  if (!f) {
    return <div className="grid min-h-screen place-items-center p-6 text-center text-sm text-mute">{errorCarga ? <p className="max-w-sm text-red-700">{errorCarga}</p> : 'Cargando…'}</div>
  }
  const campos: CampoForm[] = f.campos
  const color: string | undefined = f.color || undefined
  if (hecho || f.respondido) {
    return (
      <Marco nombre={f.coworking} titulo={f.titulo} color={color}>
        <Bloque titulo={hecho ? '¡Listo!' : 'Ya respondiste este formulario'}>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-spark text-ink"><Check size={20} strokeWidth={3} /></span>
            <p className="whitespace-pre-line text-sm text-mute">{hecho || 'Tus respuestas ya están registradas. Si necesitas corregir algo, escríbenos.'}</p>
          </div>
        </Bloque>
      </Marco>
    )
  }
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (enviando) return
    const falta = faltante(campos, valores)
    if (falta) return setError(falta)
    setError('')
    setEnviando(true)
    const form = new FormData()
    if (token) form.append('t', token)
    const respuestas = agregarRespuestas(form, valores)
    form.append('datos', JSON.stringify({ respuestas, ...(f.personal ? {} : { nombre: quien.nombre.trim(), correo: quien.correo.trim() }) }))
    try {
      const r = await api(`/public/forma/${slug}`, { form })
      setHecho(r.mensaje || '¡Gracias! Recibimos tus respuestas.')
      window.scrollTo(0, 0)
    } catch (err) {
      setError((err as Error).message)  // se conserva todo lo capturado para corregir y reenviar
    }
    setEnviando(false)
  }
  const sugerido = f.persona?.nombre || quien.nombre
  return (
    <Marco nombre={f.coworking} titulo={f.titulo} intro={f.intro} color={color}>
      <form onSubmit={enviar}>
        {f.persona && (
          <p className="mb-4 rounded-xl bg-white px-4 py-3 text-sm shadow-card">
            Respondes como <b>{f.persona.nombre || f.persona.correo}</b>{f.persona.nombre && <span className="text-mute"> · {f.persona.correo}</span>}{f.persona.equipo && <span className="text-mute"> · {f.persona.equipo}</span>}
          </p>
        )}
        <section className="card mb-4 space-y-4 p-5 sm:p-6">
          {!f.personal && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Tu nombre completo"><input required className="input" autoComplete="name" value={quien.nombre} onChange={e => setQuien({ ...quien, nombre: e.target.value })} /></Campo>
              <Campo label="Tu correo"><input required type="email" inputMode="email" autoCapitalize="none" autoComplete="email" className="input" value={quien.correo} onChange={e => setQuien({ ...quien, correo: e.target.value })} /></Campo>
            </div>
          )}
          {campos.map(q => <CampoRespuesta key={q.id} q={q} valor={valores[q.id]} sugerido={sugerido} onChange={v => setValores(prev => ({ ...prev, [q.id]: v }))} />)}
        </section>
        {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button className="btn btn-primary w-full !py-3 !text-base" style={color ? { backgroundColor: color, borderColor: color } : undefined} disabled={enviando}>
          {enviando ? 'Enviando…' : f.boton || 'Enviar'} <ArrowRight size={16} />
        </button>
      </form>
    </Marco>
  )
}
