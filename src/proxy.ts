import {NextRequest,NextResponse} from 'next/server';
import {contentSecurityPolicy} from './lib/security-policy';
import {registrationAllowed} from './lib/local-security';

export function proxy(request:NextRequest){
 let host:string;
 try{host=new URL('http://'+(request.headers.get('host')??request.nextUrl.host)).hostname;}
 catch{return new NextResponse('Invalid host',{status:400});}
 if(!['localhost','127.0.0.1','[::1]'].includes(host))return new NextResponse('Local access only',{status:403});
 const origin=new URL(request.url);
 if(request.headers.get('host'))origin.host=request.headers.get('host')!;
 if(request.nextUrl.pathname==='/signup'&&!registrationAllowed())return NextResponse.redirect(new URL('/login',origin));
 const nonce=Buffer.from(crypto.randomUUID()).toString('base64');
 const policy=contentSecurityPolicy(nonce,process.env.NODE_ENV!=='production');
 const headers=new Headers(request.headers);
 headers.delete('x-forwarded-host');
 // Never trust a client-supplied nonce/CSP header.
 headers.set('x-nonce',nonce);headers.set('Content-Security-Policy',policy);
 const response=NextResponse.next({request:{headers}});
 response.headers.set('Content-Security-Policy',policy);
 response.headers.set('Cache-Control','private, no-store');
 return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)']};
