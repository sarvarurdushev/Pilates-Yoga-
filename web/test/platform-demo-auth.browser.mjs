/** Local proxy-failure recovery after the real server has seeded one demo. */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=process.env.MOTION_BASE_URL || 'http://127.0.0.1:8156';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--no-sandbox']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const payloads=[];let seededOrganization;
await page.route('**/platform/auth/demo',async route=>{
 payloads.push(route.request().postDataJSON());
 if(payloads.length===1){const response=await route.fetch();assert.equal(response.status(),200);seededOrganization=(await response.json()).organization.id;await route.fulfill({status:502,contentType:'text/html',body:'<h1>Temporary gateway response</h1>'});}
 else await route.continue();
});
try {
 await page.goto(base+'/index.html');await page.getByRole('button',{name:'Explore as coach',exact:true}).click();
 await page.getByText('Your demonstration is still being prepared. Reconnecting to the same workspace…',{exact:true}).waitFor({timeout:60000});
 await page.getByRole('heading',{name:'Your coaching day',exact:true}).waitFor({timeout:60000});
 assert.equal(payloads.length,2);assert.deepEqual(payloads[0],payloads[1]);assert.equal(new URL(page.url()).hash,'#page=dashboard');
 const me=await page.evaluate(async()=>{const r=await fetch('/platform/me');return r.json();});assert.equal(me.organization.id,seededOrganization);assert.equal(me.role,'coach');assert.equal(me.students.length,8);assert.deepEqual(errors,[]);
 console.log('PASS: gateway502 after real demo seed automatically reconnects with identical key/role, keeps one organization, displays preparation status and opens Coach dashboard;0pageerrors');
}finally{await browser.close();}
