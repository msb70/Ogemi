const XLSX=require('xlsx'); const ts=require('typescript'); const fs=require('fs');
const src=fs.readFileSync('src/lib/excel-parser.ts','utf8');
const js=ts.transpileModule(src,{compilerOptions:{module:'commonjs',target:'es2019'}}).outputText;
const m={exports:{}}; new Function('module','exports','require',js)(m,m.exports,require);
const ab=new Uint8Array(fs.readFileSync('/sessions/busy-hopeful-gauss/mnt/uploads/Libro de Venta hasta Junio 2026.xlsx')).buffer;
const rows=m.exports.parseLibroVentas(ab);
const q=s=>"'"+String(s).replace(/'/g,"''")+"'";
const fd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const names=[...new Set(rows.map(r=>r.nombre_cliente.trim()))];
let sql='BEGIN;\n';
// crear clientes faltantes (sin duplicar por mayúsculas)
sql+='INSERT INTO public.clientes (nombre, dias_credito)\nSELECT n, 30 FROM (VALUES\n'+
  names.map(n=>'('+q(n)+')').join(',\n')+
'\n) AS t(n)\nWHERE NOT EXISTS (SELECT 1 FROM public.clientes c WHERE upper(c.nombre)=upper(t.n));\n';
sql+='DELETE FROM public.facturas;\n';
// insertar facturas
sql+='INSERT INTO public.facturas (numero_factura, fecha, cliente_id, tipo_documento, documento_afectado, monto, itbms, total, estado)\nSELECT v.nf, v.f::date, c.id, v.td, NULLIF(v.da,\'\')::int, v.monto, v.itbms, v.total, \'pendiente\'\nFROM (VALUES\n';
sql+=rows.map(r=>`(${r.numero_factura}, ${q(fd(r.fecha))}, ${q(r.nombre_cliente.trim())}, ${q(r.tipo_documento)}, ${q(r.documento_afectado==null?'':r.documento_afectado)}, ${r.neto}, ${r.impuesto}, ${r.total})`).join(',\n');
sql+='\n) AS v(nf,f,nombre,td,da,monto,itbms,total)\nJOIN public.clientes c ON upper(c.nombre)=upper(v.nombre);\nCOMMIT;\n';
fs.writeFileSync('/sessions/busy-hopeful-gauss/mnt/outputs/reimport.sql',sql);
console.log('filas:',rows.length,'| clientes distintos:',names.length,'| bytes SQL:',sql.length);
