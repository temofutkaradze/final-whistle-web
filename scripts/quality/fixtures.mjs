import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

// Deterministic geometric test chart, not a generated/enhanced photograph.
export async function fixtures(root){
 const dir=path.join(root,'fixtures');await fs.mkdir(dir,{recursive:true});
 const chart=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2160" height="2700" viewBox="0 0 1080 1350">
 <defs><linearGradient id="g"><stop stop-color="#111820"/><stop offset="1" stop-color="#83949c"/></linearGradient><pattern id="stripes" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="6" height="12" fill="#fff"/></pattern></defs>
 <rect width="1080" height="1350" fill="url(#g)"/><path fill="#194d31" d="M0 800h1080v550H0z"/>
 <path d="M0 1000L1080 700M0 700L1080 1000" stroke="white" stroke-width="2"/>
 <circle cx="540" cy="190" r="90" fill="#b97c50"/><path d="M350 290L730 290L850 650L720 700L700 1020L380 1020L360 700L230 650Z" fill="#bc142e" stroke="#f7d750" stroke-width="4"/>
 <path d="M430 290h40v730h-40zM610 290h40v730h-40z" fill="#172e71"/>
 <text x="540" y="390" text-anchor="middle" font-family="sans-serif" font-size="35" fill="white">TEST PLAYER</text>
 <text x="540" y="640" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="245" fill="#f9f6df">19</text>
 <rect x="432" y="670" width="216" height="85" fill="url(#stripes)"/><text x="540" y="800" text-anchor="middle" font-family="sans-serif" font-size="18" fill="white">0123456789 ABCDEFGH</text>
 <g fill="none"><rect x="28" y="30" width="240" height="130" stroke="#f33" stroke-width="1"/><circle cx="935" cy="100" r="65" stroke="#26eaff" stroke-width="2"/></g>
 <text x="935" y="110" text-anchor="middle" font-family="sans-serif" font-size="25" fill="white">FC 08</text>
 <g stroke="white">${Array.from({length:20},(_,i)=>`<path stroke-width="${.4+i*.1}" d="M${30+i*10} 300v400"/>`).join('')}</g>
 </svg>`);
 const portrait=await sharp(chart).png().toBuffer();
 const landscape=await sharp(chart).resize(1728,2160).extend({left:756,right:756,top:0,bottom:0,background:'#244d31'}).png().toBuffer();
 const photo=await fs.readFile('public/examples/post-juve-inter.jpg');
 const high=await fs.readFile(path.join(dir,'photo-landscape-original.jpg'));
 const list=[{name:'chart-portrait',bytes:portrait,description:'Synthetic 2160x2700 chart; known jersey 19, fine lines, gradient, badge.'},{name:'chart-landscape',bytes:landscape,description:'Synthetic 3240x2160 landscape chart; deterministic geometry.'},{name:'photo-low',bytes:photo,description:'Existing public 720x900 JPEG example, already composited/compressed. Not a raw photograph.'},{name:'photo-high',bytes:high,description:'CC0 5760x3840 sports photograph, faces, logos and jersey numbers 29/10/83. Source: https://pxhere.com/en/photo/1102099 . Original bytes, no enhancement.'}];
 list.push({name:'photo-6mp',bytes:await sharp(high).resize(2880,1920).png().toBuffer(),description:'CC0 photo reduced once to 2880x1920 with Lanczos3 for a bounded high-resolution fixture; no crop, enhancement or detail reconstruction. Original 22MP News stress exhausted available memory on this 4GB shared laptop.'});
 for(const f of list){f.metadata=await sharp(f.bytes).metadata();await fs.writeFile(path.join(dir,f.name+(f.metadata.format==='jpeg'?'.jpg':'.png')),f.bytes);}
 return list;
}
