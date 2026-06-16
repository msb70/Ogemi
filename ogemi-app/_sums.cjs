const XLSX=require('xlsx'); const ts=require('typescript'); const fs=require('fs');
const js=ts.transpileModule(fs.readFileSync('src/lib/excel-parser.ts','utf8'),{compilerOptions:{module:'commonjs',target:'es2019'}}).outputText;
const m={exports:{}}; new Function('module','exports','require',js)(m,m.exports,require);
const rows=m.exports.parseLibroVentas(new Uint8Array(fs.readFileSync('/sessions/busy-hopeful-gauss/mnt/uploads/Libro de Venta hasta Junio 2026.xlsx')).buffer);
const sum=k=>rows.reduce((s,r)=>s+r[k],0);
console.log(JSON.stringify({n:rows.length, neto:+sum('neto').toFixed(2), itbms:+sum('impuesto').toFixed(2), total:+sum('total').toFixed(2), sum_nf:rows.reduce((s,r)=>s+r.numero_factura,0)}));
