import {authAdmission} from '@/lib/admission';
﻿import * as React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {hashPassword} from '@/lib/password';
const mocks=vi.hoisted(()=>({find:vi.fn(),session:vi.fn(),current:vi.fn(),allowed:vi.fn(),fail:vi.fn(),reset:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{user:{findUnique:mocks.find}}}));
vi.mock('@/lib/auth',()=>({createSession:mocks.session,getCurrentUser:mocks.current,loginLimiter:{allowed:mocks.allowed,fail:mocks.fail,reset:mocks.reset}}));
vi.mock('next/navigation',()=>({redirect:(destination:string)=>{throw Object.assign(new Error('Redirect'),{destination});}}));
import Login from '@/app/login/page';
type Action=(form:FormData)=>Promise<void>;
function formAction(node:React.ReactNode):Action|undefined{
 if(!React.isValidElement<{children?:React.ReactNode;action?:unknown}>(node))return;
 if(node.type==='form'&&typeof node.props.action==='function')return node.props.action as Action;
 for(const child of React.Children.toArray(node.props.children)){const found=formAction(child);if(found)return found;}
}
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('React',React);mocks.current.mockResolvedValue(null);mocks.allowed.mockReturnValue(true);mocks.session.mockResolvedValue(undefined);});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('existing password login compatibility',()=>{
 it('still authenticates an existing password without any Google identity',async()=>{
  mocks.find.mockResolvedValue({id:'password-owner',passwordHash:await hashPassword('existing-password')});
  const action=formAction(await Login({searchParams:Promise.resolve({})}));expect(action).toBeTypeOf('function');
  const form=new FormData();form.set('email',' Owner@Example.com ');form.set('password','existing-password');
  await expect(action!(form)).rejects.toMatchObject({destination:'/dashboard'});expect(mocks.find).toHaveBeenCalledWith({where:{email:'owner@example.com'}});expect(mocks.session).toHaveBeenCalledWith('password-owner');
 });
 it('never authenticates a passwordless legacy account through password login',async()=>{
  mocks.find.mockResolvedValue({id:'legacy',passwordHash:null});
  const action=formAction(await Login({searchParams:Promise.resolve({})}));const form=new FormData();form.set('email','owner@example.com');form.set('password','not-a-credential');
  await expect(action!(form)).rejects.toMatchObject({destination:'/login?error=bad'});expect(mocks.session).not.toHaveBeenCalled();
 });
});

describe('password request admission',()=>{
 it('rejects oversized email/password values before database or password verification',async()=>{
  const action=formAction(await Login({searchParams:Promise.resolve({})}));
  for(const [email,password] of [['a'.repeat(255)+'@x.com','safe-password'],['owner@example.com','x'.repeat(201)]]){
   const form=new FormData();form.set('email',email);form.set('password',password);await expect(action!(form)).rejects.toMatchObject({destination:'/login?error=bad'});
  }
  expect(mocks.find).not.toHaveBeenCalled();expect(mocks.session).not.toHaveBeenCalled();
 });
 it('rejects admission before database work when capacity is exhausted',async()=>{
  vi.spyOn(authAdmission,'acquire').mockReturnValue(null);const action=formAction(await Login({searchParams:Promise.resolve({})}));const form=new FormData();form.set('email','owner@example.com');form.set('password','safe-password');
  await expect(action!(form)).rejects.toMatchObject({destination:'/login?error=wait'});expect(mocks.find).not.toHaveBeenCalled();
 });
});
