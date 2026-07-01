require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const RUC = '20612784192';
const PERIOD = '202606';
const COMPANY_ID = 8;
const BRANCH_ID = 8;
const CSV_FILE = process.env.BH_JUNE_CSV
  || '/Users/ylaurach/Library/CloudStorage/OneDrive2-Personal/zentoo/SELLERS/BEAUTY HOME/JUNIO/28:06:2026/LE206127841922026060014040001EXP2.csv';
const OUT_DIR = path.resolve('reports/beauty-home-junio-2026');

function parseCsv(text){const rows=[];let row=[],field='',q=false;for(let i=0;i<text.length;i++){const ch=text[i],nx=text[i+1];if(ch==='"'){if(q&&nx==='"'){field+='"';i++;}else q=!q;}else if(ch===','&&!q){row.push(field);field='';}else if((ch==='\n'||ch==='\r')&&!q){if(ch==='\r'&&nx==='\n')i++;row.push(field);if(row.some(v=>v!==''))rows.push(row);row=[];field='';}else field+=ch;}if(field||row.length){row.push(field);if(row.some(v=>v!==''))rows.push(row);}return rows;}
const nh=v=>String(v||'').replace(/^﻿/,'').trim();
const toIso=v=>{const m=String(v||'').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);return m?`${m[3]}-${m[2]}-${m[1]}`:String(v||'').trim();};
const nn=v=>String(v||'').trim().replace(/\D/g,'').padStart(6,'0');
const num=v=>{const p=Number(String(v||'0').replace(/,/g,''));return Number.isFinite(p)?p:0;};
const absNum=v=>Math.abs(num(v));
const money=v=>Number(v||0).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2});

function parseRows(){
  const t=parseCsv(fs.readFileSync(CSV_FILE,'utf8'));const h=t[0].map(nh);
  return t.slice(1).map(c=>Object.fromEntries(h.map((x,i)=>[x,c[i]||''])))
    .filter(r=>String(r.Ruc).trim()===RUC&&String(r.Periodo).trim()===PERIOD)
    .filter(r=>String(r['Tipo CP/Doc.']||'').padStart(2,'0')==='03')
    .filter(r=>String(r['Serie del CDP']||'').trim()==='EB01')
    .map(r=>{const serie='EB01',correlativo=nn(r['Nro CP o Doc. Nro Inicial (Rango)']);return{
      serie,correlativo,numeroCompleto:`${serie}-${correlativo}`,fechaEmision:toIso(r['Fecha de emisión']),
      tipoDocumentoCliente:String(r['Tipo Doc Identidad']||'').trim()||'0',numeroDocumentoCliente:String(r['Nro Doc Identidad']||'').trim()||'-',
      cliente:String(r['Apellidos Nombres/ Razón Social']||'').trim()||'-',
      valorVenta:absNum(r['BI Gravada'])+absNum(r['Mto Exonerado'])+absNum(r['Mto Inafecto'])+absNum(r['Valor Facturado Exportación']),
      mtoOperGravadas:absNum(r['BI Gravada']),mtoOperExoneradas:absNum(r['Mto Exonerado']),mtoOperInafectas:absNum(r['Mto Inafecto']),
      mtoIgv:absNum(r['IGV / IPM']),mtoIsc:absNum(r.ISC),mtoIcbper:absNum(r.ICBPER),
      totalImpuestos:absNum(r['IGV / IPM'])+absNum(r.ISC)+absNum(r.ICBPER),
      subTotal:absNum(r['BI Gravada'])+absNum(r['Mto Exonerado'])+absNum(r['Mto Inafecto'])+absNum(r['Valor Facturado Exportación']),
      mtoImpVenta:absNum(r['Total CP']),moneda:String(r.Moneda||'PEN').trim()||'PEN',estadoComp:String(r['Est. Comp']||'').trim()};});
}
function buildDetail(row){const base=row.valorVenta||Math.max(0,row.mtoImpVenta-row.totalImpuestos);const pig=row.mtoIgv>0&&row.mtoOperGravadas>0?Math.round((row.mtoIgv/row.mtoOperGravadas)*10000)/100:0;return[{codigo:row.numeroCompleto,descripcion:'Comprobante EB01 (contingencia, emitido manualmente) importado de SUNAT junio 2026 BEAUTY HOME',unidad:'NIU',cantidad:1,mto_valor_unitario:Math.round(base*100)/100,porcentaje_igv:pig,tip_afe_igv:row.mtoOperGravadas>0?'10':row.mtoOperExoneradas>0?'20':'30'}];}
async function getOrCreateClient(client,row){const e=await client.query(`select id from clients where company_id=$1 and tipo_documento=$2 and numero_documento=$3 limit 1`,[COMPANY_ID,row.tipoDocumentoCliente,row.numeroDocumentoCliente]);if(e.rows[0])return e.rows[0].id;const now=Math.floor(Date.now()/1000);const i=await client.query(`insert into clients (company_id,tipo_documento,numero_documento,razon_social,activo,created_at,updated_at) values ($1,$2,$3,$4,true,$5,$5) returning id`,[COMPANY_ID,row.tipoDocumentoCliente,row.numeroDocumentoCliente,row.cliente,now]);return i.rows[0].id;}
async function findExisting(client,numeroCompleto){const r=await client.query(`select b.id from boletas b join companies c on c.id=b.company_id where c.ruc=$1 and b.tipo_documento='03' and b.numero_completo=$2 limit 1`,[RUC,numeroCompleto]);return r.rows[0]||null;}
async function insertBoleta(client,row){
  const ex=await findExisting(client,row.numeroCompleto);if(ex)return{action:'skip_existing',id:ex.id,...row};
  const clientId=await getOrCreateClient(client,row);const now=Math.floor(Date.now()/1000);const estadoSunat=row.estadoComp==='2'?'ANULADO':'ACEPTADO';
  const r=await client.query(`insert into boletas (company_id,branch_id,client_id,tipo_documento,serie,correlativo,numero_completo,order_number,fecha_emision,ubl_version,tipo_operacion,moneda,metodo_envio,valor_venta,mto_oper_gravadas,mto_oper_exoneradas,mto_oper_inafectas,mto_oper_gratuitas,mto_igv_gratuitas,mto_igv,mto_base_ivap,mto_ivap,mto_isc,mto_icbper,total_impuestos,sub_total,mto_imp_venta,detalles,datos_adicionales,estado_sunat,respuesta_sunat,usuario_creacion,created_at,updated_at) values ($1,$2,$3,'03',$4,$5,$6,null,$7,'2.1','0101',$8,'sunat_import',$9,$10,$11,$12,'0','0',$13,'0','0',$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22,'sistema:importacion-sunat-beauty-home-eb01-junio-2026',$23,$23) returning id`,
    [COMPANY_ID,BRANCH_ID,clientId,row.serie,row.correlativo,row.numeroCompleto,row.fechaEmision,row.moneda,row.valorVenta,row.mtoOperGravadas,row.mtoOperExoneradas,row.mtoOperInafectas,row.mtoIgv,row.mtoIsc,row.mtoIcbper,row.totalImpuestos,row.subTotal,row.mtoImpVenta,JSON.stringify(buildDetail(row)),JSON.stringify({source:'SUNAT CSV junio 2026',ruc:RUC,periodo:PERIOD,csvFile:CSV_FILE,contingencia:true,estadoComp:row.estadoComp}),estadoSunat,JSON.stringify({source:'SUNAT CSV',estadoComp:row.estadoComp}),now]);
  return{action:'inserted',id:r.rows[0].id,...row};
}
async function main(){
  if(!process.env.DATABASE_URL_POSTGRES)throw new Error('Missing DATABASE_URL_POSTGRES');
  fs.mkdirSync(OUT_DIR,{recursive:true});const rows=parseRows();
  const pool=new Pool({connectionString:process.env.DATABASE_URL_POSTGRES});const client=await pool.connect();const results=[];
  try{await client.query('begin');for(const row of rows)results.push(await insertBoleta(client,row));await client.query('commit');}
  catch(e){await client.query('rollback');throw e;}finally{client.release();await pool.end();}
  const ins=results.filter(r=>r.action==='inserted');const sk=results.filter(r=>r.action==='skip_existing');
  const lines=['# Registro EB01 (contingencia) BEAUTY HOME junio 2026','',`Generado: ${new Date().toISOString()}`,`CSV: \`${CSV_FILE}\``,'',
   '| Resultado | Cantidad | Total |','| --- | ---: | ---: |',
   `| EB01 en CSV | ${rows.length} | S/ ${money(results.reduce((s,r)=>s+Number(r.mtoImpVenta||0),0))} |`,
   `| Insertadas | ${ins.length} | S/ ${money(ins.reduce((s,r)=>s+Number(r.mtoImpVenta||0),0))} |`,
   `| Ya existian | ${sk.length} | |`,'',
   ...ins.map(r=>`- ${r.numeroCompleto} | S/ ${money(r.mtoImpVenta)} | emis ${r.fechaEmision}`)];
  fs.writeFileSync(path.join(OUT_DIR,'registro_eb01_beauty_home_junio.md'),`${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}
main().catch(e=>{console.error(e);process.exit(1);});
