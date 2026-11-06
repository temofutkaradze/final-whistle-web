export function downloadPublicResource(url:string,options?:{maxBytes?:number;timeoutMs?:number;headers?:Record<string,string>}):Promise<{body:Buffer;contentType:string;headers:Record<string,string|string[]|undefined>}>;
export function renderHeaders():{'content-type':string;'x-news-render-secret':string};
export function publicAddress(address:string):boolean;
export function publicUrl(value:string):URL;
export function insideFile(file:string,directories:string[]):string;
export function eventHtml(value:unknown):string;
export function validateMatch(value:unknown):Record<string,unknown>;
