import {
  Award, BookOpen, CalendarCheck, ClipboardList, FileUp, ClipboardCheck, FileCheck2, History, Inbox, KeyRound, LayoutDashboard, LayoutGrid, ListTodo, LogOut,
  Mail, QrCode, Settings, UsersRound,
} from 'lucide-react'
import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom'

import { api, useApi } from './api'
import Accesos from './pages/Accesos'
import Bitacora from './pages/Bitacora'
import Checkins from './pages/Checkins'
import Config from './pages/Config'
import Corte from './pages/Corte'
import Dashboard from './pages/Dashboard'
import Documentos from './pages/Documentos'
import EquipoDetalle from './pages/EquipoDetalle'
import Equipos from './pages/Equipos'
import Espacios from './pages/Espacios'
import Formularios from './pages/Formularios'
import Guia from './pages/Guia'
import Importar from './pages/Importar'
import Login from './pages/Login'
import Mensajes from './pages/Mensajes'
import Niveles from './pages/Niveles'
import { FormCambios, FormCheckin } from './pages/Publico'
import { FormSolicitud } from './pages/Solicitud'
import { FormPropio } from './pages/FormularioPublico'
import Solicitudes from './pages/Solicitudes'
import Tareas from './pages/Tareas'
import { Logo } from './ui'

type Sesion = { usuario: { email: string; nombre: string; foto: string; demo: boolean } | null; google: boolean; demo: boolean; nombre: string }
const SesionCtx = createContext<{ sesion: Sesion; kpis: any; reload: () => void }>(null!)
export const useSesion = () => useContext(SesionCtx)

const NAV: { grupo: string; items: { to: string; label: string; icon: ReactNode; kpi?: string }[] }[] = [
  { grupo: 'Operación', items: [
    { to: '/', label: 'Inicio', icon: <LayoutDashboard size={17} /> },
    { to: '/tareas', label: 'Tareas', icon: <ListTodo size={17} />, kpi: 'tareas' },
    { to: '/corte', label: 'Corte semanal', icon: <CalendarCheck size={17} />, kpi: 'corte' },
    { to: '/mensajes', label: 'Mensajes', icon: <Mail size={17} />, kpi: 'bandeja' },
  ] },
  { grupo: 'Comunidad', items: [
    { to: '/solicitudes', label: 'Solicitudes', icon: <Inbox size={17} />, kpi: 'por_evaluar' },
    { to: '/equipos', label: 'Equipos', icon: <UsersRound size={17} /> },
    { to: '/espacios', label: 'Espacios', icon: <LayoutGrid size={17} /> },
    { to: '/niveles', label: 'Niveles y beneficios', icon: <Award size={17} /> },
    { to: '/checkins', label: 'Check-ins', icon: <QrCode size={17} /> },
    { to: '/formularios', label: 'Formularios', icon: <ClipboardList size={17} /> },
  ] },
  { grupo: 'Control', items: [
    { to: '/accesos', label: 'Accesos', icon: <KeyRound size={17} /> },
    { to: '/documentos', label: 'Documentos', icon: <FileCheck2 size={17} /> },
  ] },
  { grupo: 'Sistema', items: [
    { to: '/guia', label: 'Cómo funciona', icon: <BookOpen size={17} /> },
    { to: '/importar', label: 'Importar datos', icon: <FileUp size={17} /> },
    { to: '/bitacora', label: 'Bitácora', icon: <History size={17} /> },
    { to: '/config', label: 'Configuración', icon: <Settings size={17} /> },
  ] },
]

function Shell() {
  const { sesion, kpis } = useSesion()
  const u = sesion.usuario!
  const salir = async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } finally {
      location.href = '/login'
    }
  }
  return (
    <div className="flex min-h-screen">
      <aside className="no-print grid-bg sticky top-0 flex h-screen w-[232px] shrink-0 flex-col bg-ink text-white">
        <div className="px-5 pb-2 pt-5"><Logo nombre={sesion.nombre} claro /></div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {NAV.map(g => (
            <div key={g.grupo} className="mt-2.5">
              <p className="eyebrow mb-1 px-2 !text-[10px] !text-white/35">{g.grupo}</p>
              {g.items.map(it => {
                const n = it.kpi === 'corte' ? kpis?.corte : kpis?.[it.kpi ?? '']
                return (
                  <NavLink key={it.to} to={it.to} end={it.to === '/'}
                    className={({ isActive }) => `group flex items-center gap-2.5 rounded-lg px-2.5 py-[5px] text-[13.5px] font-medium transition ${isActive ? 'bg-white text-ink' : 'text-white/70 hover:bg-white/10 hover:text-white'}`}>
                    {it.icon}
                    <span className="flex-1">{it.label}</span>
                    {!!n && <span className="rounded-full bg-spark px-1.5 font-mono text-[10.5px] font-semibold text-ink">{n}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            {u.foto ? <img src={u.foto} alt="" className="size-8 rounded-full" referrerPolicy="no-referrer" /> : (
              <span className="grid size-8 place-items-center rounded-full bg-brand font-display text-sm font-bold">{(u.nombre[0] ?? '?').toUpperCase()}</span>
            )}
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-semibold">{u.nombre}</p>
              <p className="truncate text-[11px] text-white/45">{u.demo ? 'modo demo' : u.email}</p>
            </div>
            <button onClick={salir} title="Cerrar sesión" aria-label="Cerrar sesión" className="cursor-pointer rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {kpis?.modo_prueba && (
          <div className="no-print flex items-center justify-center gap-2 bg-spark px-4 py-1.5 text-[12.5px] font-semibold text-ink">
            <ClipboardCheck size={14} /> Modo prueba activo: ningún correo llega a los equipos. Se cambia en Configuración → Correo.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  )
}

function Pantalla({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center p-6 text-center text-sm text-mute">{children}</div>
}

function Protegido() {
  const { data: sesion, error, reload } = useApi<Sesion>('/auth/me')
  const loc = useLocation()
  // Los contadores del menú se refrescan al cambiar de página; mientras llegan se conservan los anteriores.
  const { data: nav } = useApi(sesion?.usuario ? `/nav?p=${encodeURIComponent(loc.pathname)}` : null)
  const ultimoNav = useRef<any>(null)
  if (nav) ultimoNav.current = nav
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  if (!sesion) {
    return error ? (
      <Pantalla>
        <div>
          <p className="mb-3 text-red-700">{error}</p>
          <button className="btn" onClick={() => void reload()}>Reintentar</button>
        </div>
      </Pantalla>
    ) : <Pantalla>Cargando…</Pantalla>
  }
  if (!sesion.usuario) return <Navigate to="/login" replace />
  return (
    <SesionCtx.Provider value={{ sesion, kpis: nav ?? ultimoNav.current, reload }}>
      <Shell />
    </SesionCtx.Provider>
  )
}

function NoEncontrada() {
  return (
    <Pantalla>
      <div>
        <p className="font-display text-5xl font-extrabold text-ink">404</p>
        <p className="mt-2">Esta página no existe.</p>
        <Link to="/" className="btn btn-primary mt-4">Ir al inicio</Link>
      </div>
    </Pantalla>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/f/solicitud" element={<FormSolicitud />} />
      <Route path="/f/checkin" element={<FormCheckin />} />
      <Route path="/formulario/:slug" element={<FormPropio />} />
      <Route path="/f/cambios" element={<FormCambios />} />
      <Route element={<Protegido />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tareas" element={<Tareas />} />
        <Route path="/corte" element={<Corte />} />
        <Route path="/mensajes" element={<Mensajes />} />
        <Route path="/solicitudes" element={<Solicitudes />} />
        <Route path="/equipos" element={<Equipos />} />
        <Route path="/equipos/:id" element={<EquipoDetalle />} />
        <Route path="/espacios" element={<Espacios />} />
        <Route path="/niveles" element={<Niveles />} />
        <Route path="/checkins" element={<Checkins />} />
        <Route path="/formularios" element={<Formularios />} />
        <Route path="/accesos" element={<Accesos />} />
        <Route path="/documentos" element={<Documentos />} />
        <Route path="/guia" element={<Guia />} />
        <Route path="/importar" element={<Importar />} />
        <Route path="/bitacora" element={<Bitacora />} />
        <Route path="/config" element={<Config />} />
      </Route>
      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  )
}
