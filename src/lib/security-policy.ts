export function contentSecurityPolicy(nonce:string,development=false){
 if(!/^[A-Za-z0-9+/=_-]{16,128}$/.test(nonce))throw Error('Invalid CSP nonce');
 return ["default-src 'self'",`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development?" 'unsafe-eval'":''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com","font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",`connect-src 'self'${development?' ws://127.0.0.1:* ws://localhost:*':''}`,
  "object-src 'none'","base-uri 'self'","form-action 'self'","frame-ancestors 'none'","script-src-attr 'none'"].join('; ');
}
