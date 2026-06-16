const XLSX=require('xlsx');
const html=`<table>
<tr><td>EMP</td></tr><tr><td>g</td></tr><tr><td>Emision</td><td>Tipo</td><td>NoDoc</td><td>Af</td><td>Nom</td><td>R</td><td>P</td><td>Neto</td><td>Total</td><td>Ret</td><td>B</td><td>Imp</td></tr>
<tr><td>03/06/2026</td><td>FACTURA</td><td>19</td><td></td><td>CLIENTE</td><td></td><td></td><td>204,31</td><td>218,61</td><td></td><td></td><td>1,43</td></tr>
<tr><td>03/06/2026</td><td>FACTURA</td><td>20</td><td></td><td>CLIENTE</td><td></td><td></td><td>1.836,00</td><td>1.964,52</td><td></td><td></td><td>128,52</td></tr>
</table>`;
const wb=XLSX.read(Buffer.from(html,'utf8'),{type:'buffer',cellDates:true});
const sh=wb.Sheets[wb.SheetNames[0]];
for(const [r,label] of [[3,'fila19'],[4,'fila20']]){
  for(const [c,name] of [[7,'Neto'],[8,'Total'],[11,'Imp']]){
    const cell=sh[XLSX.utils.encode_cell({r,c})];
    console.log(label,name,'=> t:',cell&&cell.t,'v:',JSON.stringify(cell&&cell.v),'w:',JSON.stringify(cell&&cell.w));
  }
}
