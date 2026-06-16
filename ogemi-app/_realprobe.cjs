const XLSX=require('xlsx');
const wb=XLSX.read(require('fs').readFileSync('../LibroVentas (1) (1).xlsx'),{type:'buffer',cellDates:true});
const sh=wb.Sheets[wb.SheetNames[0]];
const rng=XLSX.utils.decode_range(sh['!ref']);
console.log('range', sh['!ref']);
// imprime filas 2..8 columnas 0..13 con t/v/w
for(let r=2;r<=Math.min(8,rng.e.r);r++){
  let line=[];
  for(let c=0;c<=13;c++){
    const cell=sh[XLSX.utils.encode_cell({r,c})];
    if(cell) line.push(c+':'+cell.t+'='+JSON.stringify(cell.w!==undefined?cell.w:cell.v));
  }
  console.log('r'+r, line.join('  '));
}
