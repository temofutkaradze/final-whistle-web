import {createRequire} from 'node:module';
import {afterEach,expect,it,vi} from 'vitest';
const require=createRequire(import.meta.url);
const createBrowserRuntime=require('../render/runtime/browser.js');
afterEach(()=>vi.unstubAllEnvs());
it('requires sandboxing, omits credentials from browser children, and never falls back',async()=>{
 vi.stubEnv('DATABASE_URL','postgresql://private:private@private/db');vi.stubEnv('APP_SECRET','private-test-secret');
 const launch=vi.fn(async(_options:any)=>{throw Error('sandbox failed');});
 const runtime=createBrowserRuntime({chromium:{launch}});
 await expect(runtime.getBrowser()).rejects.toThrow('sandbox failed');
 const options=launch.mock.calls[0]?.[0] as any;
 expect(options.chromiumSandbox).toBe(true);expect(options.env).not.toHaveProperty('DATABASE_URL');expect(options.env).not.toHaveProperty('APP_SECRET');expect(launch).toHaveBeenCalledOnce();
});
