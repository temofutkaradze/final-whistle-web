import {matchSampleAdmission} from '@/lib/admission';
﻿import * as React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({user:vi.fn(),approved:vi.fn(),sendMessage:vi.fn(),sendDocument:vi.fn(),render:vi.fn(),require:vi.fn()}));
vi.mock('@/lib/auth',()=>({requireUser:mocks.require,clearSessionCookie:vi.fn()}));
vi.mock('@/lib/db',()=>({prisma:{user:{findUnique:mocks.user},team:{findMany:async()=>[]},template:{findMany:async()=>[]}}}));
vi.mock('@/lib/telegram',()=>({sendMessage:mocks.sendMessage,sendDocument:mocks.sendDocument}));
vi.mock('@/lib/render',()=>({renderSamplePost:mocks.render}));
vi.mock('@/lib/crypto',()=>({userBotToken:(u:{botToken:string})=>u.botToken,encryptSecret:vi.fn()}));
vi.mock('../scripts/lib/match-pairing.mjs',()=>({approvedMatchUser:mocks.approved,lockMatchAccount:vi.fn()}));
vi.mock('@/lib/templates',async original=>({...await original<typeof import('@/lib/templates')>(),previewHtml:async()=>'<html></html>'}));
vi.mock('next/navigation',()=>({redirect:(destination:string)=>{throw Object.assign(new Error('Redirect'),{destination});}}));
import Dashboard from '@/app/dashboard/match/page';
const owner={id:'owner',email:'owner@example.com',name:'Owner',botToken:'test-connection',botId:'1000',botUsername:'test_bot',telegramChatId:'777',brands:[{id:'brand',userId:'owner',name:'Page',templateRef:'classic',logoPath:null,brandMode:'text'}],subscriptions:[],favoriteTeams:[],selections:[]};
function findAction(node:React.ReactNode,label:string):((form:FormData)=>Promise<void>)|undefined{
 if(!React.isValidElement<{children?:React.ReactNode;action?:unknown;label?:string}>(node))return;
 function hasLabel(child:React.ReactNode):boolean{if(!React.isValidElement<{children?:React.ReactNode;label?:string}>(child))return false;return child.props.label===label||React.Children.toArray(child.props.children).some(hasLabel);}
 if(node.type==='form'&&typeof node.props.action==='function'&&React.Children.toArray(node.props.children).some(hasLabel))return node.props.action as (form:FormData)=>Promise<void>;
 for(const child of React.Children.toArray(node.props.children)){const action=findAction(child,label);if(action)return action;}
}
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('React',React);mocks.require.mockResolvedValue(owner);mocks.user.mockResolvedValue(owner);mocks.approved.mockResolvedValue({...owner,telegramChatId:'111'});mocks.render.mockResolvedValue('/test/sample.jpg');mocks.sendMessage.mockResolvedValue(undefined);mocks.sendDocument.mockResolvedValue(undefined);});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
async function action(label:string){const tree=await Dashboard({searchParams:Promise.resolve({})});const fn=findAction(tree,label);expect(fn).toBeTypeOf('function');return fn!;}
describe('website Match test/sample recipient boundary',()=>{
 it('never sends to a legacy chat without approval, even through a submitted old form',async()=>{
  const test=await action('Send a test message'),sample=await action('Send a sample post');mocks.approved.mockResolvedValue(null);
  await expect(test(new FormData())).rejects.toMatchObject({destination:'/dashboard/match?test=nochat'});await expect(sample(new FormData())).rejects.toMatchObject({destination:'/dashboard/match?sample=nochat'});
  expect(mocks.render).not.toHaveBeenCalled();expect(mocks.sendMessage).not.toHaveBeenCalled();expect(mocks.sendDocument).not.toHaveBeenCalled();
 });
 it('uses the approved recipient and rechecks sample authorization after rendering',async()=>{
  const test=await action('Send a test message');await expect(test(new FormData())).rejects.toMatchObject({destination:'/dashboard/match?test=ok'});expect(mocks.sendMessage.mock.calls[0][0]).toBe('111');
  const sample=await action('Send a sample post');mocks.approved.mockResolvedValueOnce({...owner,telegramChatId:'111'}).mockResolvedValueOnce(null);
  await expect(sample(new FormData())).rejects.toMatchObject({destination:'/dashboard/match?sample=nochat'});expect(mocks.render).toHaveBeenCalledTimes(1);expect(mocks.sendDocument).not.toHaveBeenCalled();
 });
});

describe('expensive sample admission',()=>{
 it('does not render or send when the account has exhausted its sample budget',async()=>{
  vi.spyOn(matchSampleAdmission,'acquire').mockReturnValue(null);const sample=await action('Send a sample post');await expect(sample(new FormData())).rejects.toMatchObject({destination:'/dashboard/match?sample=fail'});expect(mocks.render).not.toHaveBeenCalled();expect(mocks.sendDocument).not.toHaveBeenCalled();
 });
 it('releases in-flight capacity even when rendering fails',async()=>{
  const release=vi.fn();vi.spyOn(matchSampleAdmission,'acquire').mockReturnValue(release);mocks.render.mockRejectedValueOnce(new Error('render unavailable'));const sample=await action('Send a sample post');await expect(sample(new FormData())).rejects.toMatchObject({destination:'/dashboard/match?sample=fail'});expect(release).toHaveBeenCalledOnce();expect(mocks.sendDocument).not.toHaveBeenCalled();
 });
});
