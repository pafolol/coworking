import { ArrowDown, ArrowUp, Copy, FileText, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { API_URL } from '../api'
import { Campo } from '../ui'
import { Archivo } from './Publico'

/** Tipos de pregunta que se pueden armar en el editor (los mismos que valida el servidor en formas.py). */
export const TIPOS_CAMPO: [string, string][] = [
  ['texto', 'Texto corto'], ['parrafo', 'Texto largo'], ['numero', 'Número'], ['fecha', 'Fecha'], ['correo', 'Correo'], ['telefono', 'Teléfono'],
  ['opcion', 'Lista desplegable'], ['unica', 'Una opción (botones)'], ['varias', 'Varias opciones'], ['casilla', 'Casilla (sí / no)'],
  ['archivo', 'Archivo (PDF o imagen)'], ['firma', 'Firma (leer y aceptar)'], ['seccion', 'Título de sección'],
]
const CON_OPCIONES = ['opcion', 'unica', 'varias']

export type CampoForm = { id: string; etiqueta: string; tipo: string; ayuda?: string; obligatoria?: boolean; opciones?: string[]; texto?: string }
export type Firma = { acepta: boolean; nombre: string }
export type Valor = string | boolean | string[] | Firma | File | undefined

const nuevoId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Lista de preguntas editable: tipo, texto, ayuda, opciones, obligatoria, orden, duplicar y quitar. */
export function EditorCampos({ campos, onChange, vacio }: { campos: CampoForm[]; onChange: (c: CampoForm[]) => void; vacio?: string }) {
  const cambiar = (i: number, cambio: Partial<CampoForm>) => onChange(campos.map((c, j) => (j === i ? { ...c, ...cambio } : c)))
  const mover = (i: number, d: number) => {
    const copia = [...campos]
    ;[copia[i], copia[i + d]] = [copia[i + d], copia[i]]
    onChange(copia)
  }
  const agregar = (tipo = 'texto') => onChange([...campos, { id: nuevoId(), etiqueta: '', tipo, ayuda: '', obligatoria: false, opciones: [], texto: '' }])
  return (
    <div>
      {campos.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mute">{vacio ?? 'Sin preguntas todavía.'}</p>}
      <div className="space-y-2">
        {campos.map((c, i) => (
          <div key={c.id} className={`rounded-xl border p-3 ${c.tipo === 'seccion' ? 'border-brand-400/50 bg-brand-50/40' : 'border-line'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-mute">{i + 1}</span>
              <input className={`input min-w-52 flex-1 ${c.tipo === 'seccion' ? 'font-bold' : ''}`} placeholder={c.tipo === 'seccion' ? 'Título de la sección' : 'Texto de la pregunta'}
                aria-label="Texto de la pregunta" value={c.etiqueta} onChange={e => cambiar(i, { etiqueta: e.target.value })} />
              <select className="input !w-52" aria-label="Tipo de pregunta" value={c.tipo} onChange={e => cambiar(i, { tipo: e.target.value })}>
                {TIPOS_CAMPO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {c.tipo !== 'seccion' && <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={!!c.obligatoria} onChange={e => cambiar(i, { obligatoria: e.target.checked })} /> Obligatoria</label>}
              <span className="flex">
                <button type="button" className="btn btn-ghost !px-1.5 text-mute" disabled={i === 0} onClick={() => mover(i, -1)} title="Subir" aria-label="Subir pregunta"><ArrowUp size={14} /></button>
                <button type="button" className="btn btn-ghost !px-1.5 text-mute" disabled={i === campos.length - 1} onClick={() => mover(i, 1)} title="Bajar" aria-label="Bajar pregunta"><ArrowDown size={14} /></button>
                <button type="button" className="btn btn-ghost !px-1.5 text-mute" onClick={() => onChange([...campos.slice(0, i + 1), { ...c, id: nuevoId() }, ...campos.slice(i + 1)])} title="Duplicar" aria-label="Duplicar pregunta"><Copy size={14} /></button>
                <button type="button" className="btn btn-ghost !px-1.5 text-mute" onClick={() => onChange(campos.filter((_, j) => j !== i))} title="Quitar" aria-label="Quitar pregunta"><Trash2 size={14} /></button>
              </span>
            </div>
            {c.tipo !== 'seccion' && (
              <input className="input mt-2 !py-1.5 text-[13px]" placeholder="Ayuda o instrucciones (opcional)" aria-label="Ayuda de la pregunta" value={c.ayuda ?? ''} onChange={e => cambiar(i, { ayuda: e.target.value })} />
            )}
            {CON_OPCIONES.includes(c.tipo) && (
              <textarea className="input mt-2 min-h-20 text-[13px]" placeholder="Opciones, una por línea" aria-label="Opciones, una por línea"
                value={(c.opciones ?? []).join('\n')} onChange={e => cambiar(i, { opciones: e.target.value.split('\n') })} />
            )}
            {(c.tipo === 'firma' || c.tipo === 'seccion') && (
              <textarea className="input mt-2 min-h-24 text-[13px]" aria-label={c.tipo === 'firma' ? 'Texto que se firma' : 'Texto de la sección'}
                placeholder={c.tipo === 'firma' ? 'Texto que la persona lee y acepta (reglamento, carta, aviso…). Firma escribiendo su nombre.' : 'Texto o instrucciones de esta sección (opcional)'}
                value={c.texto ?? ''} onChange={e => cambiar(i, { texto: e.target.value })} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="btn" onClick={() => agregar()}><Plus size={14} /> Pregunta</button>
        <button type="button" className="btn btn-ghost" onClick={() => agregar('archivo')}><Plus size={14} /> Pedir archivo</button>
        <button type="button" className="btn btn-ghost" onClick={() => agregar('firma')}><Plus size={14} /> Pedir firma</button>
        <button type="button" className="btn btn-ghost" onClick={() => agregar('seccion')}><Plus size={14} /> Sección</button>
      </div>
    </div>
  )
}

/** Valida en el navegador lo mismo que el servidor, para avisar antes de guardar. */
export function revisarCampos(campos: CampoForm[]): { error?: string; limpios: CampoForm[] } {
  const limpios = campos.filter(c => c.etiqueta.trim()).map(c => ({
    ...c, etiqueta: c.etiqueta.trim(), opciones: CON_OPCIONES.includes(c.tipo) ? (c.opciones ?? []).map(o => o.trim()).filter(Boolean) : [],
  }))
  const sinOpciones = limpios.find(c => CON_OPCIONES.includes(c.tipo) && !c.opciones.length)
  if (sinOpciones) return { error: `La pregunta «${sinOpciones.etiqueta}» es de opciones pero no tiene opciones.`, limpios }
  return { limpios }
}

/** Una pregunta lista para contestarse en un formulario público. */
export function CampoRespuesta({ q, valor, onChange, sugerido }: { q: CampoForm; valor: Valor; onChange: (v: Valor) => void; sugerido?: string }) {
  const etiqueta = q.etiqueta + (q.obligatoria ? '' : ' (opcional)')
  const texto = typeof valor === 'string' ? valor : ''
  if (q.tipo === 'seccion') {
    return (
      <div className="pt-2">
        <h3 className="text-base font-bold">{q.etiqueta}</h3>
        {q.texto && <p className="mt-1 whitespace-pre-line text-sm text-mute">{q.texto}</p>}
      </div>
    )
  }
  if (q.tipo === 'casilla') {
    return (
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-sm">
        <input type="checkbox" required={q.obligatoria} className="mt-0.5 size-4 shrink-0 accent-brand" checked={valor === true} onChange={e => onChange(e.target.checked)} />
        <span>{q.etiqueta}{q.ayuda && <span className="block text-xs text-mute">{q.ayuda}</span>}</span>
      </label>
    )
  }
  if (q.tipo === 'archivo') {
    return (
      <div>
        <p className="label">{etiqueta}</p>
        <Archivo label={valor instanceof File ? 'Archivo elegido' : 'Elegir archivo'} sub={q.ayuda || undefined} file={valor instanceof File ? valor : undefined} onChange={f => onChange(f)} />
      </div>
    )
  }
  if (q.tipo === 'firma') {
    const firma = (valor && typeof valor === 'object' && 'acepta' in valor ? valor : { acepta: false, nombre: '' }) as Firma
    return (
      <div>
        <p className="label">{etiqueta}</p>
        {q.texto && <div className="max-h-60 overflow-y-auto whitespace-pre-line rounded-xl border border-line bg-slate-50 p-4 text-[13px] leading-relaxed text-ink/80">{q.texto}</div>}
        <label className={`mt-3 flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${firma.acepta ? 'border-brand bg-brand-50' : 'border-line hover:border-brand-400'}`}>
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-brand" checked={firma.acepta}
            onChange={e => onChange({ acepta: e.target.checked, nombre: firma.nombre || (e.target.checked ? sugerido ?? '' : '') })} />
          <span className="text-sm"><b className="font-semibold">He leído y acepto</b>{q.ayuda ? ` · ${q.ayuda}` : ''}</span>
        </label>
        <div className="mt-2"><input className="input" autoComplete="name" aria-label={`Nombre completo para firmar ${q.etiqueta}`} placeholder="Nombre completo (vale como firma)"
          value={firma.nombre} onChange={e => onChange({ ...firma, nombre: e.target.value })} /></div>
      </div>
    )
  }
  if (q.tipo === 'unica' || q.tipo === 'varias') {
    const elegidas = Array.isArray(valor) ? valor : []
    return (
      <fieldset>
        <legend className="label">{etiqueta}</legend>
        {q.ayuda && <p className="-mt-1 mb-2 text-xs text-mute">{q.ayuda}</p>}
        <div className="flex flex-wrap gap-2">
          {(q.opciones ?? []).map(o => {
            const activa = q.tipo === 'unica' ? texto === o : elegidas.includes(o)
            return (
              <label key={o} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${activa ? 'border-brand bg-brand-50 font-semibold' : 'border-line hover:border-brand-400'}`}>
                <input type={q.tipo === 'unica' ? 'radio' : 'checkbox'} name={q.id} className="size-4 accent-brand" checked={activa}
                  onChange={() => onChange(q.tipo === 'unica' ? o : activa ? elegidas.filter(x => x !== o) : [...elegidas, o])} />
                {o}
              </label>
            )
          })}
        </div>
      </fieldset>
    )
  }
  const tipoInput: Record<string, string> = { numero: 'number', fecha: 'date', correo: 'email', telefono: 'tel' }
  return (
    <Campo label={etiqueta} ayuda={q.ayuda || undefined}>
      {q.tipo === 'parrafo' ? <textarea required={q.obligatoria} className="input min-h-24" value={texto} onChange={e => onChange(e.target.value)} />
        : q.tipo === 'opcion' ? (
          <select required={q.obligatoria} className="input" value={texto} onChange={e => onChange(e.target.value)}>
            <option value="">Elige una opción…</option>
            {(q.opciones ?? []).map(o => <option key={o}>{o}</option>)}
          </select>
        ) : <input required={q.obligatoria} type={tipoInput[q.tipo] ?? 'text'} step={q.tipo === 'numero' ? 'any' : undefined} className="input" value={texto} onChange={e => onChange(e.target.value)} />}
    </Campo>
  )
}

/** Lo que falta por contestar (las casillas, archivos, opciones y firmas no se revisan solas con `required`). */
export function faltante(campos: CampoForm[], valores: Record<string, Valor>): string | null {
  for (const q of campos) {
    if (!q.obligatoria || q.tipo === 'seccion') continue
    const v = valores[q.id]
    const vacio = v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length)
      || (q.tipo === 'firma' && !(v && typeof v === 'object' && 'acepta' in v && v.acepta && v.nombre.trim()))
    if (vacio) return q.tipo === 'firma' ? `Para firmar «${q.etiqueta}» marca que aceptas y escribe tu nombre.` : `Falta responder: ${q.etiqueta}`
  }
  return null
}

/** Separa las respuestas para enviarlas: los archivos van aparte como «archivo:pregunta:<id>». */
export function agregarRespuestas(form: FormData, valores: Record<string, Valor>): Record<string, unknown> {
  const respuestas: Record<string, unknown> = {}
  for (const [id, v] of Object.entries(valores)) {
    if (v instanceof File) form.append(`archivo:pregunta:${id}`, v)
    else if (v !== undefined) respuestas[id] = v
  }
  return respuestas
}

/** Una respuesta guardada, en el panel: los archivos se abren con su enlace. */
export function ValorRespuesta({ r, href }: { r: { tipo?: string; valor: string }; href?: string }) {
  if (r.tipo === 'archivo' && href) {
    return <a className="inline-flex items-center gap-1 font-semibold text-brand hover:underline" href={`${API_URL}${href}`} target="_blank" rel="noreferrer"><FileText size={13} />{r.valor.split('/').pop()?.replace(/^[0-9a-f]{8}_/, '')}</a>
  }
  return <span className="whitespace-pre-line">{r.valor}</span>
}

/** Paleta sugerida para el color de los formularios. */
export const COLORES = ['', '#1d4ed8', '#0f766e', '#7c3aed', '#be123c', '#c2410c', '#15803d', '#0f172a']

export function SelectorColor({ valor, onChange }: { valor: string; onChange: (c: string) => void }) {
  const [libre, setLibre] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {COLORES.map(c => (
        <button key={c || 'base'} type="button" title={c || 'Color del sitio'} aria-label={c ? `Color ${c}` : 'Color del sitio'} aria-pressed={valor === c}
          onClick={() => onChange(c)}
          className={`size-8 cursor-pointer rounded-lg border-2 transition ${valor === c ? 'border-ink ring-2 ring-brand-100' : 'border-white shadow-card'}`}
          style={{ background: c || 'linear-gradient(135deg,#06123a 50%,#c6f432 50%)' }} />
      ))}
      <button type="button" className="cursor-pointer text-xs font-semibold text-brand hover:underline" onClick={() => setLibre(!libre)}>Otro…</button>
      {libre && <input type="color" aria-label="Elegir otro color" className="h-8 w-12 cursor-pointer rounded" value={valor || '#1d4ed8'} onChange={e => onChange(e.target.value)} />}
    </div>
  )
}
