/** Abre un borrador en el Outlook (o el cliente de correo) predeterminado del equipo, sin enviar nada. */
export type Correo = { para: string; cc?: string; asunto: string; cuerpo: string }

// Por encima de ~2000 caracteres algunos clientes recortan o ignoran el enlace mailto.
const LIMITE_URL = 1900

const direcciones = (s: string) => s.split(/[,;]/).map(x => x.trim()).filter(Boolean).join(',')

export function mailtoUrl(c: Correo, cuerpo = c.cuerpo): string {
  const partes = [`subject=${encodeURIComponent(c.asunto)}`, `body=${encodeURIComponent(cuerpo.replace(/\r?\n/g, '\r\n'))}`]
  const cc = direcciones(c.cc ?? '')
  if (cc) partes.unshift(`cc=${encodeURIComponent(cc)}`)
  return `mailto:${encodeURIComponent(direcciones(c.para)).replace(/%2C/g, ',').replace(/%40/g, '@')}?${partes.join('&')}`
}

// Más allá de esto las direcciones no caben en el enlace: se abre el borrador sin ellas y se copian para pegarlas en «Para».
const LIMITE_DESTINATARIOS = 900

export type Abierto = { recortado: boolean; destinatariosCopiados: boolean }

/** Abre el borrador. Si no cabe en un mailto, lo recorta y deja lo que falta en el portapapeles. */
export async function abrirEnOutlook(c: Correo): Promise<Abierto> {
  const destinatariosCopiados = encodeURIComponent(`${direcciones(c.para)},${direcciones(c.cc ?? '')}`).length > LIMITE_DESTINATARIOS
  const base = destinatariosCopiados ? { ...c, para: '', cc: '' } : c
  let cuerpo = c.cuerpo
  let url = mailtoUrl(base, cuerpo)
  const recortado = url.length > LIMITE_URL
  const portapapeles = destinatariosCopiados ? [direcciones(c.para), direcciones(c.cc ?? '')].filter(Boolean).join(',').replaceAll(',', '; ') : c.cuerpo
  if (recortado || destinatariosCopiados) {
    try { await navigator.clipboard.writeText(portapapeles) } catch { /* sin permiso de portapapeles */ }
  }
  if (recortado) {
    while (url.length > LIMITE_URL && cuerpo.length > 0) {
      cuerpo = cuerpo.slice(0, Math.floor(cuerpo.length * 0.8))
      url = mailtoUrl(base, `${cuerpo}…

(Mensaje recortado.)`)
    }
  }
  window.location.href = url
  return { recortado, destinatariosCopiados }
}

/** Texto para avisar cuando el borrador no quedó completo en Outlook. */
export function avisoOutlook({ recortado, destinatariosCopiados }: Abierto): string | null {
  if (destinatariosCopiados) return `Son muchos destinatarios: quedaron copiados, pégalos en «Para» (Ctrl+V).${recortado ? ' El mensaje también se recortó.' : ''}`
  return recortado ? 'El mensaje es largo: se recortó en Outlook y el texto completo quedó copiado.' : null
}
