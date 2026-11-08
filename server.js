'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = __dirname, PUBLIC = path.join(ROOT,'public');
const envPath=path.join(ROOT,'.env');
if(fs.existsSync(envPath)) for(const line of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){const m=line.match(/^([A-Z_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2];}
const PORT=Number(process.env.PORT)||3000, MAX=Math.max(2,Math.min(12,Number(process.env.MAX_ROOM_SIZE)||8));
const rooms=new Map(), guests=new Map();
const now=()=>new Date().toISOString();
const send=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(status===204?'':JSON.stringify(obj));};
const cleanName=v=>String(v||'Guest').trim().slice(0,60)||'Guest';
const cleanMedia=v=>({audio:!!(v&&v.audio),video:!!(v&&v.video),screen:!!(v&&v.screen)});
const push=(p,type,data)=>{if(p.queue.length<250)p.queue.push({type,data});};
const broadcast=(room,type,data,except)=>{for(const [id,p] of room.participants)if(id!==except)push(p,type,data);};
const roomCode=()=>{const s=crypto.randomBytes(7).toString('hex').slice(0,10);return `${s.slice(0,3)}-${s.slice(3,7)}-${s.slice(7,10)}`;};
function remove(roomId,id){const r=rooms.get(roomId);if(!r||!r.participants.has(id))return;r.participants.delete(id);broadcast(r,'user-left',{clientId:id});if(!r.participants.size)rooms.delete(roomId);}
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>2500000)throw Error('Request too large');}try{return data?JSON.parse(data):{};}catch{throw Error('Invalid JSON');}}
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,'http://localhost');const route=u.pathname;
  if(!route.startsWith('/api/')){
   let rel=route==='/'?'index.html':decodeURIComponent(route).replace(/^\/+/, '');let f=path.resolve(PUBLIC,rel);
   if(!f.startsWith(PUBLIC+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile())f=path.join(PUBLIC,'index.html');
   res.writeHead(200,{'Content-Type':(mime[path.extname(f)]||'application/octet-stream'),'X-Content-Type-Options':'nosniff'});if(req.method==='HEAD')return res.end();return fs.createReadStream(f).pipe(res);
  }
  const id=String(req.headers['x-guest-id']||'');
  if(!/^[a-f0-9-]{36}$/i.test(id))return send(res,401,{error:'Guest identity missing. Reload the page.'});
  let user=guests.get(id);
  if(route==='/api/guest'&&req.method==='POST'){
   const b=await body(req);user={id,name:cleanName(b.name),email:'@dexa',avatar:''};guests.set(id,user);return send(res,200,{user});
  }
  if(!user)return send(res,401,{error:'Guest session expired. Reload the page.'});
  if(route==='/api/me'&&req.method==='GET')return send(res,200,{user,accounts:[user]});
  if(route==='/api/config'&&req.method==='GET'){
   const iceServers=[{urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}];
   if(process.env.TURN_URL&&process.env.TURN_USERNAME&&process.env.TURN_CREDENTIAL)iceServers.push({urls:process.env.TURN_URL.split(','),username:process.env.TURN_USERNAME,credential:process.env.TURN_CREDENTIAL});
   return send(res,200,{iceServers,maxRoomSize:MAX});
  }
  if(route==='/api/profile'&&req.method==='POST'){
   const b=await body(req);user.name=cleanName(b.name);
   if(b.removeAvatar)user.avatar='';
   if(b.avatarData){const m=String(b.avatarData).match(/^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/);if(!m||m[2].length>2000000)return send(res,400,{error:'Invalid avatar'});user.avatar=b.avatarData;}
   for(const r of rooms.values())for(const p of r.participants.values())if(p.guestId===id)p.user={...user};
   return send(res,200,{user,accounts:[user]});
  }
  if(route==='/api/meetings'&&req.method==='POST')return send(res,201,{roomId:roomCode()});
  const match=route.match(/^\/api\/rooms\/([^/]+)\/(join|events|signal|broadcast|leave)$/);
  if(!match)return send(res,404,{error:'API route not found'});
  const roomId=match[1],action=match[2];if(!/^[a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}$/i.test(roomId))return send(res,400,{error:'Invalid meeting code'});
  const b=req.method==='GET'?{}:await body(req);
  if(action==='join'&&req.method==='POST'){
   let r=rooms.get(roomId);if(!r){r={participants:new Map()};rooms.set(roomId,r);}
   if(r.participants.size>=MAX)return send(res,409,{error:'This meeting is full'});
   const clientId=crypto.randomUUID();const peers=[...r.participants].map(([clientId,p])=>({clientId,user:p.user,media:p.media}));
   const media=cleanMedia(b.media);r.participants.set(clientId,{guestId:id,user:{...user},media,queue:[],lastSeen:Date.now()});
   broadcast(r,'user-joined',{clientId,user,media},clientId);return send(res,200,{ok:true,clientId,peers});
  }
  const clientId=String(req.method==='GET'?u.searchParams.get('clientId')||'':b.clientId||'');
  const r=rooms.get(roomId),p=r?.participants.get(clientId);
  if(!p||p.guestId!==id)return send(res,404,{error:'Meeting session not found'});
  p.lastSeen=Date.now();
  if(action==='events'&&req.method==='GET'){
   const deadline=Date.now()+20000;
   const poll=()=>{if(res.destroyed)return;if(!rooms.get(roomId)?.participants.has(clientId))return send(res,404,{error:'Meeting ended'});if(p.queue.length||Date.now()>=deadline)return send(res,200,{events:p.queue.splice(0,100),participants:r.participants.size});setTimeout(poll,75);};return poll();
  }
  if(action==='signal'&&req.method==='POST'){
   const target=r.participants.get(String(b.target||''));if(!target||!['webrtc-offer','webrtc-answer','webrtc-ice-candidate'].includes(b.type))return send(res,400,{error:'Invalid signal'});
   push(target,b.type,{from:clientId,payload:b.payload,user:p.user});return send(res,202,{ok:true});
  }
  if(action==='broadcast'&&req.method==='POST'){
   const data=b.data||{};
   if(b.event==='chat-message'){const text=String(data.text||'').trim().slice(0,1000);if(!text)return send(res,400,{error:'Message is empty'});const message={id:crypto.randomUUID(),user:p.user,text,sentAt:now()};broadcast(r,'chat-message',message,clientId);return send(res,202,{ok:true,message});}
   if(b.event==='reaction'){if(!['👍','👏','❤️','😂','🎉','✋'].includes(data.emoji))return send(res,400,{error:'Invalid reaction'});broadcast(r,'reaction',{clientId,user:p.user,emoji:data.emoji});}
   else if(b.event==='media-state'){p.media=cleanMedia(data);broadcast(r,'media-state',{clientId,media:p.media},clientId);}
   else if(b.event==='profile-update'){p.user={...user};broadcast(r,'profile-update',{clientId,user:p.user},clientId);}
   else return send(res,400,{error:'Invalid broadcast event'});
   return send(res,202,{ok:true});
  }
  if(action==='leave'&&req.method==='POST'){remove(roomId,clientId);return send(res,204,null);}
  send(res,405,{error:'Method not allowed'});
 }catch(e){send(res,e.message==='Request too large'?413:400,{error:e.message||'Bad request'});}
});
setInterval(()=>{for(const [roomId,r] of rooms)for(const [id,p] of r.participants)if(Date.now()-p.lastSeen>90000)remove(roomId,id);},30000).unref();
server.listen(PORT,()=>console.log(`DEXA Meeting running at http://localhost:${PORT}`));
