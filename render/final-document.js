// Authoritative final-document boundary; the editor checker is early feedback only.
'use strict';
const html5=require('parse5'),css=require('css-tree');
const HTML='http://www.w3.org/1999/xhtml',SVG='http://www.w3.org/2000/svg';
const htmlTags=new Set(('html head body title meta link style div span p br hr img a b strong i em u s small sub sup section article header footer main aside nav h1 h2 h3 h4 h5 h6 ul ol li dl dt dd figure figcaption blockquote q pre code table caption colgroup col thead tbody tfoot tr th td picture wbr abbr time mark button input select option optgroup output progress meter label fieldset legend ins del kbd samp var data dfn center font big tt strike menu dialog ruby rt rp bdi bdo details summary address').split(' '));
const svgTags=new Set(('svg style g defs symbol use image path rect circle ellipse line polyline polygon text tspan textPath title desc linearGradient radialGradient stop pattern clipPath mask marker filter feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject').split(' ').map(x=>x.toLowerCase()));
const cssAttributes=new Set('style fill stroke filter clip-path mask marker marker-start marker-mid marker-end cursor color-profile'.split(' '));
const urlAttributes=new Set('src href poster action formaction data background ping manifest codebase usemap longdesc cite profile'.split(' '));
const unsafeAttributes=new Set('srcset imagesrcset srcdoc is xml:base'.split(' '));
const blockedFunctions=new Set('expression image image-set -webkit-image-set cross-fade -webkit-cross-fade src'.split(' '));
const fail=message=>{throw Object.assign(new Error('Custom template: '+message),{statusCode:400});};
function providerUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname);}catch{return false;}}
function policy(preview){return "default-src 'none'; img-src "+(preview?'data:':'https://validated-template.invalid')+"; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";}
function prepareDocument(source,{imageUrl,preview=false}={}){
 if(typeof source!=='string'||source.length>48*1024*1024||/[\0\x01-\x08\x0b\x0e-\x1f\x7f]/.test(source))fail('invalid document size or encoding');
 const errors=[];let document;
 try{document=html5.parse(source,{scriptingEnabled:false,onParseError:e=>errors.push(e.code)});}catch{fail('invalid HTML');}
 if(errors.some(code=>!['missing-doctype','non-conforming-doctype','missing-semicolon-after-character-reference'].includes(code)))fail('ambiguous HTML syntax');
 const resources=new Set();let count=0;
 function resource(value){
  value=String(value).trim();if(!value||/^#[A-Za-z_][\w:.-]*$/.test(value))return value;
  if(!/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)[;,]/i.test(value)&&!/^file:/i.test(value))fail('unsupported image URL');
  if(preview&&!/^data:image\//i.test(value))fail('local files are unavailable in previews');
  resources.add(value);return imageUrl?imageUrl(value):value;
 }
 function style(value,context){
  if(value.includes('\\')||/[\0\x01-\x08\x0b\x0e-\x1f\x7f]/.test(value))fail('unsupported CSS escapes or controls');
  let tree;try{tree=css.parse(value,{context,parseCustomProperty:true,onParseError:()=>fail('ambiguous CSS syntax')});}catch{fail('invalid CSS syntax');}
  css.walk(tree,node=>{
   if(node.type==='Raw')fail('unsupported CSS syntax');
   if(node.type==='Atrule'&&['import','charset','namespace'].includes(css.ident.decode(node.name).toLowerCase()))fail('external CSS directives');
   if(node.type==='Function'&&blockedFunctions.has(css.ident.decode(node.name).toLowerCase()))fail('unsupported image function');
   if(node.type==='Declaration'&&['behavior','-moz-binding'].includes(css.ident.decode(node.property).toLowerCase()))fail('active CSS');
   if(node.type==='Url')node.value=resource(node.value);
  });return css.generate(tree);
 }
 function visit(node,depth=0){
  if(++count>20000||depth>128)fail('document complexity limit');
  if(node.tagName){
   const tag=node.tagName.toLowerCase(),ns=node.namespaceURI;
   if(!((ns===HTML&&htmlTags.has(tag))||(ns===SVG&&svgTags.has(tag))))fail('unsupported element '+tag);
   for(const attr of node.attrs){
    const name=(attr.prefix?attr.prefix+':':'')+attr.name.toLowerCase();
    if(tag==='meta'&&name==='charset'&&!/^utf-?8$/i.test(attr.value))fail('document encoding must be UTF-8');
    if(name.startsWith('on')||unsafeAttributes.has(name)||name==='http-equiv')fail('active or unsupported attribute');
    if(attr.namespace&&!['http://www.w3.org/1999/xlink','http://www.w3.org/XML/1998/namespace','http://www.w3.org/2000/xmlns/'].includes(attr.namespace))fail('unsupported attribute namespace');
    if(cssAttributes.has(name))attr.value=style(attr.value,name==='style'?'declarationList':'value');
    if(urlAttributes.has(attr.name.toLowerCase())){
     if(ns===HTML&&tag==='link'&&attr.name==='href'){
      const rel=node.attrs.find(a=>a.name==='rel')?.value.toLowerCase();
      if(!['stylesheet','preconnect'].includes(rel)||!providerUrl(attr.value))fail('unsupported stylesheet');
     }else attr.value=resource(attr.value);
    }
   }
   if(tag==='link'&&!node.attrs.some(a=>a.name==='href'))fail('missing stylesheet URL');
   if(tag==='style'){
    const text=node.childNodes.map(child=>child.nodeName==='#text'?child.value:fail('non-text style content')).join('');
    node.childNodes=[{nodeName:'#text',value:style(text,'stylesheet'),parentNode:node}];
   }
  }
  for(const child of node.childNodes||[])visit(child,depth+1);
 }
 visit(document);
 const head=document.childNodes.find(n=>n.tagName==='html').childNodes.find(n=>n.tagName==='head');
 const meta=html5.parseFragment('<meta http-equiv="Content-Security-Policy" content="'+policy(preview)+'">').childNodes[0];meta.parentNode=head;head.childNodes.unshift(meta);
 const html=html5.serialize(document);
 // Reject serialization-induced tree repair (including foreign-content mutation XSS).
 const reparsed=html5.parse(html,{scriptingEnabled:false});
 if(html5.serialize(reparsed)!==html)fail('unstable HTML serialization');
 return {html,resources:[...resources]};
}
// Replacement values are data, never another template. Validate after all expansion.
function expandPlaceholders(html,values){return html.replace(/\{\{[A-Z_]+\}\}/g,key=>Object.hasOwn(values,key)?String(values[key]??''):key);}
function previewDocument(html){try{return prepareDocument(html,{preview:true}).html;}catch{return '';}}
module.exports={prepareDocument,expandPlaceholders,previewDocument};
