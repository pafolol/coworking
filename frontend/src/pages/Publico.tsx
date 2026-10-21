import { ArrowRight, Check, Plus, Upload } from 'lucide-react'
import { type FormEvent, type ReactNode, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api, fecha, useApi } from '../api'
import { Campo, Chip, Estado, Estatus, Logo } from '../ui'

export function Marco({ titulo, intro, children, nombre, color }: { titulo: string; intro?: ReactNode; children: ReactNode; nombre?: string; color?: string }) {
  return (
    <div className="grid-bg-light min-h-screen pb-16">
      <header className="grid-bg bg-ink px-5 pb-24 pt-6 text-white" style={color ? { backgroundColor: color } : undefined}>
        <div className="mx-auto max-w-2xl">
          <Logo nombre={nombre} claro />
          <h1 className="mt-8 animate-rise text-4xl font-extrabold leading-none sm:text-5xl">{titulo}</h1>
          {intro && <div className="mt-3 max-w-xl animate-rise whitespace-pre-line text-[15px] leading-relaxed text-white/75">{intro}</div>}
        </div>
      </header>
      <main className="mx-auto -mt-14 max-w-2xl animate-rise px-4">{children}</main>
    </div>
  )
}

export const Bloque = ({ n, titulo, children }: { n?: string; titulo: string; children: ReactNode }) => (
  <section className="card mb-4 p-5 sm:p-6">
    <h2 className="mb-4 flex items-center gap-2.5 text-lg font-bold">{n && <span className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-xs text-white">{n}</span>}{titulo}</h2>
    {children}
  </section>
)

const MAX_MB = 10

export function Archivo({ label, sub, file, onChange }: { label: string; sub?: string; file?: File; onChange: (f?: File) => void }) {
  const [problema, setProblema] = useState('')
  return (
    <div>
      <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition focus-within:ring-4 focus-within:ring-brand-100 ${file ? 'border-brand bg-brand-50' : 'border-dashed border-line hover:border-brand-400'}`}>
        <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${file ? 'bg-brand text-white' : 'bg-slate-100 text-mute'}`}>{file ? <Check size={16} /> : <Upload size={16} />}</span>
        <span className="min-w-0 flex-1"><b className="block text-sm font-semibold leading-tight">{label}</b><span className="block truncate text-xs text-mute">{file ? file.name : sub ?? `PDF o imagen, máx. ${MAX_MB} MB`}</span></span>
        <input type="file" className="sr-only" accept=".pdf,image/*" onChange={e => {
          const f = e.target.files?.[0]
          if (f && f.size > MAX_MB * 1024 * 1024) {
            e.target.value = ''
            return setProblema(`«${f.name}» pesa más de ${MAX_MB} MB. Elige un archivo más ligero.`)
          }
          setProblema('')
          if (f || !file) onChange(f)  // cancelar el selector no borra el archivo ya elegido
        }} />
      </label>
      {problema && <p role="alert" className="mt-1 text-xs text-red-700">{problema}</p>}
    </div>
  )
}

const VACIO = { nombre: '', correo: '', tipo: 'Alumno', matricula: '' }

/** Carta compromiso: se lee, se acepta y se escribe el nombre. No se sube ningún archivo. */
export function Carta({ texto, valor, onChange, sugerido }: { texto: string; valor: { acepta: boolean; nombre: string }; onChange: (v: { acepta: boolean; nombre: string }) => void; sugerido?: string }) {
  return (
    <div>
      <div className="max-h-60 overflow-y-auto whitespace-pre-line rounded-xl border border-line bg-slate-50 p-4 text-[13px] leading-relaxed text-ink/80">{texto}</div>
      <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${valor.acepta ? 'border-brand bg-brand-50' : 'border-line hover:border-brand-400'}`}>
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand" checked={valor.acepta}
          onChange={e => onChange({ acepta: e.target.checked, nombre: valor.nombre || (e.target.checked ? sugerido ?? '' : '') })} />
        <span className="text-sm"><b className="font-semibold">He leído y acepto</b> la carta compromiso y el reglamento, a nombre de mi equipo.</span>
      </label>
      <div className="mt-3"><Campo label="Nombre completo de quien acepta" ayuda="Vale como firma; no hay que subir ningún archivo.">
        <input className="input" autoComplete="name" placeholder={sugerido || 'Nombre y apellidos'} value={valor.nombre} onChange={e => onChange({ ...valor, nombre: e.target.value })} />
      </Campo></div>
    </div>
  )
}

// ---------- Check-in por QR ----------

export function FormCheckin() {
  const { data: info } = useApi('/public/info')
  const [params] = useSearchParams()
  const [correo, setCorreo] = useState(() => { try { return localStorage.getItem('cw_correo') ?? '' } catch { return '' } })
  const [res, setRes] = useState<any>(null)
  const [cargando, setCargando] = useState(false)
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (cargando) return
    setCargando(true)
    const limpio = correo.trim()
    try {
      const r = await api('/public/checkin', { body: { correo: limpio, k: params.get('k') } })
      if (r.ok) { try { localStorage.setItem('cw_correo', limpio) } catch { /* sin almacenamiento: no pasa nada */ } }
      setRes(r)
    } catch (err) {
      setRes({ ok: false, mensaje: (err as Error).message })
    }
    setCargando(false)
  }
  return (
    <main className="grid-bg flex min-h-screen flex-col items-center justify-center bg-ink p-5 text-white" style={info?.formularios.checkin.color ? { backgroundColor: info.formularios.checkin.color } : undefined}>
      <div className="w-full max-w-sm animate-rise">
        <Logo nombre={info?.nombre} claro />
        {!res?.ok ? (
          <form onSubmit={enviar} className="mt-10">
            <h1 className="text-4xl font-extrabold leading-[0.95] sm:text-5xl">{info?.formularios.checkin.titulo ?? 'Check-in'}<span className="text-spark">.</span></h1>
            <p className="mt-3 text-white/70">{info?.formularios.checkin.intro}</p>
            <input required type="email" autoFocus={!correo} autoCapitalize="none" spellCheck={false} inputMode="email" autoComplete="email" aria-label="Tu correo" placeholder="tu@correo.com" value={correo} onChange={e => setCorreo(e.target.value)}
              className="mt-6 w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3.5 text-lg outline-none placeholder:text-white/50 focus:border-spark focus:ring-4 focus:ring-spark/30" />
            {res && <p role="alert" className="mt-3 rounded-xl bg-red-500/25 px-4 py-3 text-sm text-red-50">{res.mensaje}</p>}
            <button disabled={cargando} className="btn btn-spark mt-4 w-full !py-3.5 !text-base">{cargando ? 'Registrando…' : info?.formularios.checkin.boton ?? 'Registrar mi visita'}</button>
          </form>
        ) : (
          <div className="mt-10 animate-pop" role="status">
            <span className="grid size-16 place-items-center rounded-2xl bg-spark text-ink"><Check size={34} strokeWidth={3} /></span>
            <h1 className="mt-5 text-4xl font-extrabold leading-none">¡Listo, {res.nombre}!</h1>
            <p className="mt-2 text-white/70">{res.ya_registrado ? 'Ya habías hecho check-in hoy; no hace falta repetirlo. Equipo:' : res.repetido ? 'Tu equipo ya tenía su visita de hoy; el día cuenta una sola vez. Equipo:' : 'Hoy ya cuenta como visita para'} <b className="text-white">{res.equipo}</b>.</p>
            <div className="mt-6 rounded-2xl bg-white/10 p-4">
              <p className="eyebrow !text-white/50">Esta semana</p>
              <div className="mt-2 flex items-end gap-2">
                <span className="font-display text-5xl font-extrabold leading-none">{res.dias_semana}</span>
                <span className="pb-1 text-white/60">de {res.minimo} visitas {res.espacio ? `para conservar el espacio ${res.espacio}` : 'para aspirar a un espacio fijo'}</span>
              </div>
              <div className="mt-3 flex gap-1.5">{Array.from({ length: Math.max(res.minimo, res.dias_semana) }, (_, i) => <i key={i} className={`h-2 flex-1 rounded-full ${i < res.dias_semana ? 'bg-spark' : 'bg-white/15'}`} />)}</div>
            </div>
            <button className="btn mt-4 w-full border-white/20 bg-transparent !py-3 text-white hover:border-spark hover:text-spark" onClick={() => { setRes(null); setCorreo('') }}>Registrar a otra persona</button>
          </div>
        )}
      </div>
    </main>
  )
}

// ---------- Formulario de cambios ----------

export function FormCambios() {
  const { data: info } = useApi('/public/info')
  const [params] = useSearchParams()
  const [acceso, setAcceso] = useState({ folio: params.get('folio') ?? '', correo: '' })
  const [eq, setEq] = useState<any>(null)
  const [aviso, setAviso] = useState<{ texto: string; error?: boolean } | null>(null)
  const [nuevo, setNuevo] = useState({ ...VACIO })
  const [files, setFiles] = useState<Record<string, File | undefined>>({})
  const [pausa, setPausa] = useState({ semanas: 1, motivo: '' })
  const [carta, setCarta] = useState({ acepta: false, nombre: '' })
  const [enviando, setEnviando] = useState(false)
  const [entrando, setEntrando] = useState(false)

  const cargar = async () => setEq(await api(`/public/equipo?folio=${encodeURIComponent(acceso.folio)}&correo=${encodeURIComponent(acceso.correo)}`))
  const entrar = async (e: FormEvent) => {
    e.preventDefault()
    if (entrando) return
    setEntrando(true)
    try { await cargar(); setAviso(null) } catch (err) { setAviso({ texto: (err as Error).message, error: true }) } finally { setEntrando(false) }
  }
  const pedir = async (tipo: string, datos: object, ok: string, archivos?: Record<string, File | undefined>) => {
    if (enviando) return false  // un doble clic no manda el trámite dos veces
    setEnviando(true)
    const form = new FormData()
    form.append('folio', acceso.folio)
    form.append('correo', acceso.correo)
    form.append('tipo', tipo)
    form.append('datos', JSON.stringify(datos))
    for (const [k, file] of Object.entries(archivos ?? {})) if (file) form.append(`archivo:${k}`, file)
    try {
      await api('/public/cambios', { form })
    } catch (err) {
      setAviso({ texto: (err as Error).message, error: true })
      setEnviando(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return false
    }
    // El trámite ya se registró: si falla refrescar, no se presenta como error ni se invita a repetirlo.
    try {
      await cargar()
      setAviso({ texto: ok })
    } catch {
      setAviso({ texto: `${ok} No pudimos actualizar la pantalla: recarga la página para ver los cambios.` })
    }
    setEnviando(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return true
  }
  const nombre = info?.nombre
  const cf = info?.formularios.cambios ?? { titulo: 'Cambios en tu equipo', intro: '', permitir_altas: true, permitir_bajas: true, permitir_pausa: true, color: '' }

  if (!eq) {
    return (
      <Marco nombre={nombre} titulo={cf.titulo} intro={cf.intro} color={cf.color || undefined}>
        <Bloque titulo="Identifica a tu equipo">
          <form onSubmit={entrar} className="grid gap-3 sm:grid-cols-2">
            <Campo label="Folio"><input required className="input font-mono uppercase" placeholder="CW-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={acceso.folio} onChange={e => setAcceso({ ...acceso, folio: e.target.value })} /></Campo>
            <Campo label="Correo del líder"><input required type="email" inputMode="email" autoCapitalize="none" autoComplete="email" className="input" value={acceso.correo} onChange={e => setAcceso({ ...acceso, correo: e.target.value })} /></Campo>
            {aviso && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 sm:col-span-2">{aviso.texto}</p>}
            <button disabled={entrando} className="btn btn-primary !py-2.5 sm:col-span-2">{entrando ? 'Buscando…' : <>Continuar <ArrowRight size={15} /></>}</button>
          </form>
        </Bloque>
      </Marco>
    )
  }
  const sinResolver = eq.documentos.filter((d: any) => ['Faltante', 'Rechazado', 'Vencido'].includes(d.estado))
  const pendientes = sinResolver.filter((d: any) => d.modo !== 'firma')
  const porFirmar = sinResolver.filter((d: any) => d.modo === 'firma')
  const porVencer = eq.documentos.filter((d: any) => d.estado === 'Validado' && d.vencimiento)
  const sinResolverN = sinResolver.length
  const pausaDisponible = Math.max(0, (info?.max_pausa ?? 2) - (eq.pausa_usada ?? 0))
  return (
    <Marco nombre={nombre} color={cf.color || undefined} titulo={eq.nombre} intro={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{eq.folio}</span><Estado estado={eq.estado} /></span>}>
      {aviso && <p role={aviso.error ? 'alert' : 'status'} className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${aviso.error ? 'bg-red-50 text-red-700' : 'bg-spark text-ink'}`}>{aviso.texto}</p>}

      {eq.renovacion_pendiente && (
        <Bloque titulo={`Renovación · ${info?.semestre}`}>
          <p className="text-sm text-mute">Cada semestre se repite el proceso: revisa abajo a tus integrantes, vuelve a aceptar la carta compromiso y confirma tu permanencia{eq.renovacion_limite && <> antes del <b>{fecha(eq.renovacion_limite)}</b></>}. Los equipos que no confirmen pasan a alerta de baja.</p>
          {sinResolverN > 0 && <p className="mt-2 text-sm font-medium text-amber-800">Te falta resolver {sinResolverN} pendiente(s) de abajo antes de confirmar.</p>}
          <button className="btn btn-primary mt-3" disabled={enviando || sinResolverN > 0} onClick={() => pedir('Renovación', {}, 'Permanencia confirmada. ¡Gracias!')}><Check size={15} /> Confirmar permanencia</button>
        </Bloque>
      )}

      {porFirmar.length > 0 && (
        <Bloque titulo="Carta compromiso">
          <Carta texto={info?.carta ?? ''} valor={carta} onChange={setCarta} sugerido={eq.lider} />
          <button className="btn btn-primary mt-3" disabled={enviando || !carta.acepta || !carta.nombre.trim()}
            onClick={() => pedir('Documento', { firmas: Object.fromEntries(porFirmar.map((d: any) => [d.id, carta.nombre])) }, 'Carta compromiso aceptada. ¡Gracias!')}><Check size={15} /> Aceptar carta</button>
        </Bloque>
      )}

      <Bloque titulo={cf.titulo_documentos || 'Identificaciones y otros documentos'}>
        {pendientes.length === 0 ? <p className="text-sm text-mute">No hay archivos pendientes. Solo se pide identificación a los integrantes externos.</p> : (
          <>
            <div className="grid gap-2">
              {pendientes.map((d: any) => <Archivo key={d.id} label={d.nombre} sub={`${d.persona ?? 'Del equipo'} · ${d.estado.toLowerCase()}`} file={files[d.id]} onChange={file => setFiles({ ...files, [d.id]: file })} />)}
            </div>
            <button className="btn btn-primary mt-3" disabled={enviando || !Object.values(files).some(Boolean)}
              onClick={async () => { if (await pedir('Documento', {}, 'Documentos recibidos; los validaremos pronto.', files)) setFiles({}) }}>Subir documentos</button>
          </>
        )}
        {porVencer.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
            {porVencer.map((d: any) => <li key={d.id} className="flex items-center justify-between gap-2 text-sm"><span>{d.nombre}{d.persona && <span className="text-mute"> · {d.persona}</span>}</span><span className="flex items-center gap-2 text-xs text-mute">{d.firma && `aceptada por ${d.firma} · `}vence {fecha(d.vencimiento)} <Estatus valor={d.estado} /></span></li>)}
          </ul>
        )}
      </Bloque>

      <Bloque titulo={cf.titulo_integrantes || 'Integrantes'}>
        <ul className="mb-4 space-y-2">
          {eq.integrantes.map((m: any) => (
            <li key={m.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm">
              <span className="min-w-0 flex-1"><b className="font-semibold">{m.nombre}</b><span className="block truncate text-xs text-mute">{m.correo}</span></span>
              {m.rol === 'Líder' ? <Chip tono="lima">Líder</Chip> : cf.permitir_bajas && <button className="btn btn-danger" disabled={enviando} onClick={() => confirm(`¿Dar de baja a ${m.nombre}? Se desactivará su acceso.`) && pedir('Baja de integrante', { member_id: m.id }, `${m.nombre} fue dado de baja.`)}>Dar de baja</button>}
            </li>
          ))}
        </ul>
        {cf.permitir_altas && <><p className="label">Agregar integrante</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" aria-label="Nombre completo del nuevo integrante" autoComplete="off" placeholder="Nombre completo" value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} />
          <input className="input" type="email" inputMode="email" autoCapitalize="none" aria-label="Correo del nuevo integrante" autoComplete="off" placeholder={nuevo.tipo === 'Externo' ? 'Correo' : `Correo @${info?.dominios?.[0] ?? 'institucional'}`} value={nuevo.correo} onChange={e => setNuevo({ ...nuevo, correo: e.target.value })} />
          <select className="input" aria-label="Tipo de integrante" value={nuevo.tipo} onChange={e => setNuevo({ ...nuevo, tipo: e.target.value, matricula: e.target.value === 'Externo' || nuevo.tipo === 'Externo' ? '' : nuevo.matricula })}><option>Alumno</option><option>Colaborador</option><option>Exatec</option><option value="Externo">Externo (se pedirá su identificación)</option></select>
          <input className="input" aria-label={nuevo.tipo === 'Externo' ? 'Organización' : 'Matrícula o nómina'} placeholder={nuevo.tipo === 'Externo' ? 'Organización (opcional)' : 'Matrícula o nómina'} value={nuevo.matricula} onChange={e => setNuevo({ ...nuevo, matricula: e.target.value })} />
        </div>
        <button className="btn mt-3" disabled={enviando || !nuevo.nombre.trim() || !nuevo.correo.includes('@')}
          onClick={async () => { if (await pedir('Alta de integrante', nuevo, nuevo.tipo === 'Externo' ? `${nuevo.nombre} fue agregado; sube su identificación en la sección de arriba.` : `${nuevo.nombre} fue agregado; gestionaremos su acceso.`)) setNuevo({ ...VACIO }) }}><Plus size={14} /> Agregar</button></>}
      </Bloque>

      {cf.permitir_pausa && <Bloque titulo={cf.titulo_pausa || 'Pausa justificada'}>
        <p className="mb-3 text-sm text-mute">Si no podrán usar el espacio por un motivo justificado, pidan una pausa: conservan su lugar. Máximo {info?.max_pausa} semanas por semestre; llevan {eq.pausa_usada}.</p>
        {pausaDisponible < 1 ? <p className="text-sm font-medium text-amber-800">Ya usaron todas sus semanas de pausa de este semestre.</p> : <>
        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
          <select className="input" aria-label="Semanas de pausa" value={Math.min(pausa.semanas, pausaDisponible)} onChange={e => setPausa({ ...pausa, semanas: Number(e.target.value) })}>{Array.from({ length: pausaDisponible }, (_, i) => <option key={i} value={i + 1}>{i + 1} semana{i ? 's' : ''}</option>)}</select>
          <input className="input" aria-label="Motivo de la pausa" placeholder="Motivo" value={pausa.motivo} onChange={e => setPausa({ ...pausa, motivo: e.target.value })} />
        </div>
        <button className="btn mt-3" disabled={enviando || !pausa.motivo.trim()} onClick={async () => { if (await pedir('Pausa', { ...pausa, semanas: Math.min(pausa.semanas, pausaDisponible) }, 'Solicitud de pausa enviada; el equipo del coworking la revisará.')) setPausa({ semanas: 1, motivo: '' }) }}>Pedir pausa</button>
        </>}
      </Bloque>}
    </Marco>
  )
}
