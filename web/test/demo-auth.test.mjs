import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateDemo } from '../src/platform/demo-auth.js';
import { api } from '../src/platform/core.js';
const error = (status) => Object.assign(Error('Transport response'), {status});
const payload = {key:'a'.repeat(32),role:'coach',user_id:'coach-record'};

test('a first proxy failure reconnects to the identical demo identity and returns its bootstrap', async () => {
 let clock=100, calls=[], waits=[], retries=[];const profile={role:'coach',organization:{id:'demo-'+payload.key}};
 const result=await authenticateDemo(payload,{now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},onRetry:r=>retries.push(r),request:async(path,body,options)=>{calls.push({path,body,options});if(calls.length===1){clock+=30000;throw error(502);}return profile;}});
 assert.equal(result,profile);assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.deepEqual(calls[0].body,payload);assert.deepEqual(waits,[2000]);assert.deepEqual(retries,[{attempt:2,status:502}]);
 assert.equal(calls[0].options.timeoutMs,180000);assert.equal(calls[1].options.timeoutMs,148000);assert.equal(payload.key,'a'.repeat(32));
});

test('only network and gateway availability failures retry, at most three attempts', async () => {
 for (const status of [0,502,503,504]) {let calls=0,waits=0;const failure=error(status);await assert.rejects(authenticateDemo(payload,{request:async()=>{calls++;throw failure;},wait:async ms=>{assert.equal(ms,2000);waits++;}}),e=>e===failure);assert.equal(calls,3);assert.equal(waits,2);}
 for (const status of [400,401,403,404,409,429,500,200,undefined]) {let calls=0,waits=0;const failure=error(status);await assert.rejects(authenticateDemo(payload,{request:async()=>{calls++;throw failure;},wait:async()=>{waits++;}}),e=>e===failure);assert.equal(calls,1);assert.equal(waits,0);}
});

test('one shared deadline bounds all attempts and prevents a delayed extra request', async () => {
 let clock=0,calls=0;const failure=error(504);await assert.rejects(authenticateDemo(payload,{deadlineMs:1000,now:()=>clock,request:async()=>{calls++;clock=1001;throw failure;},wait:async()=>assert.fail('no retry past deadline')}),e=>e===failure);assert.equal(calls,1);
 clock=0;calls=0;await assert.rejects(authenticateDemo(payload,{deadlineMs:5000,now:()=>clock,request:async()=>{calls++;throw failure;},wait:async()=>{clock=6000;}}),e=>e===failure);assert.equal(calls,1);
});

test('successful demo authentication needs no retry', async () => {
 let calls=0;assert.equal(await authenticateDemo(payload,{request:async()=>{calls++;return 'ready';},wait:async()=>assert.fail('unexpected wait'),onRetry:()=>assert.fail('unexpected retry')}),'ready');assert.equal(calls,1);
});

test('API exposes response or network status without interpreting error-message text', async () => {
 const original=globalThis.fetch;
 try {
  for(const status of [502,503,504,401]){globalThis.fetch=async()=>({status,json:async()=>{throw Error('not JSON');}});await assert.rejects(api('auth/demo',payload),e=>e.status===status);}
  globalThis.fetch=async()=>{throw Error('network');};await assert.rejects(api('auth/demo',payload),e=>e.status===0);
  globalThis.fetch=async()=>({status:403,ok:false,json:async()=>({error:'Access refused'})});await assert.rejects(api('auth/demo',payload),e=>e.status===403&&e.message==='Access refused');
 } finally {globalThis.fetch=original;}
});
