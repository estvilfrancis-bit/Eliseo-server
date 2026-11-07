import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const KEY=process.env.ANTHROPIC_API_KEY;
const PASSWORD=process.env.APP_PASSWORD;
const MODEL=process.env.MODEL || 'claude-sonnet-5-5';
const PORT=process.env.PORT || 3000;
if(!KEY || !PASSWORD){console.error('Falta configurar ANTHROPIC_API_KEY o APP_PASSWORD.');process.exit(1)}
const SYSTEM=`Eres el asistente de Eliseo SERVER, experto en reparar y hacer root a teléfonos (Android y iPhone) y computadoras (Windows, Linux y Mac). Explicas paso a paso, con lenguaje simple y respuestas breves. Antes de cualquier proceso de root, desbloqueo de bootloader o cambio de sistema, avisas de hacer copia de seguridad, de que puede anular la garantía y de que hay riesgo de dejar el equipo inservible. Pides modelo exacto y versión del sistema si hacen falta. Solo ayudas con dispositivos propios, nunca con equipos robados o para saltar bloqueos de cuentas ajenas. Respondes siempre en el idioma del usuario.`;
const hits=[];
function permitted(req){
  const header=req.headers.authorization || '';
  if(!header.startsWith('Basic '))return false;
  const text=Buffer.from(header.slice(6),'base64').toString('utf8');
  const colon=text.indexOf(':');if(colon<0)return false;
  const given=Buffer.from(text.slice(colon+1));const expected=Buffer.from(PASSWORD);
  return given.length===expected.length && timingSafeEqual(given,expected);
}
function error(res,status,message){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify({error:message}))}
async function chat(req,res){
  const now=Date.now();while(hits.length&&hits[0]<now-60000)hits.shift();
  if(hits.length>=15)return error(res,429,'Demasiados mensajes seguidos. Espera un momento.');hits.push(now);
  let body='';for await(const c of req){body+=c;if(body.length>200000)return error(res,413,'Mensaje demasiado largo.');}
  let messages;try{messages=JSON.parse(body).messages}catch{return error(res,400,'No se pudo leer el mensaje.')}
  if(!Array.isArray(messages))return error(res,400,'Conversación inválida.');
  messages=messages.slice(-30).filter(m=>m&&(m.role==='user'||m.role==='assistant')&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,4000)}));
  if(!messages.length||messages[0].role!=='user'||messages.at(-1).role!=='user')return error(res,400,'Conversación inválida.');
  try{
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL,max_tokens:1024,system:SYSTEM,messages,stream:true}),signal:AbortSignal.timeout(90000)});
    if(!r.ok){console.error('Error del proveedor:',r.status);return error(res,502,'No se pudo conectar con la IA. Revisa la clave, el saldo y el modelo configurado.')}
    res.writeHead(200,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
    const decoder=new TextDecoder();let buffer='';
    for await(const chunk of r.body){
      buffer+=decoder.decode(chunk,{stream:true}).replace(/\r\n/g,'\n');let pos;
      while((pos=buffer.indexOf('\n\n'))!==-1){const event=buffer.slice(0,pos);buffer=buffer.slice(pos+2);const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;
        try{const m=JSON.parse(data);if(m.type==='content_block_delta'&&m.delta?.type==='text_delta')res.write(m.delta.text);if(m.type==='error')console.error('Error en respuesta de IA');}catch{}
      }
    }
    res.end();
  }catch(e){console.error('Error al responder:',e.message);if(!res.headersSent)error(res,502,'No se pudo conectar con la IA. Intenta otra vez.');else res.end()}
}
http.createServer((req,res)=>{
  if(!permitted(req)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Eliseo SERVER", charset="UTF-8"','cache-control':'no-store'});return res.end('Acceso protegido')}
  if(req.method==='POST'&&req.url==='/api/chat'){chat(req,res).catch(e=>{console.error(e.message);if(!res.headersSent)error(res,500,'Error del servidor.');else res.end()});return}
  if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});fs.createReadStream(path.join(dir,'index.html')).pipe(res);return}
  res.writeHead(404);res.end();
}).listen(PORT,'0.0.0.0',()=>console.log('Eliseo SERVER listo'));
