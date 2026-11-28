// pg's sslmode=require meaning changes across driver versions. Never rely on it.
export function verifiedDatabaseUrl(value){
 if(!value)throw Error('DATABASE_URL is not configured');
 const url=new URL(value);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('Invalid database protocol');
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)){
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('TLS certificate verification must be enabled');
  url.searchParams.delete('uselibpqcompat');
  url.searchParams.set('sslmode','verify-full');
 }
 return url.toString();
}
