// Copia los decodificadores WASM de pdfjs-dist a public/pdfjs-wasm (misma versión que el paquete).
// pdfjs v6 decodifica imágenes CCITT/JBIG2 (QR en blanco y negro de 1 bit de algunos PAC) y JPEG2000
// con estos módulos; sin ellos la imagen del QR no se dibuja y el escáner de compras no lo encuentra.
import { cpSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist', 'wasm')
const dst = join(root, 'public', 'pdfjs-wasm')
mkdirSync(dst, { recursive: true })
for (const f of readdirSync(src)) {
  if (/^(jbig2|openjpeg|qcms)/.test(f)) cpSync(join(src, f), join(dst, f))
}
console.log('pdfjs wasm copiado a public/pdfjs-wasm')
