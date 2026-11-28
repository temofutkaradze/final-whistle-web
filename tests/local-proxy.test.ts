import {afterEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {proxy} from '../src/proxy';
afterEach(()=>vi.unstubAllEnvs());
it('overwrites forged nonces and gives each local request its own script CSP',()=>{
 vi.stubEnv('NODE_ENV','production');
 const request=()=>new NextRequest('http://localhost:3000/login',{headers:{host:'localhost:3000','x-nonce':'attacker-chosen-nonce','x-forwarded-host':'attacker.invalid','content-security-policy':"script-src *"}});
 const a=proxy(request()),b=proxy(request());const csp=a.headers.get('content-security-policy')!;
 expect(csp).toContain("'nonce-");expect(csp).not.toContain('attacker');expect(csp).not.toContain('unsafe-eval');
 expect(csp).not.toEqual(b.headers.get('content-security-policy'));expect(a.headers.get('x-middleware-request-x-nonce')).not.toBe('attacker-chosen-nonce');
 expect(a.headers.get('x-middleware-request-x-forwarded-host')).toBeNull();
});
it('blocks signup before rendering unless explicitly enabled and keeps localhost OAuth reachable',()=>{
 vi.stubEnv('FW_ALLOW_REGISTRATION','');
 expect(proxy(new NextRequest('http://127.0.0.1:3000/signup',{headers:{host:'127.0.0.1:3000'}})).headers.get('location')).toBe('http://127.0.0.1:3000/login');
 expect(proxy(new NextRequest('http://localhost:3000/auth/google/callback')).status).toBe(200);
 vi.stubEnv('FW_ALLOW_REGISTRATION','true');expect(proxy(new NextRequest('http://localhost:3000/signup')).status).toBe(200);
});
it('rejects external host/DNS-rebinding names while retaining both existing loopback hostnames',()=>{
 expect(proxy(new NextRequest('http://localhost:3000/',{headers:{host:'attacker.invalid'}})).status).toBe(403);
 expect(proxy(new NextRequest('http://localhost:3000/')).status).toBe(200);
 expect(proxy(new NextRequest('http://127.0.0.1:3000/')).status).toBe(200);
});
