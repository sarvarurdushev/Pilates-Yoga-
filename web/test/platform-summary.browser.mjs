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
const open=async hash=>{await page.goto(base+'/workspace.html'+hash);await page.waitForFunction(()=>document.querySelector('#page-content .page-head h1')&&!document.querySelector('#page-content .loading'),null,{timeout:60000});};
try{
 await page.goto(base+'/workspace.html');await page.evaluate(key=>sessionStorage.setItem('motion-demo-key',key),randomBytes(16).toString('hex'));
 await page.getByRole('button',{name:'Explore as coach',exact:true}).click();await page.getByRole('heading',{name:'Your coaching day',exact:true}).waitFor({timeout:180000});
 const me=await api('me');const c=await api('client?id='+encodeURIComponent(me.students.find(c=>c.name==='Sarah Kim').id));
 const a=c.analyses.find(a=>a.kind==='movement');const visit=c.sessions.find(s=>s.analysis_ids?.includes(a.id));
 const p=await api('record?collection=programs&id='+encodeURIComponent(c.programs[0].program_id));const step=p.steps.find(s=>s.exercise_id);
 const practice=await api('complete-session',{student_id:c.id,program_id:p.id,completed:[step.id],notes:'Summary acceptance practice'});
 await open(`#page=client&client=${c.id}&tab=overview`);await page.getByRole('heading',{name:'Latest assessment',exact:true}).waitFor();
 await open(`#page=client&client=${c.id}&tab=sessions&session=${practice.id}`);
 await page.locator('.session-at-glance').waitFor();assert.ok((await page.locator('.session-at-glance').textContent()).includes(step.exercise_name));
 assert.match(await page.locator('.session-at-glance').textContent(),/1 movement logged/);
 await api('save',{collection:'notes',item:{student_id:c.id,analysis_id:a.id,session_id:visit.id,region_id:'right_shoulder',visibility:'student',text:'Human Coach validation on demo assessment'}});
 const report=async()=>{await open(`#page=report&client=${c.id}&id=${a.id}`);await page.getByText('Human Coach validation on demo assessment',{exact:true}).waitFor();const text=await page.getByRole('heading',{name:'Coach feedback',exact:true}).locator('../..').textContent();assert.match(text,/COACH-WRITTEN FEEDBACK/);assert.doesNotMatch(text,/DEMO COACH FEEDBACK/);};
 await report();await open(`#page=client&client=${c.id}&tab=anatomy&region=right_wrist&id=${a.id}`);await page.locator('.anatomy-region-summary').waitFor();
 const source=await page.locator('.anatomy-region-summary').textContent();assert.ok(source.includes(a.protocol));assert.match(source,/Front view/);
 const media=await page.evaluate(async student=>{const r=await fetch('/assets/platform/sarah.png');const image=await r.blob();const u=await fetch('/platform/upload?'+new URLSearchParams({filename:'generated-summary.png',student_id:student,kind:'scan'}),{method:'POST',headers:{'Content-Type':'image/png','X-Platform-Request':'1'},body:image});if(!u.ok)throw Error('Upload '+u.status);return u.json();},c.id);
 const scan=await api('save',{collection:'scans',item:{student_id:c.id,session_id:visit.id,analysis_id:a.id,region_id:'right_shoulder',media_id:media.id,name:'Artificial summary date fixture',scan_type:'Calibration',captured_at:'2026-01-02',detail:{calibration:true}}});
 await open(`#page=client&client=${c.id}&tab=scans&scan=${scan.id}`);await page.locator('#scan-image').waitFor();
 assert.match(await page.locator('#scan-detail').textContent(),/Capture date:.*Jan.*2.*2026/);assert.match(await page.locator('#scan-detail').getByRole('link',{name:/^Source visit ·/}).textContent(),/Source visit ·/);
 await api('save',{collection:'scans',item:{...scan,captured_at:''}});await page.reload();await page.locator('#scan-image').waitFor();assert.match(await page.locator('#scan-detail').textContent(),/Date not recorded/);
 await page.setViewportSize({width:540,height:900});await open(`#page=client&client=${c.id}&tab=sessions&session=${practice.id}`);
 await page.locator('.session-at-glance').waitFor();assert.ok((await page.locator('.session-at-glance').textContent()).includes(step.exercise_name));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await page.locator('#demo-role').selectOption('student');await page.getByRole('heading',{name:/Your practice/}).first().waitFor({timeout:180000});assert.equal((await api('me')).user.id,c.id);
 await open(`#page=client&client=${c.id}&tab=overview`);await page.getByRole('heading',{name:'Your latest assessment',exact:true}).waitFor();await report();
 assert.deepEqual(errors,[]);console.log('PASS: assessment labels, named logged practice, selected-source protocol/camera, dated/undated scan and source visit, note provenance, Student projection,540px');
}finally{await browser.close();}
