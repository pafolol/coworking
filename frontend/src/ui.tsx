import { X } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

export const ESTADO_STYLE: Record<string, { chip: string; dot: string }> = {
  'Solicitud recibida': { chip: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  'Documentación pendiente': { chip: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  'En evaluación': { chip: 'bg-indigo-100 text-indigo-800', dot: 'bg-indigo-500' },
  'No aceptado': { chip: 'bg-stone-200 text-stone-600', dot: 'bg-stone-400' },
  'Activo – Coworking': { chip: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  'Lista de espera': { chip: 'bg-teal-100 text-teal-800', dot: 'bg-teal-500' },
  'Espacio fijo': { chip: 'bg-brand text-white', dot: 'bg-brand' },
  'En riesgo': { chip: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500' },
  'Alerta de baja': { chip: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  Baja: { chip: 'bg-ink text-white/80', dot: 'bg-ink' },
}

const TONOS: Record<string, string> = {
  gris: 'bg-slate-100 text-slate-700',
  azul: 'bg-brand-100 text-brand-600',
  verde: 'bg-emerald-100 text-emerald-800',
  ambar: 'bg-amber-100 text-amber-800',
  naranja: 'bg-orange-100 text-orange-800',
  rojo: 'bg-red-100 text-red-700',
  lima: 'bg-spark text-ink',
  tinta: 'bg-ink text-white',
}

export function Chip({ children, tono = 'gris', className = '' }: { children: ReactNode; tono?: string; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${TONOS[tono] ?? tono} ${className}`}>{children}</span>
}

export function Estado({ estado }: { estado: string }) {
  return <Chip tono={ESTADO_STYLE[estado]?.chip ?? TONOS.gris}>{estado}</Chip>
}

const ESTATUS_TONO: Record<string, string> = {
  Activo: 'verde', Validado: 'verde', Enviado: 'verde', Hecha: 'verde', Aplicado: 'verde', Aplicada: 'verde',
  Pendiente: 'ambar', 'Por validar': 'ambar', Bandeja: 'ambar', Propuesta: 'lima', Borrador: 'azul', Vencida: 'gris',
  Faltante: 'rojo', Vencido: 'rojo', Rechazado: 'rojo', Error: 'rojo', Revocado: 'gris', Descartado: 'gris',
}
export const Estatus = ({ valor }: { valor: string }) => <Chip tono={ESTATUS_TONO[valor] ?? 'gris'}>{valor}</Chip>

export function EquipoLink({ equipo }: { equipo?: { id: number; nombre: string; folio?: string } | null }) {
  if (!equipo) return <span className="text-mute">—</span>
  return (
    <Link to={`/equipos/${equipo.id}`} className="font-semibold hover:text-brand hover:underline" onClick={e => e.stopPropagation()}>
      {equipo.nombre}
    </Link>
  )
}

export function Page({ titulo, eyebrow, acciones, children }: { titulo: string; eyebrow?: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1320px] animate-rise px-6 pb-16 pt-7 lg:px-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h1 className="text-[32px] font-bold leading-none">{titulo}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">{acciones}</div>
      </header>
      {children}
    </div>
  )
}

export function Card({ titulo, extra, children, className = '', pad = true }: { titulo?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(titulo || extra) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <h2 className="text-[15px] font-bold">{titulo}</h2>
          {extra}
        </div>
      )}
      <div className={pad ? 'p-5' : 'pt-3'}>{children}</div>
    </section>
  )
}

export function Tabla({ cols, children, vacio }: { cols: ReactNode[]; children: ReactNode; vacio?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>{cols.map((c, i) => <th key={i} className="th">{c}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
      {vacio && <p className="px-5 py-10 text-center text-sm text-mute">Nada por aquí.</p>}
    </div>
  )
}

export function Filtros({ opciones, valor, onChange }: { opciones: { id: string; label: string; n?: number }[]; valor: string; onChange: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opciones.map(o => (
        <button key={o.id} type="button" aria-pressed={valor === o.id} onClick={() => onChange(o.id)}
          className={`cursor-pointer rounded-full border px-3 py-1 text-[12.5px] font-semibold transition ${valor === o.id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-mute hover:border-brand-400 hover:text-brand'}`}>
          {o.label}
          {o.n !== undefined && <span className={`ml-1.5 font-mono text-[11px] ${valor === o.id ? 'text-spark' : 'text-mute/70'}`}>{o.n}</span>}
        </button>
      ))}
    </div>
  )
}

// Pila de modales abiertos: Escape y Tab solo actúan sobre el de arriba (hay fichas que abren otro modal encima).
const pilaModales: symbol[] = []
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Modal({ titulo, onClose, children, ancho = 'max-w-lg' }: { titulo: string; onClose: () => void; children: ReactNode; ancho?: string }) {
  const caja = useRef<HTMLDivElement>(null)
  const cerrar = useRef(onClose)
  cerrar.current = onClose
  const idTitulo = useId()
  useEffect(() => {
    const yo = Symbol('modal')
    pilaModales.push(yo)
    const previo = document.activeElement as HTMLElement | null
    const bloqueo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dentro = caja.current
    if (dentro && !dentro.contains(document.activeElement)) (dentro.querySelector<HTMLElement>('input:not([type="hidden"]),select,textarea') ?? dentro).focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (pilaModales[pilaModales.length - 1] !== yo) return
      if (e.key === 'Escape') { e.stopPropagation(); cerrar.current(); return }
      if (e.key !== 'Tab' || !caja.current) return
      const items = [...caja.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => el.offsetParent !== null)
      if (!items.length) { e.preventDefault(); return }
      const primero = items[0], ultimo = items[items.length - 1]
      if (!caja.current.contains(document.activeElement)) { e.preventDefault(); primero.focus() }
      else if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      pilaModales.splice(pilaModales.indexOf(yo), 1)
      if (!pilaModales.length) document.body.style.overflow = bloqueo
      if (previo?.isConnected) previo.focus({ preventScroll: true })  // el foco vuelve a quien abrió el modal
    }
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={() => cerrar.current()}>
      <div ref={caja} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}
        className={`w-full ${ancho} animate-pop rounded-2xl bg-white shadow-pop outline-none`} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 id={idTitulo} className="text-lg font-bold">{titulo}</h3>
          <button className="btn btn-ghost !p-1.5" onClick={() => cerrar.current()} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

/** Días de uso por semana como celdas: llena = cumple el mínimo. */
export function Uso({ dias, minimo, grande = false }: { dias: number[]; minimo: number; grande?: boolean }) {
  return (
    <div className="flex gap-1">
      {dias.map((d, i) => {
        const actual = i === dias.length - 1
        const tono = d >= minimo ? 'bg-brand text-white' : d > 0 ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400'
        return (
          <span key={i} title={actual ? 'Semana en curso' : undefined}
            className={`grid place-items-center rounded-md font-mono font-semibold ${grande ? 'size-8 text-sm' : 'size-6 text-[11px]'} ${tono} ${actual ? 'opacity-60 outline-1 outline-dashed outline-brand-400' : ''}`}>
            {d}
          </span>
        )
      })}
    </div>
  )
}

export function Campo({ label, children, ayuda }: { label: string; children: ReactNode; ayuda?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-mute">{ayuda}</span>}
    </label>
  )
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-mute">{children}</p>
}

// ---------- avisos ----------

type Toast = { id: number; texto: string; error: boolean }
const ToastCtx = createContext<(texto: string, error?: boolean) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((texto: string, error = false) => {
    const id = Date.now() + Math.random()
    setToasts(t => [...t, { id, texto, error }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), error ? 6000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print fixed inset-x-4 bottom-5 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:right-5" aria-live="polite" role="status">
        {toasts.map(t => (
          <div key={t.id} role={t.error ? 'alert' : undefined} className={`animate-pop max-w-sm rounded-xl px-4 py-3 text-sm font-medium shadow-pop ${t.error ? 'bg-red-600 text-white' : 'bg-ink text-white'}`}>
            {!t.error && <span className="mr-2 inline-block size-2 rounded-full bg-spark" />}
            {t.texto}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/** Envuelve una acción: avisa al terminar, muestra el error del API y recarga. */
export function useAccion(reload?: () => unknown) {
  const toast = useToast()
  return useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn()
    } catch (e) {
      toast((e as Error).message, true)
      return false
    }
    if (ok) toast(ok)
    try {
      await reload?.()
    } catch {
      // La acción ya se hizo: un fallo al refrescar no debe presentarse como fallo de la acción.
      toast('Se guardó, pero no se pudo actualizar la pantalla. Recárgala.', true)
    }
    return true
  }, [toast, reload])
}

export function Logo({ nombre = 'Coworking GDL', claro = false }: { nombre?: string; claro?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0">
        <rect width="32" height="32" rx="8" fill={claro ? '#fff' : '#0A3DBA'} />
        <rect x="8" y="8" width="7" height="7" rx="2" fill={claro ? '#0A3DBA' : '#fff'} />
        <rect x="17" y="8" width="7" height="7" rx="2" fill="#C6F23A" />
        <rect x="8" y="17" width="7" height="7" rx="2" fill={claro ? '#0A3DBA' : '#fff'} opacity=".55" />
        <rect x="17" y="17" width="7" height="7" rx="2" fill={claro ? '#0A3DBA' : '#fff'} />
      </svg>
      <span className="leading-none">
        <span className={`block font-display text-[17px] font-extrabold tracking-tight ${claro ? 'text-white' : 'text-ink'}`}>{nombre}</span>
        <span className={`eyebrow !text-[9.5px] ${claro ? '!text-white/50' : ''}`}>hub de emprendimiento</span>
      </span>
    </span>
  )
}
