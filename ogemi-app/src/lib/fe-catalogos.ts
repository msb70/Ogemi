/**
 * Catálogos del PAC TheFactory Panamá (CFE Premium Soft)
 * Fuente: Manual de Integración Panamá TheFactory (02/07/2026)
 */

export const FE_TIPO_DOC: { codigo: string; nombre: string; grupo: 'factura' | 'nc' | 'nd' | 'otro' }[] = [
  { codigo: '01', nombre: 'Factura de operación interna', grupo: 'factura' },
  { codigo: '02', nombre: 'Factura de importación', grupo: 'factura' },
  { codigo: '03', nombre: 'Factura de exportación', grupo: 'factura' },
  { codigo: '04', nombre: 'Nota de crédito referente a una FE', grupo: 'nc' },
  { codigo: '05', nombre: 'Nota de débito referente a una FE', grupo: 'nd' },
  { codigo: '06', nombre: 'Nota de crédito genérica', grupo: 'nc' },
  { codigo: '07', nombre: 'Nota de débito genérica', grupo: 'nd' },
  { codigo: '08', nombre: 'Factura de zona franca', grupo: 'factura' },
  { codigo: '09', nombre: 'Reembolso', grupo: 'otro' },
  { codigo: '10', nombre: 'Factura de operación extranjera', grupo: 'factura' },
]

export const FE_TIPO_CONTRIBUYENTE = [
  { codigo: 1, nombre: 'Natural' },
  { codigo: 2, nombre: 'Jurídico' },
]

export const FE_TIPO_CLIENTE = [
  { codigo: '01', nombre: 'Contribuyente' },
  { codigo: '02', nombre: 'Consumidor final' },
  { codigo: '03', nombre: 'Gobierno' },
  { codigo: '04', nombre: 'Extranjero' },
]

/** Tasas ITBMS permitidas (prc_impuesto) */
export const FE_ITBMS = [
  { pct: 0, nombre: 'Exento (0%)' },
  { pct: 7, nombre: 'General (7%)' },
  { pct: 10, nombre: 'Incrementado (10%)' },
  { pct: 15, nombre: 'Incrementado (15%)' },
]

export const FE_FORMAS_PAGO = [
  { codigo: '01', nombre: 'NOTA DE CREDITO' },
  { codigo: '02', nombre: 'EFECTIVO' },
  { codigo: '03', nombre: 'TARJETA CREDITO' },
  { codigo: '04', nombre: 'TARJETA DEBITO' },
  { codigo: '05', nombre: 'TARJETA DE FIDELIZACION' },
  { codigo: '06', nombre: 'VALE' },
  { codigo: '07', nombre: 'TARJETA DE REGALO' },
  { codigo: '99', nombre: 'OTRO' },
]

export const FE_RETENCIONES = [
  { codigo: '1', nombre: 'Pago por servicio profesional al estado 100%' },
  { codigo: '2', nombre: 'Pago por venta de bienes / servicios al estado 50%' },
  { codigo: '3', nombre: 'Pago a no domiciliado o empresa del exterior 100%' },
  { codigo: '4', nombre: 'Pago por compra de bienes / servicios 50%' },
  { codigo: '7', nombre: 'Pago a comercio afiliado a sistema TC/TD 50%' },
  { codigo: '8', nombre: 'Otros (disminución de la retención)' },
]

/** Unidades de medida comunes (el catálogo completo está en el manual del PAC) */
export const FE_UNIDADES = [
  { codigo: 'und', nombre: 'Unidad' },
  { codigo: 'srv', nombre: 'Servicio' },
  { codigo: 'kg', nombre: 'Kilogramo' },
  { codigo: 'lb', nombre: 'Libra' },
  { codigo: 'ltr', nombre: 'Litro' },
  { codigo: 'gal', nombre: 'Galón' },
  { codigo: 'm', nombre: 'Metro' },
  { codigo: 'm2', nombre: 'Metro cuadrado' },
  { codigo: 'doc', nombre: 'Docena' },
  { codigo: 'cja', nombre: 'Caja' },
  { codigo: 'par', nombre: 'Par' },
  { codigo: 'rollo', nombre: 'Rollo' },
  { codigo: 'pqt', nombre: 'Paquete' },
  { codigo: 'jgo', nombre: 'Juego' },
  { codigo: 'hr', nombre: 'Hora' },
]

/** Grupos CPBS abreviados (grupo_inv) — códigos de bienes y servicios DGI */
export const FE_CPBS_GRUPOS = [
  { codigo: '10', nombre: 'Material vivo vegetal y animal, accesorios y suministros' },
  { codigo: '11', nombre: 'Material mineral, textil y vegetal/animal no comestible' },
  { codigo: '12', nombre: 'Material químico, bioquímicos y materiales de gas' },
  { codigo: '13', nombre: 'Materiales de resina, caucho, espuma, película y elastómeros' },
  { codigo: '14', nombre: 'Materiales y productos de papel' },
  { codigo: '15', nombre: 'Combustibles, aditivos, lubricantes y anticorrosivos' },
  { codigo: '20', nombre: 'Maquinaria de minería y perforación de pozos' },
  { codigo: '21', nombre: 'Maquinaria agrícola, pesca, silvicultura y fauna' },
  { codigo: '22', nombre: 'Maquinaria para construcción y edificación' },
  { codigo: '23', nombre: 'Maquinaria para manufactura y procesamiento industrial' },
  { codigo: '24', nombre: 'Maquinaria para manejo y almacenamiento de materiales' },
  { codigo: '25', nombre: 'Vehículos, accesorios y componentes' },
  { codigo: '26', nombre: 'Maquinaria para generación y distribución de energía' },
  { codigo: '27', nombre: 'Herramientas y maquinaria general' },
  { codigo: '30', nombre: 'Componentes para estructuras, construcción y obras civiles' },
  { codigo: '31', nombre: 'Componentes y suministros de manufactura' },
  { codigo: '32', nombre: 'Componentes y suministros electrónicos' },
  { codigo: '39', nombre: 'Sistemas eléctricos e iluminación' },
  { codigo: '40', nombre: 'Distribución y sistemas de acondicionamiento' },
  { codigo: '41', nombre: 'Equipos de laboratorio, medición y pruebas' },
  { codigo: '42', nombre: 'Equipo médico, accesorios y suministros' },
  { codigo: '43', nombre: 'Tecnologías de información y telecomunicaciones' },
  { codigo: '44', nombre: 'Equipos de oficina, accesorios y suministros' },
  { codigo: '45', nombre: 'Equipos para impresión, fotografía y audiovisuales' },
  { codigo: '46', nombre: 'Defensa, orden público, protección y seguridad' },
  { codigo: '47', nombre: 'Equipos de limpieza y suministros' },
  { codigo: '48', nombre: 'Maquinaria para la industria de servicios' },
  { codigo: '49', nombre: 'Deportes y recreación' },
  { codigo: '50', nombre: 'Alimentos, bebidas y tabaco' },
  { codigo: '51', nombre: 'Medicamentos y productos farmacéuticos' },
  { codigo: '52', nombre: 'Artículos domésticos y electrónica de consumo' },
  { codigo: '53', nombre: 'Ropa, maletas y aseo personal' },
  { codigo: '54', nombre: 'Relojería, joyería y piedras preciosas' },
  { codigo: '55', nombre: 'Publicaciones impresas y electrónicas' },
  { codigo: '56', nombre: 'Muebles, mobiliario y decoración' },
  { codigo: '60', nombre: 'Instrumentos musicales, juegos, artes y equipo educativo' },
  { codigo: '70', nombre: 'Servicios agrícolas, pesqueros, forestales y de fauna' },
  { codigo: '71', nombre: 'Servicios de minería, petróleo y gas' },
  { codigo: '72', nombre: 'Construcción, edificación y mantenimiento' },
  { codigo: '73', nombre: 'Producción industrial y manufactura' },
  { codigo: '76', nombre: 'Limpieza, descontaminación y tratamiento de residuos' },
  { codigo: '77', nombre: 'Servicios medioambientales' },
  { codigo: '78', nombre: 'Transporte, almacenaje y correo' },
  { codigo: '80', nombre: 'Gestión, servicios profesionales y administrativos' },
  { codigo: '81', nombre: 'Ingeniería, investigación y tecnología' },
  { codigo: '82', nombre: 'Servicios editoriales, diseño, artes gráficas y bellas artes' },
  { codigo: '83', nombre: 'Servicios públicos y del sector público' },
  { codigo: '84', nombre: 'Servicios financieros y de seguros' },
  { codigo: '85', nombre: 'Servicios de salud' },
  { codigo: '86', nombre: 'Servicios educativos y de formación' },
  { codigo: '90', nombre: 'Viajes, alimentación, alojamiento y entretenimiento' },
  { codigo: '91', nombre: 'Servicios personales y domésticos' },
  { codigo: '92', nombre: 'Defensa nacional, orden público y seguridad' },
  { codigo: '93', nombre: 'Servicios políticos y asuntos cívicos' },
  { codigo: '94', nombre: 'Organizaciones y clubes' },
  { codigo: '95', nombre: 'Terrenos, edificios, estructuras y vías' },
]

/** Parsea la respuesta del PAC: tipo|mensaje|cufe|fecha_cufe|url_dgi */
export function parseRespuestaPAC(texto: string) {
  const partes = (texto || '').split('|')
  const tipo = parseInt(partes[0], 10)
  return {
    tipo: isNaN(tipo) ? 1 : tipo, // 0=informativo, 1=error, 2=éxito
    mensaje: partes[1]?.trim() || texto || 'Sin respuesta del PAC',
    cufe: partes[2]?.trim() || null,
    fecha_cufe: partes[3]?.trim() || null,
    url_dgi: partes[4]?.trim() || null,
  }
}
