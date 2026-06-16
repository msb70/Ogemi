const XLSX=require('xlsx'); const ts=require('typescript'); const fs=require('fs');
const src=fs.readFileSync('src/lib/excel-parser.ts','utf8');
const js=ts.transpileModule(src,{compilerOptions:{module:'commonjs',target:'es2019'}}).outputText;
const m={exports:{}}; new Function('module','exports','require',js)(m,m.exports,require);
const ab=new Uint8Array(fs.readFileSync('/sessions/busy-hopeful-gauss/mnt/uploads/Libro de Venta hasta Junio 2026.xlsx')).buffer;
const rows=m.exports.parseLibroVentas(ab);
console.log('total filas parseadas:', rows.length);
const f=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const pick=n=>rows.filter(r=>r.numero_factura===n);
[19,20,21,25].forEach(n=>pick(n).forEach(r=>console.log('#'+r.numero_factura, f(r.fecha), 'neto='+r.neto, 'itbms='+r.impuesto, 'total='+r.total, '| '+r.nombre_cliente)));
// chequeo global: cuantos total son enteros >=100 (sospechoso x100)
const susp=rows.filter(r=>Number.isInteger(r.total)&&Math.abs(r.total)>=100).length;
console.log('totales enteros>=100 (sospechosos):', susp, '/', rows.length);
// suma de control
console.log('suma neto:', rows.reduce((s,r)=>s+r.neto,0).toFixed(2), '| suma total:', rows.reduce((s,r)=>s+r.total,0).toFixed(2));
// validar neto+itbms ~= total por fila (tolerancia recargos)
let mismatch=rows.filter(r=>Math.abs((r.neto+r.impuesto)-r.total)>0.05).length;
console.log('filas donde neto+itbms != total (>0.05):', mismatch);
