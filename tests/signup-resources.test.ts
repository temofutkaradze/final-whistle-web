import * as React from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({find:vi.fn(),create:vi.fn(),session:vi.fn(),hash:vi.fn(),acquire:vi.fn()}));
vi.mock('@/lib/auth',()=>({getCurrentUser:async()=>null,createSession:mocks.session}));
vi.mock('@/lib/db',()=>({prisma:{user:{findUnique:mocks.find,create:mocks.create}}}));
vi.mock('@/lib/password',()=>({MAX_EMAIL:254,MIN_PASSWORD:8,MAX_PASSWORD:200,hashPassword:mocks.hash}));
vi.mock('@/lib/admission',()=>({authAdmission:{acquire:mocks.acquire}}));
vi.mock('@/app/google-button',()=>({default:()=>null}));
vi.mock('next/navigation',()=>({redirect:(destination:string)=>{throw Object.assign(Error('redirect'),{destination});}}));
import Signup from '@/app/signup/page';
function action(node:React.ReactNode):((f:FormData)=>Promise<void>)|undefined{if(!React.isValidElement<{children?:React.ReactNode;action?:unknown}>(node))return;if(node.type==='form'&&typeof node.props.action==='function')return node.props.action as (f:FormData)=>Promise<void>;for(const child of React.Children.toArray(node.props.children)){const a=action(child);if(a)return a;}}
const form=(email='new@example.com',password='valid-password')=>{const f=new FormData();f.set('email',email);f.set('password',password);return f;};
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('React',React);});afterEach(()=>vi.unstubAllGlobals());
it('rejects oversized raw signup fields without hashing or database access',async()=>{const submit=action(await Signup({searchParams:Promise.resolve({})}))!;await expect(submit(form(' '.repeat(255)+'new@example.com'))).rejects.toMatchObject({destination:'/signup?error=email'});await expect(submit(form('new@example.com','x'.repeat(201)))).rejects.toMatchObject({destination:'/signup?error=password'});expect(mocks.hash).not.toHaveBeenCalled();expect(mocks.find).not.toHaveBeenCalled();});
it('requires admission before lookup and hashing',async()=>{mocks.acquire.mockReturnValue(null);const submit=action(await Signup({searchParams:Promise.resolve({})}))!;await expect(submit(form())).rejects.toMatchObject({destination:'/signup?error=wait'});expect(mocks.find).not.toHaveBeenCalled();expect(mocks.hash).not.toHaveBeenCalled();});
it('releases admission on a legacy-account conflict without linking or changing credentials',async()=>{const release=vi.fn();mocks.acquire.mockReturnValue(release);mocks.find.mockResolvedValue({passwordHash:null});const submit=action(await Signup({searchParams:Promise.resolve({})}))!;await expect(submit(form())).rejects.toMatchObject({destination:'/signup?error=legacy'});expect(release).toHaveBeenCalledOnce();expect(mocks.create).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();});
