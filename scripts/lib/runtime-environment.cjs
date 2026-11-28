'use strict';
// Defense in depth. Administrative credentials belong only in an explicitly loaded
// .env.migration, never in the runtime .env/Next auto-loaded environment files.
function removeMigrationCredentials(env=process.env){
 for(const key of Object.keys(env))if(/^(MIGRATION_DATABASE_URL|PGPASSWORD|PGPASSFILE)$/i.test(key))delete env[key];
}
function restrictRendererEnvironment(env=process.env){
 const allowed=new Set(['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','SYSTEMDRIVE','TEMP','TMP','TMPDIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA','LANG','LC_ALL','TZ','NODE_ENV','PLAYWRIGHT_BROWSERS_PATH','NEWS_RENDER_SECRET','RENDER_PORT','FW_RENDER_CHILD','FW_STORAGE_MAINTENANCE_MODE','FW_ENFORCE_DELEGATE_QUOTAS']);
 for(const key of Object.keys(env))if(!allowed.has(key.toUpperCase()))delete env[key];
}
module.exports={removeMigrationCredentials,restrictRendererEnvironment};
