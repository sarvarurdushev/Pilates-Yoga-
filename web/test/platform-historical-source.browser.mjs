/** Disposable localhost source-context acceptance; atlas rendering is checked separately. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { randomBytes } from 'node:crypto';
const base=process.env.MOTION_BASE_URL||'http://127.0.0.1:8154';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1300,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/anatomy.html?**',r=>r.abort());
const api=async(action,body)=>page.evaluate(async({action,body})=>{
 const r=await fetch('/platform/'+action,body?{method:'POST',headers:{'Content-Type':'application/json','X-Platform-Request':'1'},body:JSON.stringify(body)}:{});
 const value=await r.json();if(!r.ok)throw Error(value.error||r.status);return value;
},{action,body});
const open=async hash=>{await page.goto(base+'/index.html'+hash);await page.waitForFunction(()=>document.querySelector('#page-content .page-head h1')&&!document.querySelector('#page-content .loading'),null,{timeout:60000});};
try{
 await page.goto(base+'/index.html');await page.evaluate(key=>sessionStorage.setItem('motion-demo-key',key),randomBytes(16).toString('hex'));
 await page.getByRole('button',{name:'Explore as coach',exact:true}).click();await page.getByRole('heading',{name:'Your coaching day',exact:true}).waitFor({timeout:180000});
 const me=await api('me');const c=await api('client?id='+encodeURIComponent(me.students.find(c=>c.name==='Sarah Kim').id));
 const text='Historical source acceptance: general feedback';
 const note=await api('save',{collection:'notes',item:{student_id:c.id,region_id:'right_shoulder',visibility:'student',text}});
 await open(`#page=client&client=${c.id}&tab=notes&note=${note.id}`);await page.getByText(text,{exact:true}).waitFor();
 assert.match(await page.locator('article.note').textContent(),/Source visit not recorded/);
 await page.getByRole('button',{name:'Edit feedback',exact:true}).click();await page.getByRole('heading',{name:'Edit coach feedback',exact:true}).waitFor();
 assert.equal(await page.locator('[name=session_id]').inputValue(),'');
 const visit=c.sessions[0];await page.locator('[name=session_id]').selectOption(visit.id);
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('heading',{name:'Edit coach feedback',exact:true}).waitFor({state:'hidden'});
 await page.reload();await page.getByText(text,{exact:true}).waitFor();
 assert.doesNotMatch(await page.locator('article.note').textContent(),/Source visit not recorded/);
 assert.ok((await page.locator('article.note').getByRole('link',{name:'Source visit',exact:true}).getAttribute('href')).includes('session='+visit.id));
 const another=await api('save',{collection:'notes',item:{student_id:c.id,region_id:'right_shoulder',visibility:'student',text:'General body feedback without visit'}});
 await open(`#page=client&client=${c.id}&tab=anatomy&region=right_shoulder`);await page.getByText('General body feedback without visit',{exact:true}).waitFor();
 const body=page.locator('article.note').filter({hasText:'General body feedback without visit'});assert.match(await body.textContent(),/Source visit not recorded/);
 assert.ok((await body.getByRole('link',{name:/Open feedback to connect/}).getAttribute('href')).includes('note='+another.id));
 await page.locator('#demo-role').selectOption('student');await page.getByRole('heading',{name:/Your practice/}).first().waitFor({timeout:180000});
 await open(`#page=client&client=${c.id}&tab=notes&note=${another.id}`);await page.getByText('General body feedback without visit',{exact:true}).waitFor();
 assert.match(await page.locator('article.note').textContent(),/Source visit not recorded/);
 assert.equal(await page.getByRole('button',{name:'Edit feedback',exact:true}).count(),0);
 assert.doesNotMatch(await page.locator('article.note').textContent(),/connect the exact visit/);
 assert.deepEqual(errors,[]);console.log('PASS: historical/general feedback missing source, initially empty editor, exact Coach visit repair and reload, body repair link, Student disclosure without editing');
}finally{await browser.close();}
