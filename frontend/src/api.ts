import { useCallback, useEffect, useRef, useState } from 'react'

/** Convierte el `detail` de FastAPI (texto o lista de errores de validación) en un mensaje legible. */
function mensajeError(data: any, status: number): string {
  const d = data?.detail
  if (typeof d === 'string' && d) return d
  if (Array.isArray(d) && d.length) {
    const msg = d.map((x: any) => (typeof x?.msg === 'string' ? x.msg : '')).filter(Boolean).join('; ')
    if (msg) return `Revisa los datos: ${msg}`
  }
  if (status === 413) return 'El archivo es demasiado grande.'
  if (status === 401) return 'Tu sesión expiró. Vuelve a entrar.'
  if (status === 403) return 'No tienes permiso para hacer esto.'
  if (status === 404) return 'No se encontró lo que buscas.'
  if (status >= 500) return 'El servidor tuvo un problema. Intenta de nuevo en un momento.'
  return 'Algo salió mal. Intenta de nuevo.'
}

export async function api(path: string, options: { method?: string; body?: unknown; form?: FormData } = {}): Promise<any> {
  const init: RequestInit = { method: options.method ?? (options.body !== undefined || options.form ? 'POST' : 'GET'), credentials: 'include' }
  if (options.form) {
    init.body = options.form
  } else if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(options.body)
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new Error('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.')
  }
  if (res.status === 401 && !location.pathname.startsWith('/login') && !location.pathname.startsWith('/f/')) {
    location.href = '/login'
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(mensajeError(data, res.status))
  return data
}

/** Carga un recurso del API y lo vuelve a pedir con `reload()`. Al cambiar `path` se descarta lo anterior. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const vigente = useRef(0)
  const anterior = useRef(path)
  // Otra ruta = otro recurso: no se muestra (ni se confunde con) lo del anterior mientras llega.
  if (anterior.current !== path) {
    anterior.current = path
    setData(null)
    setError('')
  }
  const reload = useCallback(async () => {
    if (!path) return
    const n = ++vigente.current  // si salen dos peticiones, solo cuenta la última
    try {
      const r = await api(path)
      if (n !== vigente.current) return
      setData(r)
      setError('')
    } catch (e) {
      if (n !== vigente.current) return
      setError((e as Error).message)
    }
  }, [path])
  useEffect(() => {
    void reload()
    return () => { vigente.current++ }  // al desmontar o cambiar de ruta, la respuesta tardía se ignora
  }, [reload])
  return { data, error, reload }
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const parse = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)

export const fecha = (iso?: string | null) => {
  if (!iso) return '—'
  const d = parse(iso)
  if (isNaN(d.getTime())) return String(iso)
  return `${d.getDate()} ${MESES[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''}`
}
export const fechaHora = (iso?: string | null) => {
  if (!iso) return '—'
  const d = parse(iso)
  if (isNaN(d.getTime())) return String(iso)
  return `${fecha(iso)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const semanaLabel = (iso: string) => {
  const d = parse(iso)
  if (isNaN(d.getTime())) return String(iso)
  const fin = new Date(d.getTime() + 6 * 864e5)
  return `${d.getDate()} ${MESES[d.getMonth()]} – ${fin.getDate()} ${MESES[fin.getMonth()]}`
}
export const enDias = (dias: number | null | undefined) => {
  if (dias === null || dias === undefined) return '—'
  if (dias < 0) return `venció hace ${-dias} d`
  if (dias === 0) return 'vence hoy'
  return `en ${dias} d`
}
