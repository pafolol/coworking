import { ArrowRight } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { api, useApi } from '../api'
import { Logo, useToast } from '../ui'

export default function Login() {
  const { data } = useApi('/auth/me')
  const toast = useToast()
  const [entrando, setEntrando] = useState(false)
  if (data?.usuario) return <Navigate to="/" replace />
  const [cred, setCred] = useState({ usuario: '', password: '' })
  const entrar = async (e: FormEvent) => {
    e.preventDefault()
    if (entrando) return
    setEntrando(true)
    try {
      await api('/auth/login', { body: cred })
      location.href = '/'
    } catch (err) {
      toast((err as Error).message, true)
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
          <p className="mt-1 text-sm text-mute">Entra con tu usuario del equipo operativo.</p>
          <form onSubmit={entrar} className="mt-6 space-y-3">
            <label className="block"><span className="label">Usuario</span>
              <input className="input" autoComplete="username" value={cred.usuario} onChange={e => setCred({ ...cred, usuario: e.target.value })} /></label>
            <label className="block"><span className="label">Contraseña</span>
              <input className="input" type="password" autoComplete="current-password" value={cred.password} onChange={e => setCred({ ...cred, password: e.target.value })} /></label>
            <button type="submit" disabled={entrando || !cred.usuario || !cred.password} className="btn btn-primary w-full !py-2.5">{entrando ? 'Entrando…' : <>Entrar <ArrowRight size={15} /></>}</button>
          </form>
        </div>
      </div>
    </div>
  )
}
