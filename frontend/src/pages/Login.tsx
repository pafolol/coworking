import { ArrowRight } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'

import { api, useApi } from '../api'
import { Logo, useToast } from '../ui'

const ERRORES: Record<string, string> = {
  no_autorizado: 'Ese correo no está en la lista del equipo operativo. Pide a un administrador que lo agregue en Configuración.',
  cancelado: 'El inicio de sesión se canceló.',
  token: 'Google no aceptó la solicitud. Revisa el Client ID, el secreto y la URI de redirección.',
  correo: 'No pudimos leer tu correo de Google.',
}

export default function Login() {
  const { data } = useApi('/auth/me')
  const [params] = useSearchParams()
  const toast = useToast()
  const [entrando, setEntrando] = useState(false)
  if (data?.usuario) return <Navigate to="/" replace />
  const codigo = params.get('error')
  const error = codigo ? ERRORES[codigo] ?? 'No se pudo iniciar sesión. Intenta de nuevo.' : ''
  const demo = async () => {
    if (entrando) return
    setEntrando(true)
    try {
      await api('/auth/demo', { method: 'POST' })
      location.href = '/'
    } catch (e) {
      toast((e as Error).message, true)
      setEntrando(false)
    }
  }
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="grid-bg relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <Logo nombre={data?.nombre} claro />
        <div className="animate-rise">
          <p className="eyebrow !text-spark">33 espacios · uso real · cero correos sueltos</p>
          <h1 className="mt-4 max-w-xl text-[64px] font-extrabold leading-[0.95]">
            El espacio se gana <span className="text-spark">usándolo</span>.
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/65">
            Convocatoria abierta, check-in con QR y un corte semanal que decide solo. El equipo operativo solo interviene en los casos límite.
          </p>
        </div>
        <div className="grid max-w-md grid-cols-11 gap-1.5">
          {Array.from({ length: 33 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${i * 22}ms` }}
              className={`animate-rise aspect-square rounded-md ${[4, 17, 26].includes(i) ? 'bg-spark' : i % 7 === 3 ? 'border border-dashed border-white/30' : 'bg-brand-400/70'}`} />
          ))}
        </div>
      </div>
      <div className="grid-bg-light flex items-center justify-center p-4 sm:p-8">
        <div className="card w-full max-w-sm animate-rise p-6 sm:p-8">
          <div className="lg:hidden"><Logo nombre={data?.nombre} /></div>
          <h2 className="mt-4 text-2xl font-bold lg:mt-0">Panel de operación</h2>
          <p className="mt-1 text-sm text-mute">Entra con tu cuenta del equipo operativo.</p>
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <a href="/api/auth/google/login"
            aria-disabled={!data?.google} tabIndex={data?.google ? undefined : -1}
            className={`btn mt-6 w-full !py-2.5 ${data?.google ? '' : 'pointer-events-none opacity-45'}`}>
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" /><path fill="#34A853" d="M12 23c3 0 5.500-1 7.300-2.700l-3.600-2.700c-1 .700-2.300 1.100-3.700 1.100-2.900 0-5.300-1.900-6.200-4.500H2.100v2.800A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.800 14.100a6.600 6.600 0 0 1 0-4.200V7.100H2.100a11 11 0 0 0 0 9.800l3.700-2.800z" /><path fill="#EA4335" d="M12 5.400c1.600 0 3.100.6 4.200 1.700l3.200-3.200A11 11 0 0 0 2.100 7.100l3.700 2.800C6.700 7.300 9.100 5.400 12 5.400z" /></svg>
            Continuar con Google
          </a>
          {data && !data.google && (
            <p className="mt-2 text-xs leading-relaxed text-mute">
              Google aún no está configurado. Agrega <span className="mono">GOOGLE_CLIENT_ID</span> y <span className="mono">GOOGLE_CLIENT_SECRET</span> en <span className="mono">backend/.env</span> (pasos en el README).
            </p>
          )}
          {data?.demo && (
            <>
              <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-widest text-mute"><span className="h-px flex-1 bg-line" />o<span className="h-px flex-1 bg-line" /></div>
              <button onClick={demo} disabled={entrando} className="btn btn-primary w-full !py-2.5">{entrando ? 'Entrando…' : <>Entrar en modo demo <ArrowRight size={15} /></>}</button>
              <p className="mt-2 text-xs text-mute">Con datos ficticios y sin enviar correos reales.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
