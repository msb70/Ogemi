const XLSX=require('xlsx');
const f='/sessions/busy-hopeful-gauss/mnt/uploads/Libro de Venta hasta Junio 2026.xlsx';
const wb=XLSX.read(require('fs').readFileSync(f),{type:'buffer',cellDates:true});
const sh=wb.Sheets[wb.SheetNames[0]];
const rng=XLSX.utils.decode_range(sh['!ref']);
console.log('SHEETS:', wb.SheetNames, '| range', sh['!ref']);
for(let r=0;r<=9 && r<=rng.e.r;r++){
  let line=[];
  for(let c=0;c<=rng.e.c;c++){
    const cell=sh[XLSX.utils.encode_cell({r,c})];
    if(cell) line.push(c+':'+cell.t+'='+JSON.stringify(cell.w!==undefined?cell.w:cell.v));
  }
  console.log('r'+r, line.join('  '));
}
