export const proposedQuotas:Readonly<{imagesPerMinute:number;imagesPerHour:number;globalImagesPerHour:number;uploadMiB:number;minFreeMiB:number}>;
export function admitImage(options?:{directory?:string;cost?:number;now?:number}):Promise<void>;
export function renderSecurityHeaders(explicit?:{key?:string;userId?:string;owner:boolean}):Record<string,string>;
export function admitUpload(directory:string,baseName:string,bytes:number):Promise<void>;
