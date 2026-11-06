import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeAll,expect,it,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
vi.stubGlobal('React',React);
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>null,requireUser:async()=>({id:'ui-fixture'}),clearSessionCookie:vi.fn(),createSession:vi.fn(),destroySession:vi.fn(),loginLimiter:{}}));
vi.mock('@/lib/google',()=>({googleConfigured:()=>true}));
vi.mock('@/lib/auth-actions',()=>({logout:async()=>{}}));
vi.mock('next/navigation',()=>({usePathname:()=>'/dashboard',redirect:()=>{throw Error('Unexpected redirect');}}));
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}));
vi.mock('react-dom',async original=>({...await original<typeof import('react-dom')>(),useFormStatus:()=>({pending:false})}));
vi.mock('@/lib/db',()=>({prisma:{user:{findUnique:async()=>({id:'ui-fixture',email:'editor@example.test',name:'Football editor',brands:[],subscriptions:[],favoriteTeams:[],selections:[]})},team:{findMany:async()=>[]},template:{findMany:async()=>[]},newsSettings:{findUnique:async()=>null},newsTemplate:{findMany:async()=>[]}}}));
vi.mock('../scripts/lib/match-pairing.mjs',()=>({approvedMatchUser:async()=>null,lockMatchAccount:vi.fn()}));
vi.mock('@/lib/telegram',()=>({sendMessage:vi.fn(),sendDocument:vi.fn()}));
vi.mock('@/lib/render',()=>({renderSamplePost:vi.fn()}));
import Home from '@/app/page';
import Login from '@/app/login/page';
import Signup from '@/app/signup/page';
import Dashboard from '@/app/dashboard/page';
import Match from '@/app/dashboard/match/page';
import News from '@/app/news/page';
import Header from '@/app/header';
const pages:Record<string,string>={};
beforeAll(async()=>{
 const trees={landing:await Home(),login:await Login({searchParams:Promise.resolve({})}),signup:await Signup({searchParams:Promise.resolve({})}),dashboard:await Dashboard(),match:await Match({searchParams:Promise.resolve({})}),news:await News({searchParams:Promise.resolve({})})};
 for(const [name,tree] of Object.entries(trees)){
  pages[name]=renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(Header,{user:name==='dashboard'||name==='match'||name==='news'?{email:'editor@example.test'}:null}),React.createElement('main',{id:'main'},tree)));
 }
 // Optional local visual fixtures use the actual components and mocked account data, never production records.
 if(['before','after'].includes(process.env.FW_UI_SNAPSHOTS??'')){
  const dir=`storage/ui-review/${process.env.FW_UI_SNAPSHOTS}`;mkdirSync(dir,{recursive:true});
  for(const [name,html] of Object.entries(pages))writeFileSync(`${dir}/${name}.html`,html);
 }
});
it('renders the public pages and both generator management screens without invoking services',()=>{
 for(const html of Object.values(pages)){expect(html).toContain('<h1');expect(html).not.toContain('undefined');}
 expect(pages.dashboard).toContain('href="/dashboard/match"');expect(pages.dashboard).toContain('href="/news"');
 expect(pages.news).toContain('BREAKING');expect(pages.match).toContain('Template');
});
it('keeps Google and password authentication form destinations and labels',()=>{
 for(const name of ['login','signup']){expect(pages[name]).toContain('href="/auth/google"');expect(pages[name]).toContain('name="email"');expect(pages[name]).toContain('name="password"');}
 expect(pages.signup).toContain('autoComplete="new-password"');expect(pages.login).toContain('autoComplete="current-password"');
});

it('provides one page landmark and distinct generator headings',()=>{
 for(const html of Object.values(pages)){expect(html.match(/<main[ >]/g)).toHaveLength(1);expect(html.match(/<h1[ >]/g)).toHaveLength(1);}
 expect(pages.match).toMatch(/<h1[^>]*>Match Generator<\/h1>/);expect(pages.news).toContain('News Generator');
});
