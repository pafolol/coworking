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

/** Abre el borrador. Si no cabe en un mailto, lo recorta y deja el texto completo en el portapapeles. */
export async function abrirEnOutlook(c: Correo): Promise<{ recortado: boolean }> {
  let cuerpo = c.cuerpo
  let url = mailtoUrl(c, cuerpo)
  const recortado = url.length > LIMITE_URL
  if (recortado) {
    try { await navigator.clipboard.writeText(c.cuerpo) } catch { /* sin permiso de portapapeles */ }
    while (url.length > LIMITE_URL && cuerpo.length > 0) {
      cuerpo = cuerpo.slice(0, Math.floor(cuerpo.length * 0.8))
      url = mailtoUrl(c, `${cuerpo}…\n\n(Mensaje recortado: pega aquí el texto completo, ya está copiado.)`)
    }
  }
  window.location.href = url
  return { recortado }
}
