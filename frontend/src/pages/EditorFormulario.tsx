import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'

import { api } from '../api'
import { Campo, Modal, useAccion, useToast } from '../ui'

const TIPOS = [['texto', 'Texto corto'], ['parrafo', 'Texto largo'], ['opcion', 'Lista de opciones'], ['casilla', 'Casilla (sí / no)']]

function Interruptor({ on, onChange, label, nota }: { on: boolean; onChange: (v: boolean) => void; label: string; nota?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-left transition hover:border-brand-400">
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${on ? 'bg-brand' : 'bg-slate-300'}`}><i className={`size-4 rounded-full bg-white transition ${on ? 'translate-x-4' : ''}`} /></span>
      <span><b className="block text-sm font-semibold">{label}</b>{nota && <span className="text-xs text-mute">{nota}</span>}</span>
    </button>
  )
}

/** Editor de un formulario público: textos, opciones y (en la solicitud) preguntas extra. */
export default function EditorFormulario({ clave, nombre, url, todos, onClose, reload }: { clave: 'solicitud' | 'checkin' | 'cambios'; nombre: string; url: string; todos: any; onClose: () => void; reload: () => unknown }) {
  const [f, setF] = useState<any>(structuredClone(todos[clave]))
  const run = useAccion(reload)
  const toast = useToast()
  const [guardando, setGuardando] = useState(false)
  const inicial = useRef(JSON.stringify(todos[clave]))
  const sucio = JSON.stringify(f) !== inicial.current
  // Esc o un clic fuera cierran el modal: no se pierde una edición larga sin avisar.
  const cerrar = () => { if (!sucio || confirm('Hay cambios sin guardar. ¿Cerrar y descartarlos?')) onClose() }
  const set = (k: string, v: any) => setF({ ...f, [k]: v })
  const preguntas: any[] = f.preguntas ?? []
  const pregunta = (i: number, cambios: object) => set('preguntas', preguntas.map((q, j) => (j === i ? { ...q, ...cambios } : q)))
  const mover = (i: number, d: number) => {
    const copia = [...preguntas]
    ;[copia[i], copia[i + d]] = [copia[i + d], copia[i]]
    set('preguntas', copia)
  }
  const guardar = async () => {
    if (guardando) return
    if (!String(f.titulo ?? '').trim()) return toast('El título no puede quedar vacío.', true)
    if (clave === 'solicitud') {
      const sinOpciones = preguntas.find(q => q.etiqueta.trim() && q.tipo === 'opcion' && !(q.opciones ?? []).some((o: string) => o.trim()))
      if (sinOpciones) return toast(`La pregunta «${sinOpciones.etiqueta.trim()}» es una lista de opciones pero no tiene opciones.`, true)
      if (!(f.etapas ?? []).some((e: string) => e.trim())) return toast('Deja al menos una etapa del proyecto.', true)
    }
    const limpio = { ...f }
    if (clave === 'solicitud') {
      limpio.etapas = (f.etapas ?? []).map((e: string) => e.trim()).filter(Boolean)
      limpio.preguntas = preguntas.filter(q => q.etiqueta.trim()).map(q => ({ ...q, etiqueta: q.etiqueta.trim(), opciones: (q.opciones ?? []).map((o: string) => o.trim()).filter(Boolean) }))
    }
    setGuardando(true)
    const ok = await run(() => api('/config', { method: 'PUT', body: { FORMULARIOS: { ...todos, [clave]: limpio } } }), `Formulario de ${nombre.toLowerCase()} guardado`)
    setGuardando(false)
    if (ok) onClose()
  }

  return (
    <Modal titulo={`Editar formulario · ${nombre}`} onClose={cerrar} ancho="max-w-3xl">
      <div className="space-y-4">
        <Campo label="Título"><input className="input font-display text-lg font-bold" value={f.titulo} onChange={e => set('titulo', e.target.value)} /></Campo>
        <Campo label="Texto de introducción" ayuda={clave === 'solicitud' ? 'Puedes usar {{dias_minimos}} y {{semanas_upgrade}}: se reemplazan por los valores de Configuración.' : undefined}>
          <textarea className="input min-h-20" value={f.intro} onChange={e => set('intro', e.target.value)} />
        </Campo>

        {clave === 'checkin' && <Campo label="Texto del botón"><input className="input" value={f.boton} onChange={e => set('boton', e.target.value)} /></Campo>}

        {clave === 'cambios' && (
          <div className="space-y-2">
            <p className="label">Trámites que el líder puede hacer solo</p>
            <Interruptor on={f.permitir_altas} onChange={v => set('permitir_altas', v)} label="Agregar integrantes" nota="Crea la tarea de alta de acceso." />
            <Interruptor on={f.permitir_bajas} onChange={v => set('permitir_bajas', v)} label="Dar de baja integrantes" nota="Crea la tarea de revocar el acceso." />
            <Interruptor on={f.permitir_pausa} onChange={v => set('permitir_pausa', v)} label="Pedir pausa justificada" nota="Llega como tarea para que Administración la apruebe." />
            <p className="text-xs text-mute">Subir identificaciones, aceptar la carta y confirmar la renovación siempre están disponibles.</p>
          </div>
        )}

        {clave === 'solicitud' && (
          <>
            <Campo label="Pregunta principal del proyecto"><input className="input" value={f.pregunta_descripcion} onChange={e => set('pregunta_descripcion', e.target.value)} /></Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Etapas (una por línea)"><textarea className="input min-h-32" value={(f.etapas ?? []).join('\n')} onChange={e => set('etapas', e.target.value.split('\n'))} /></Campo>
              <div className="space-y-3">
                <div><p className="label">Campos opcionales</p><Interruptor on={f.pedir_sector} onChange={v => set('pedir_sector', v)} label="Preguntar el sector" /></div>
                <Campo label="Mensaje al terminar"><textarea className="input min-h-20" value={f.mensaje_final} onChange={e => set('mensaje_final', e.target.value)} /></Campo>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="label !mb-0">Preguntas extra</p>
                <button type="button" className="btn" onClick={() => set('preguntas', [...preguntas, { id: `p${Date.now()}`, etiqueta: '', tipo: 'texto', opciones: [], obligatoria: false }])}><Plus size={14} /> Agregar pregunta</button>
              </div>
              {preguntas.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mute">Sin preguntas extra. Lo que agregues aparece en «El proyecto» y sus respuestas se ven en la ficha del equipo y al evaluar.</p>}
              <div className="space-y-2">
                {preguntas.map((q, i) => (
                  <div key={q.id} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <input className="input min-w-52 flex-1" placeholder="Texto de la pregunta" aria-label="Texto de la pregunta" value={q.etiqueta} onChange={e => pregunta(i, { etiqueta: e.target.value })} />
                      <select className="input !w-44" aria-label="Tipo de pregunta" value={q.tipo} onChange={e => pregunta(i, { tipo: e.target.value })}>{TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                      <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={q.obligatoria} onChange={e => pregunta(i, { obligatoria: e.target.checked })} /> Obligatoria</label>
                      <button type="button" className="btn btn-ghost !px-1.5 text-mute" disabled={i === 0} onClick={() => mover(i, -1)} title="Subir" aria-label="Subir pregunta"><ArrowUp size={14} /></button>
                      <button type="button" className="btn btn-ghost !px-1.5 text-mute" disabled={i === preguntas.length - 1} onClick={() => mover(i, 1)} title="Bajar" aria-label="Bajar pregunta"><ArrowDown size={14} /></button>
                      <button type="button" className="btn btn-ghost !px-1.5 text-mute" onClick={() => set('preguntas', preguntas.filter((_, j) => j !== i))} title="Quitar" aria-label="Quitar pregunta"><Trash2 size={14} /></button>
                    </div>
                    {q.tipo === 'opcion' && <textarea className="input mt-2 min-h-20 text-[13px]" placeholder="Opciones, una por línea" aria-label="Opciones, una por línea" value={(q.opciones ?? []).join('\n')} onChange={e => pregunta(i, { opciones: e.target.value.split('\n') })} />}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-mute">Los integrantes, la casilla de externo con su identificación y la carta compromiso son fijos; el texto de la carta se edita en Configuración.</p>
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
