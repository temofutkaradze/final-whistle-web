export async function register(){
 if(process.env.NEXT_RUNTIME==='nodejs'){
  const {removeMigrationCredentials}=await import('../scripts/lib/runtime-environment.cjs');
  removeMigrationCredentials();
  const {default:logging}=await import('../scripts/lib/security-log.cjs');
  logging.install();
 }
}
