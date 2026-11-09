// Offline image metrics. SSIM uses non-overlapping 8x8 luminance windows,
// population variances, BT.709 luma and the usual K1=.01 / K2=.03 constants.
// It is explicitly not the Gaussian-window reference implementation of SSIM.
export function compareRgb(reference, candidate, width, height) {
  if(reference.length!==candidate.length||reference.length!==width*height*3)throw Error('RGB dimensions differ');
  let squared=0,maximum=0,ssim=0,blocks=0;
  for(let i=0;i<reference.length;i++){const d=reference[i]-candidate[i];squared+=d*d;maximum=Math.max(maximum,Math.abs(d));}
  for(let y=0;y<height;y+=8)for(let x=0;x<width;x+=8){
    let a=0,b=0,aa=0,bb=0,ab=0,n=0;
    for(let j=y;j<Math.min(y+8,height);j++)for(let k=x;k<Math.min(x+8,width);k++){
      const i=(j*width+k)*3;
      const av=.2126*reference[i]+.7152*reference[i+1]+.0722*reference[i+2];
      const bv=.2126*candidate[i]+.7152*candidate[i+1]+.0722*candidate[i+2];
      a+=av;b+=bv;aa+=av*av;bb+=bv*bv;ab+=av*bv;n++;
    }
    const ma=a/n,mb=b/n,va=Math.max(0,aa/n-ma*ma),vb=Math.max(0,bb/n-mb*mb),cov=ab/n-ma*mb;
    ssim+=((2*ma*mb+6.5025)*(2*cov+58.5225))/((ma*ma+mb*mb+6.5025)*(va+vb+58.5225));blocks++;
  }
  return {psnrDb:squared?10*Math.log10(255*255/(squared/reference.length)):null,identical:squared===0,ssim8:ssim/blocks,maxError:maximum};
}
export const median=values=>{const a=[...values].sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
