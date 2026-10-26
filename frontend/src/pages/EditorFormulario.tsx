import { ExternalLink } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../api'
import { Campo, Modal, useAccion, useToast } from '../ui'
import { EditorCampos, revisarCampos, SelectorColor } from './campos'

export function Interruptor({ on, onChange, label, nota }: { on: boolean; onChange: (v: boolean) => void; label: string; nota?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-left transition hover:border-brand-400">
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${on ? 'bg-brand' : 'bg-slate-300'}`}><i className={`size-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`} /></span>
      <span><b className="block text-sm font-semibold">{label}</b>{nota && <span className="text-xs text-mute">{nota}</span>}</span>
    </button>
  )
}

/** Un texto del formulario que se puede cambiar. */
const Texto = ({ f, k, label, set, ayuda, largo }: { f: any; k: string; label: string; set: (k: string, v: any) => void; ayuda?: string; largo?: boolean }) => (
  <Campo label={label} ayuda={ayuda}>
    {largo ? <textarea className="input min-h-20" value={f[k] ?? ''} onChange={e => set(k, e.target.value)} />
      : <input className="input" value={f[k] ?? ''} onChange={e => set(k, e.target.value)} />}
  </Campo>
)

/** Editor de un formulario público: textos, color, opciones y (en la solicitud) preguntas extra de cualquier tipo. */
export default function EditorFormulario({ clave, nombre, url, todos, onClose, reload }: { clave: 'solicitud' | 'checkin' | 'cambios'; nombre: string; url: string; todos: any; onClose: () => void; reload: () => unknown }) {
  const [f, setF] = useState<any>(structuredClone(todos[clave]))
  const run = useAccion(reload)
  const toast = useToast()
  const [guardando, setGuardando] = useState(false)
  const inicial = useRef(JSON.stringify(todos[clave]))
  const sucio = JSON.stringify(f) !== inicial.current
  // Esc o un clic fuera cierran el modal: no se pierde una edición larga sin avisar.
  const cerrar = () => { if (!sucio || confirm('Hay cambios sin guardar. ¿Cerrar y descartarlos?')) onClose() }
  const set = (k: string, v: any) => setF((prev: any) => ({ ...prev, [k]: v }))
  const guardar = async () => {
    if (guardando) return
    if (!String(f.titulo ?? '').trim()) return toast('El título no puede quedar vacío.', true)
    const limpio = { ...f }
    if (clave === 'solicitud') {
      const { error, limpios } = revisarCampos(f.preguntas ?? [])
      if (error) return toast(error, true)
      limpio.preguntas = limpios
      limpio.etapas = (f.etapas ?? []).map((e: string) => e.trim()).filter(Boolean)
      if (!limpio.etapas.length) return toast('Deja al menos una etapa del proyecto.', true)
    }
    setGuardando(true)
    const ok = await run(() => api('/config', { method: 'PUT', body: { FORMULARIOS: { ...todos, [clave]: limpio } } }), `Formulario de ${nombre.toLowerCase()} guardado`)
    setGuardando(false)
    if (ok) onClose()
  }

  return (
    <Modal titulo={`Editar formulario · ${nombre}`} onClose={cerrar} ancho="max-w-4xl">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <Campo label="Título"><input className="input font-display text-lg font-bold" value={f.titulo} onChange={e => set('titulo', e.target.value)} /></Campo>
          <div><p className="label">Color</p><SelectorColor valor={f.color ?? ''} onChange={c => set('color', c)} /></div>
        </div>
        <Texto f={f} k="intro" label="Texto de introducción" set={set} largo ayuda={clave === 'solicitud' ? 'Puedes usar {{dias_minimos}} y {{semanas_upgrade}}: se reemplazan por los valores de Configuración.' : undefined} />

        {clave === 'checkin' && <Texto f={f} k="boton" label="Texto del botón" set={set} />}

        {clave === 'cambios' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="label">Trámites que el líder puede hacer solo</p>
              <Interruptor on={f.permitir_altas} onChange={v => set('permitir_altas', v)} label="Agregar integrantes" nota="Crea la tarea de alta de acceso." />
              <Interruptor on={f.permitir_bajas} onChange={v => set('permitir_bajas', v)} label="Dar de baja integrantes" nota="Crea la tarea de revocar el acceso." />
              <Interruptor on={f.permitir_pausa} onChange={v => set('permitir_pausa', v)} label="Pedir pausa justificada" nota="Llega como tarea para que Administración la apruebe." />
              <p className="text-xs text-mute">Subir identificaciones, aceptar la carta y confirmar la renovación siempre están disponibles.</p>
            </div>
            <div className="space-y-3">
              <p className="label">Títulos de las secciones</p>
              <Texto f={f} k="titulo_documentos" label="Documentos" set={set} />
              <Texto f={f} k="titulo_integrantes" label="Integrantes" set={set} />
              <Texto f={f} k="titulo_pausa" label="Pausa" set={set} />
            </div>
          </div>
        )}

        {clave === 'solicitud' && (
          <>
            <div className="rounded-xl border border-line p-4">
              <p className="label">1 · Sección del proyecto</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Texto f={f} k="titulo_proyecto" label="Título de la sección" set={set} />
                <Texto f={f} k="etiqueta_nombre" label="Pregunta del nombre" set={set} />
                <div className="sm:col-span-2"><Texto f={f} k="pregunta_descripcion" label="Pregunta principal del proyecto" set={set} /></div>
                <Texto f={f} k="etiqueta_etapa" label="Pregunta de la etapa" set={set} />
                <Campo label="Etapas (una por línea)"><textarea className="input min-h-28" value={(f.etapas ?? []).join('\n')} onChange={e => set('etapas', e.target.value.split('\n'))} /></Campo>
                <Interruptor on={f.pedir_sector} onChange={v => set('pedir_sector', v)} label="Preguntar el sector" />
                {f.pedir_sector && <Texto f={f} k="etiqueta_sector" label="Pregunta del sector" set={set} />}
              </div>
              <div className="mt-4">
                <p className="label">Preguntas extra</p>
                <EditorCampos campos={f.preguntas ?? []} onChange={c => set('preguntas', c)}
                  vacio="Sin preguntas extra. Lo que agregues (también archivos o firmas) aparece en «El proyecto» y se ve en la ficha del equipo y al revisar la solicitud." />
              </div>
            </div>
            <div className="rounded-xl border border-line p-4">
              <p className="label">2 · Integrantes y 3 · Carta</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Texto f={f} k="titulo_integrantes" label="Título de integrantes" set={set} />
                <Texto f={f} k="titulo_carta" label="Título de la carta" set={set} />
                <div className="sm:col-span-2"><Texto f={f} k="texto_integrantes" label="Instrucciones de integrantes" set={set} largo ayuda="Vacío = se explica que alumnos y colaboradores usan su correo institucional y los externos suben identificación." /></div>
              </div>
              <p className="mt-2 text-xs text-mute">Los datos de cada integrante, la identificación de externos y la carta compromiso son fijos porque de ellos depende el registro; el texto de la carta se edita en Configuración.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Texto f={f} k="boton" label="Texto del botón de enviar" set={set} />
              <Texto f={f} k="mensaje_final" label="Mensaje al terminar" set={set} largo />
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
          <a className="btn btn-ghost text-mute" href={url} target="_blank"><ExternalLink size={14} /> Ver el formulario publicado</a>
          <div className="flex gap-2"><button className="btn" onClick={cerrar}>Cancelar</button><button className="btn btn-primary" disabled={guardando || !sucio} onClick={guardar}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button></div>
        </div>
      </div>
    </Modal>
  )
}
