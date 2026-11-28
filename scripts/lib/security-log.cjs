'use strict';
const util=require('node:util'),os=require('node:os');
const registered=new Set();
function registerSecret(value){if(typeof value==='string'&&value.length>=8){if(registered.size>=256&&!registered.has(value))registered.delete(registered.values().next().value);registered.add(value);}}
function redact(value){
 let text=String(value??'');
 const secrets=[...registered,...Object.entries(process.env).filter(([key])=>/(SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|API_FOOTBALL_KEY|DATABASE_URL)/i.test(key)).map(([,v])=>v)].filter(v=>v?.length>=8).sort((a,b)=>b.length-a.length);
 for(const secret of secrets)text=text.split(secret).join('[REDACTED]');
 return text.replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi,url=>url.replace(/\/\/[^/@\s]+:[^/@\s]+@/,'//[REDACTED]@').replace(/\/bot\d+:[A-Za-z0-9_-]+/g,'/bot[REDACTED]'))
  .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g,'[BOT_TOKEN]')
  .replace(/\bv1:[A-Za-z0-9+/=]{32,}/g,'[ENCRYPTED_SECRET]')
  .replace(/\bscrypt1\$[a-f\d]+\$[a-f\d]+/gi,'[PASSWORD_HASH]')
  .replace(/(authorization["']?\s*[:=]\s*["']?)(?:Bearer|Basic)\s+[^\s,"'}]+/gi,'$1[REDACTED]')
  .replace(/((?:password(?:hash)?|secret|token(?:hash)?|fw_session|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,'$1[REDACTED]')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[EMAIL]')
  .split(os.homedir()).join('[USER_HOME]').slice(0,65536);
}
function install(){
 if(globalThis[Symbol.for('fw.secureLogs')])return;
 globalThis[Symbol.for('fw.secureLogs')]=true;
 for(const method of ['log','info','warn','error','debug']){
  const original=console[method].bind(console);
  console[method]=(...args)=>original(redact(util.formatWithOptions({depth:4,maxArrayLength:30,getters:false,customInspect:false},...args)));
 }
}
module.exports={redact,registerSecret,install};
