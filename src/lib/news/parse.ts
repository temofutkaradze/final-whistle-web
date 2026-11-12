export interface NewsStyle {
  font: 'League Gothic' | 'Anton' | 'Montserrat' | 'Arial';
  textSize: number;
  textTop: number;
  authorSize: number;
  authorGap: number;
  accent: string;
  textColor: string;
  align: 'left' | 'center' | 'right';
  circleTop: number;
  circleSize: number;
  shadeHeight: number;
  textBottom: number;
  textInset: number;
  lineHeight: number;
  letterSpacing: number;
  authorColor: string;
  authorTracking: number;
  circleInset: number;
  circleBorder: number;
  circleBorderColor: string;
  circleShape: 'circle' | 'rounded' | 'square';
  backgroundX: number;
  backgroundY: number;
  backgroundZoom: number;
  secondaryX: number;
  secondaryY: number;
  secondaryZoom: number;
  breakingFont: NewsStyle['font'];
  breakingSize: number;
}
export const DEFAULT_NEWS_STYLE: NewsStyle = {
  font: 'League Gothic', textSize: 96, textTop: -35, authorSize: 34,
  authorGap: 32, accent: '#f4ff3a', textColor: '#ffffff', align: 'center',
  circleTop: 110, circleSize: 500, shadeHeight: 750,
  textBottom: 50, textInset: 60, lineHeight: 1.04, letterSpacing: 0,
  authorColor: '#ffffff', authorTracking: 4, circleInset: 40,
  circleBorder: 8, circleBorderColor: '#ffffff', circleShape: 'circle',
  backgroundX: 50, backgroundY: 50, backgroundZoom: 1,
  secondaryX: 50, secondaryY: 30, secondaryZoom: 1,
  breakingFont: 'Montserrat', breakingSize: 41,
};
export function normalizeNewsStyle(value: unknown): NewsStyle {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const number = (key: keyof NewsStyle, min: number, max: number) => {
    const n = Number(v[key]);
    return v[key] !== undefined && v[key] !== null && v[key] !== '' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : DEFAULT_NEWS_STYLE[key] as number;
  };
  const color = (key: 'accent' | 'textColor' | 'authorColor' | 'circleBorderColor') =>
    typeof v[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(v[key]) ? v[key] as string : DEFAULT_NEWS_STYLE[key];
  const fonts = ['League Gothic','Anton','Montserrat','Arial'];
  return {
    font: fonts.includes(String(v.font)) ? v.font as NewsStyle['font'] : DEFAULT_NEWS_STYLE.font,
    textSize: number('textSize', 28, 150), textTop: number('textTop', -300, 250),
    authorSize: number('authorSize', 12, 70), authorGap: number('authorGap', 0, 130),
    accent: color('accent'), textColor: color('textColor'),
    align: ['left','center','right'].includes(String(v.align)) ? v.align as NewsStyle['align'] : 'center',
    circleTop: number('circleTop', 0, 650), circleSize: number('circleSize', 180, 700),
    shadeHeight: number('shadeHeight', 200, 1350),
    textBottom: number('textBottom', 0, 500), textInset: number('textInset', 20, 250),
    lineHeight: number('lineHeight', 0.9, 1.6), letterSpacing: number('letterSpacing', -3, 12),
    authorColor: color('authorColor'), authorTracking: number('authorTracking', 0, 12),
    circleInset: number('circleInset', 0, 300), circleBorder: number('circleBorder', 0, 30),
    circleBorderColor: color('circleBorderColor'),
    circleShape: ['circle','rounded','square'].includes(String(v.circleShape)) ? v.circleShape as NewsStyle['circleShape'] : 'circle',
    backgroundX: number('backgroundX', 0, 100), backgroundY: number('backgroundY', 0, 100), backgroundZoom: number('backgroundZoom', 1, 4),
    secondaryX: number('secondaryX', 0, 100), secondaryY: number('secondaryY', 0, 100), secondaryZoom: number('secondaryZoom', 1, 4),
    breakingFont: fonts.includes(String(v.breakingFont)) ? v.breakingFont as NewsStyle['font'] : 'Montserrat',
    breakingSize: number('breakingSize', 18, 100),
  };
}

// What the user types in Telegram -> a "job". (n8n node: Parse Message, text part)
export type Triple = [number, number, number];
export interface Job {
  editorial?: {template:import('./editorial.ts').EditorialTemplate;headline:string;subtitle:string};
  layout: 'single' | 'left' | 'right' | 'breaking';
  author: string;
  quote: string;
  caption: string;
  pos: { b: Triple; c: Triple };
  style?: NewsStyle;
}

export const HELP =
  'How it works:\n' +
  '1) Send the BACKGROUND image (as a file or HD photo).\n' +
  '2) Circle post only: send the CIRCLE image next.\n' +
  '3) Send the text:  Author | quote with *yellow words*\n' +
  '    Circle posts: start with L: (left) or R: (right), e.g.  R: Author | quote\n' +
  'Optional: [c:50,25,1.3] circle crop, [b:50,40,1] background crop, || Instagram caption\n' +
  '/cancel clears the saved images.';

// Compatibility parser: preserve the n8n node's order of operations, including
// its BREAKING limitation (no crop/caption parsing) and S: alias for left.
// Dashboard previews can still force a layout through buildJob below.
export function buildOriginalJob(text: string, hasCircle: boolean, config?: unknown): Job {
  const style = normalizeNewsStyle(config);
  const defaults: Job['pos'] = { b:[50,50,1], c:[50,30,1] };
  const breaking = text.match(/^BREAKING\s*\|\s*(.+)$/is);
  if (breaking) return {layout:'breaking',author:'',quote:breaking[1].trim(),caption:'',pos:defaults,style};
  let t=text;
  const pos:Job['pos']={b:[style.backgroundX,style.backgroundY,style.backgroundZoom],c:[style.secondaryX,style.secondaryY,style.secondaryZoom]};
  t=t.replace(/\[\s*([bcBC])\s*:\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\]/g,(_m,k:string,x:string,y:string,z?:string)=>{
    pos[k.toLowerCase() as 'b'|'c']=[+x,+y,+(z||1)];return '';
  });
  let side:'left'|'right'='left';
  const prefix=t.match(/^\s*([LRSlrs])\s*:\s*([\s\S]+)$/);
  if(prefix){side=prefix[1].toLowerCase()==='r'?'right':'left';t=prefix[2];}
  let caption='';const ci=t.indexOf('||');
  if(ci>=0){caption=t.slice(ci+2).trim();t=t.slice(0,ci);}
  let author='',quote=t.trim();const pi=t.indexOf('|');
  if(pi>=0){author=t.slice(0,pi).trim();quote=t.slice(pi+1).trim();}
  return {layout:hasCircle?side:'single',author,quote,caption,pos,style};
}

export function buildJob(text: string, hasCircle: boolean, layout?: Job['layout'], config?: unknown): Job {
  const style = normalizeNewsStyle(config);
  let t = text.trim();
  let caption = '';
  const ci = t.indexOf('||');
  if (ci >= 0) { caption = t.slice(ci + 2).trim(); t = t.slice(0, ci); }
  const pos: Job['pos'] = { b: [style.backgroundX, style.backgroundY, style.backgroundZoom], c: [style.secondaryX, style.secondaryY, style.secondaryZoom] };
  // [b:50,40,1] and [c:50,25,1.3]  = x %, y %, zoom
  t = t.replace(/\[\s*([bcBC])\s*:\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\]/g, (_m, k: string, x: string, y: string, z?: string) => {
    const crop: Triple = [+x, +y, +(z || 1)];
    if (!crop.every(Number.isFinite) || crop[0] > 100 || crop[1] > 100 || crop[2] < 1 || crop[2] > 4) throw new Error('Crop requires x/y from 0 to 100 and zoom from 1 to 4.');
    pos[k.toLowerCase() as 'b' | 'c'] = crop;
    return '';
  });
  if (/\[\s*[bc]\s*:/i.test(t)) throw new Error('Invalid crop. Use [b:50,50,1] or [c:50,30,1].');
  const breaking = /^\s*BREAKING\s*\|/i.test(t);
  if (breaking) { layout = 'breaking'; t = t.replace(/^\s*BREAKING\s*\|\s*/i, ''); }

  let side: 'left' | 'right' = layout === 'right' ? 'right' : 'left';
  const m = t.match(/^\s*([LRSlrs])\s*:\s*([\s\S]+)$/);
  if (m) {
    side = m[1].toLowerCase() === 'r' ? 'right' : 'left';
    layout = side;
    t = m[2];
  }

  let author = '';
  let quote = t.trim();
  const pi = t.indexOf('|');
  if (pi >= 0 && !breaking && layout !== 'breaking') {
    author = t.slice(0, pi).trim();
    quote = t.slice(pi + 1).trim();
  }
  if (!quote.replace(/\*/g,'').trim() || quote.length > 600 || author.length > 120 || caption.length > 1000) throw new Error('Use 1–600 characters of news, an author up to 120, and a caption up to 1000.');
  return { layout: layout ?? (hasCircle ? side : 'single'), author, quote, caption, pos, style };
}
