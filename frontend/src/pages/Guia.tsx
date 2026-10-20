import type { ReactNode } from 'react'

import { useApi } from '../api'
import { Card, Chip, Page, Vacio } from '../ui'

function Caja({ x, y, label, tono = 'base', n }: { x: number; y: number; label: string; tono?: 'base' | 'fijo' | 'baja'; n?: number }) {
  const estilo = { base: ['#fff', '#cfd6e6', '#06123a'], fijo: ['#0a3dba', '#0a3dba', '#fff'], baja: ['#fff', '#dc2626', '#b91c1c'] }[tono]
  return (
    <g>
      <rect x={x} y={y} width="190" height="56" rx="12" fill={estilo[0]} stroke={estilo[1]} strokeWidth="1.5" />
      <text x={x + 95} y={y + 33} textAnchor="middle" fontSize="15" fontWeight="600" fill={estilo[2]} fontFamily="Instrument Sans, sans-serif">{label}</text>
      {n !== undefined && <text x={x + 14} y={y + 18} fontSize="10" fill={tono === 'fijo' ? '#c6f23a' : '#63708f'} fontFamily="JetBrains Mono, monospace">{String(n).padStart(2, '0')}</text>}
    </g>
  )
}

function Ciclo({ c }: { c: any }) {
  const L = (d: string) => <path d={d} fill="none" stroke="#9aa6c2" strokeWidth="1.5" markerEnd="url(#flecha)" />
  const T = (x: number, y: number, t: string, a: 'start' | 'middle' | 'end' = 'start') => <text x={x} y={y} textAnchor={a} fontSize="12" fill="#63708f" fontFamily="Instrument Sans, sans-serif">{t}</text>
  return (
    <svg viewBox="0 0 1000 440" className="w-full min-w-[760px]" role="img" aria-label="Diagrama del ciclo de vida de un equipo: de Solicitud recibida a Baja, pasando por evaluación, operación, espacio fijo, riesgo y alerta de baja">
      <defs><marker id="flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9aa6c2" /></marker></defs>
      <rect x="490" y="14" width="496" height="282" rx="16" fill="#f0f4ff" stroke="#9aa6c2" strokeDasharray="6 5" />
      <text x="506" y="38" fontSize="12" fontWeight="700" fill="#63708f" fontFamily="JetBrains Mono, monospace" letterSpacing="1.5">EN OPERACIÓN</text>
      {L('M210 88H258')}{L('M115 116V188')}{L('M210 216H235V100H258')}{L('M355 116V188')}{L('M450 88H508')}
      {L('M700 88H758')}{L('M605 116V188')}{L('M700 216H730V100H758')}{L('M820 116V188')}{L('M890 190V118')}
      {L('M855 244V272H480V100H508')}{L('M700 296V352')}{L('M760 354V298')}{L('M598 380H452')}
      {T(124, 158, 'faltan docs')}{T(614, 158, 'sin lugar libre')}{T(812, 158, `<${c.DIAS_MINIMOS} días`, 'end')}{T(898, 158, 'recupera')}
      {T(668, 288, `downgrade: ${c.SEMANAS_DOWNGRADE} semanas con <${c.DIAS_MINIMOS} días`, 'middle')}
      {T(692, 330, `0 días en ${c.SEMANAS_SIN_USO} semanas`, 'end')}{T(768, 330, 'vuelve a usar')}{T(525, 372, `${c.DIAS_RESPUESTA_BAJA} días sin respuesta`, 'middle')}
      <Caja x={20} y={60} label="Solicitud recibida" n={1} /><Caja x={20} y={188} label="Docs pendientes" n={2} />
      <Caja x={260} y={60} label="En evaluación" n={3} /><Caja x={260} y={188} label="No aceptado" n={4} />
      <Caja x={510} y={60} label="Activo – Coworking" n={5} /><Caja x={510} y={188} label="Lista de espera" n={6} />
      <Caja x={760} y={60} label="Espacio fijo (33)" tono="fijo" n={7} /><Caja x={760} y={188} label="En riesgo" n={8} />
      <Caja x={600} y={352} label="Alerta de baja" n={9} /><Caja x={260} y={352} label="Baja" tono="baja" n={10} />
    </svg>
  )
}

const Tabla = ({ cols, filas }: { cols: string[]; filas: (string | ReactNode)[][] }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead><tr>{cols.map(c => <th key={c} className="th !px-3">{c}</th>)}</tr></thead>
      <tbody>{filas.map((f, i) => <tr key={i} className="border-t border-line">{f.map((v, j) => <td key={j} className={`px-3 py-2.5 align-top ${j === 0 ? 'font-semibold' : 'text-mute'}`}>{v}</td>)}</tr>)}</tbody>
    </table>
  </div>
)

export default function Guia() {
  const { data, error } = useApi('/config')
  if (!data) return error ? <Page titulo="Cómo funciona"><Vacio>{error}</Vacio></Page> : null
  const c = data.config
  const m = c.DIAS_MINIMOS
  const pasos = [
    ['Registro', 'automático', `El equipo llena el formulario de solicitud: proyecto, líder, integrantes y documentos. El sistema crea el equipo, le asigna folio y confirma el registro.`],
    ['Revisión de documentos', 'automático + manual', 'Si falta algo obligatorio, se pide y el equipo queda en Documentación pendiente. Completo, pasa a En evaluación.'],
    ['Evaluación', 'manual', `Un evaluador califica con la rúbrica y registra la decisión. Meta: máximo ${c.DIAS_HABILES_DECISION} días hábiles.`],
    ['Decisión', 'automático', 'Aceptado: sale la bienvenida con el reglamento. No aceptado: sale la retroalimentación y la fecha para volver a aplicar.'],
    ['Alta de accesos', 'manual', `Se da de alta a cada integrante en la plataforma de accesos del campus y aquí se captura su vencimiento. Los primeros ${c.DIAS_GRACIA} días no generan alertas de baja.`],
    ['Operación continua', 'automático', 'El corte semanal decide upgrades, alertas, downgrades y bajas; la revisión diaria vigila vencimientos de accesos y documentos.'],
  ]
  return (
    <Page titulo="Cómo funciona" eyebrow="El manual de operación, en una página">
      <div className="mb-5 grid gap-4 md:grid-cols-4">
        {[
          ['Una sola fuente de verdad', 'Cada equipo, integrante, acceso, documento y espacio vive aquí; nada en correos sueltos.'],
          ['Reglas medibles y automáticas', 'El corte, las alertas y los vencimientos se calculan solos; el equipo solo decide en los casos límite.'],
          ['Nadie se entera tarde', 'Cada cambio de estado dispara un mensaje estándar, con aviso previo antes de cualquier baja.'],
          ['Parámetros ajustables', 'Umbrales, semanas de gracia y días de aviso viven en Configuración, no en el código.'],
        ].map(([t, d], i) => (
          <div key={t} className={`rounded-2xl p-5 ${i === 0 ? 'bg-ink text-white' : 'card'}`}>
            <span className={`font-mono text-xs ${i === 0 ? 'text-spark' : 'text-brand'}`}>0{i + 1}</span>
            <h3 className="mt-2 text-lg font-bold leading-tight">{t}</h3>
            <p className={`mt-2 text-[13px] leading-relaxed ${i === 0 ? 'text-white/65' : 'text-mute'}`}>{d}</p>
          </div>
        ))}
      </div>

      <Card titulo="Ciclo de vida de un equipo" extra={<span className="text-xs text-mute">10 estados · solo los mueve una decisión registrada o el corte semanal</span>}>
        <div className="overflow-x-auto"><Ciclo c={c} /></div>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card titulo="Modalidades">
          <Tabla cols={['Modalidad', 'Qué incluye', 'Cómo se obtiene', 'Cómo se conserva']} filas={[
            ['Acceso Coworking', 'Áreas comunes, sin lugar asignado', 'Ser aceptado en la evaluación', `Al menos 1 día de uso cada ${c.SEMANAS_SIN_USO} semanas (con 0 días en ${c.SEMANAS_SIN_USO} seguidas hay alerta de baja); acceso y documentos vigentes`],
            ['Espacio Fijo (33)', 'Lugar asignado al equipo', `${m}+ días por semana durante ${c.SEMANAS_UPGRADE} semanas seguidas y un lugar libre`, `${m}+ días por semana; una semana baja genera alerta, ${c.SEMANAS_DOWNGRADE} seguidas generan downgrade`],
            ['Lista de espera', 'Acceso Coworking + prioridad para el siguiente lugar', 'Cumplir la regla de upgrade cuando no hay lugar', `Se ordena por promedio de días de uso de las últimas ${c.SEMANAS_PROMEDIO} semanas`],
          ]} />
        </Card>
        <Card titulo="Cómo se mide el uso">
          <ul className="space-y-3 text-sm text-mute">
            <li><b className="text-ink">Semana de corte:</b> lunes a domingo. El corte corre cada lunes a las 7:00 sobre la semana anterior.</li>
            <li><b className="text-ink">Visita:</b> se cuenta por equipo y por día. Si el lunes vino una persona o vino todo el equipo, es una sola visita. El equipo necesita {m} visitas por semana.</li>
            <li><b className="text-ink">Semanas que no cuentan:</b> vacaciones, semanas especiales y cierres del campus se marcan en Configuración.</li>
            <li><b className="text-ink">Pausa justificada:</b> máximo {c.MAX_SEMANAS_PAUSA} semanas por semestre; el equipo conserva su lugar y la aprueba Administración.</li>
            <li><b className="text-ink">QR:</b> solo dentro del espacio. Un correo no registrado se marca inválido y se avisa al equipo operativo. Si hay uso remoto, se rota.</li>
          </ul>
        </Card>
      </div>

      <Card titulo="Del registro al primer día: 6 pasos" className="mt-5">
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pasos.map(([t, tipo, d], i) => (
            <li key={t} className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between"><span className="grid size-7 place-items-center rounded-lg bg-brand font-mono text-xs font-semibold text-white">{i + 1}</span><Chip tono={tipo === 'manual' ? 'ambar' : tipo === 'automático' ? 'lima' : 'azul'}>{tipo}</Chip></div>
              <h3 className="mt-3 font-bold">{t}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-mute">{d}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[13px] text-mute">Cambios de integrantes: altas y bajas se piden con el formulario de cambios; el sistema actualiza integrantes y crea la tarea de alta o baja de acceso.</p>
      </Card>

      <Card titulo="Reglas del corte semanal" className="mt-5">
        <Tabla cols={['Situación del equipo', 'Acción', 'Mensaje']} filas={[
          [`Coworking con ${m}+ días en las ${c.SEMANAS_UPGRADE} últimas semanas y hay lugar libre`, 'Upgrade a Espacio Fijo, asigna lugar', 'Upgrade'],
          [`Coworking con ${m}+ días en las ${c.SEMANAS_UPGRADE} últimas semanas y no hay lugar`, 'Entra a Lista de espera', 'Lista de espera'],
          [`Espacio Fijo con menos de ${m} días en la semana`, 'Estado En riesgo', 'Alerta de uso'],
          [`Espacio Fijo con menos de ${m} días ${c.SEMANAS_DOWNGRADE} semanas seguidas`, 'Downgrade a Coworking, libera lugar y lo ofrece al primero de la lista', 'Downgrade'],
          [`Cualquier equipo con 0 días en ${c.SEMANAS_SIN_USO} semanas seguidas`, `Alerta de baja, ${c.DIAS_RESPUESTA_BAJA} días para responder (si tenía Espacio Fijo, también lo pierde)`, 'Alerta de baja'],
          [`Alerta de baja sin uso ni respuesta tras ${c.DIAS_RESPUESTA_BAJA} días`, 'Baja y tarea para revocar accesos', 'Baja'],
        ]} />
        <p className="mt-3 text-[13px] text-mute">Antes de enviar nada, el corte arma una propuesta y Administración la aprueba con un clic; así nadie recibe una baja por un error de registro.</p>
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card titulo="Accesos, documentación y renovación">
          <ul className="space-y-3 text-sm text-mute">
            <li><b className="text-ink">A {c.AVISO_1} días:</b> aviso al integrante y al líder; si el equipo está activo, se crea la tarea de renovación.</li>
            <li><b className="text-ink">A {c.AVISO_2} días sin renovar:</b> recordatorio y aviso al equipo operativo.</li>
            <li><b className="text-ink">Vencido:</b> el integrante pasa a Acceso vencido; sus check-ins se registran, pero se avisa al equipo operativo.</li>
            <li><b className="text-ink">Solo se renuevan</b> accesos de equipos activos; los de Alerta de baja esperan la resolución del corte.</li>
            <li><b className="text-ink">Documentos:</b> la carta compromiso se acepta en el formulario, sin archivo; solo se suben identificaciones de externos (PDF o imagen).</li>
            <li><b className="text-ink">Renovación semestral:</b> {c.RENOVACION_AUTOMATICA ? 'arranca sola en las fechas configuradas' : 'se inicia a mano'}; todos repiten el proceso (integrantes y carta compromiso) y quien no confirma en {c.DIAS_RENOVACION} días entra en Alerta de baja.</li>
            <li><b className="text-ink">Correos:</b> alumnos y colaboradores se registran con su correo institucional{(c.DOMINIOS_INTERNOS ?? []).length ? ` (@${c.DOMINIOS_INTERNOS.join(', @')})` : ''}; a los externos se les pide identificación.</li>
          </ul>
        </Card>
        <Card titulo="Roles">
          <Tabla cols={['Rol', 'Responsabilidades', 'Tiempo']} filas={[
            ['Administración', 'Aprueba la propuesta de corte, resuelve excepciones y pausas, cuida la configuración', '30 min por semana'],
            ['Evaluación', 'Califica solicitudes con la rúbrica y registra la decisión', 'Por solicitud'],
            ['Accesos y documentos', 'Da de alta, renueva y revoca accesos en la plataforma del campus; valida documentos', 'Según tareas del día'],
          ]} />
          <p className="mt-3 text-[13px] text-mute">Una persona puede tener más de un rol. Las tareas de cada rol están en Tareas.</p>
        </Card>
      </div>

      <Card titulo="Calendario de operación" className="mt-5">
        <Tabla cols={['Cuándo', 'Qué pasa', 'Quién']} filas={[
          ['Al recibir solicitud', 'Confirmación de registro y revisión de documentos', <Chip tono="lima">Sistema</Chip>],
          ['Diario, 8:00', 'Revisión de vencimientos de accesos y documentos; lista de tareas del día', <Chip tono="lima">Sistema</Chip>],
          ['Lunes, 7:00', 'Corte semanal y propuesta de corte', <Chip tono="lima">Sistema</Chip>],
          ['Lunes, antes de 12:00', 'Aprobar la propuesta; se envían los mensajes', <Chip tono="ambar">Administración</Chip>],
          ['Martes', 'Comité de evaluación de solicitudes pendientes', <Chip tono="ambar">Evaluación</Chip>],
          ['Inicio de semestre', 'Renovación de integrantes y documentos', <Chip tono="azul">Sistema + Accesos</Chip>],
          ['Mensual', 'Reporte de ocupación y uso (en Inicio)', <Chip tono="lima">Sistema</Chip>],
        ]} />
      </Card>
    </Page>
  )
}
