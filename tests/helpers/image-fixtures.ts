import {deflateSync} from 'node:zlib';
function crc32(bytes:Buffer){let crc=0xffffffff;for(const value of bytes){crc^=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function chunk(type:string,data:Buffer){const tag=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]);}
// Real APNG, 1x1 pixels per frame. Safe to parse or decode in regressions.
export function tinyApng(frames=101){
 const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
 const animation=Buffer.alloc(8);animation.writeUInt32BE(frames);
 const parts=[Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('acTL',animation)];let sequence=0;
 for(let index=0;index<frames;index++){
  const control=Buffer.alloc(26);control.writeUInt32BE(sequence++);control.writeUInt32BE(1,4);control.writeUInt32BE(1,8);control.writeUInt16BE(1,20);control.writeUInt16BE(100,22);parts.push(chunk('fcTL',control));
  const pixels=deflateSync(Buffer.from([0,index%2?255:0,0,0,255]));
  if(index===0)parts.push(chunk('IDAT',pixels));else{const seq=Buffer.alloc(4);seq.writeUInt32BE(sequence++);parts.push(chunk('fdAT',Buffer.concat([seq,pixels])));}
 }
 parts.push(chunk('IEND',Buffer.alloc(0)));return Buffer.concat(parts);
}
