/** Disposable local WebGL acceptance. Run against a running pilates web server.
 * MOTION_BASE_URL=http://127.0.0.1:8153 CHROMIUM=/path/to/chrome node test/platform-feedback-markers.browser.mjs
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
const base = process.env.MOTION_BASE_URL || 'http://127.0.0.1:8153';
const key = process.env.MOTION_DEMO_KEY || randomBytes(16).toString('hex');
const browser = await chromium.launch({...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox']});
const page = await browser.newPage({viewport:{width:1400,height:900}});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const info = async (path) => page.evaluate(async p=>{const r=await fetch(p,{credentials:'same-origin'});if(!r.ok)throw Error(p+' '+r.status);return r.json()},path);
const params=()=>new URLSearchParams(new URL(page.url()).hash.slice(1));
const waitConnected=async()=>{await page.locator('#anatomy-status').getByText('Connected to').waitFor({timeout:180000}); await page.frameLocator('#atlas').locator('#client-feedback-markers button').first().waitFor({state:'attached',timeout:180000});};
const waitVisibleCount=async(n)=>page.waitForFunction(count=>{const doc=document.querySelector('#atlas')?.contentDocument;return [...(doc?.querySelectorAll('#client-feedback-markers button')||[])].filter(b=>!b.hidden&&b.getBoundingClientRect().width>0).length>=count},n,{timeout:60000});
const markerState=async()=>page.frameLocator('#atlas').locator('#client-feedback-markers button').evaluateAll(buttons=>buttons.map(b=>({region:b.dataset.feedbackRegion,noteId:b.dataset.noteId,anchorX:Number(b.dataset.anchorX),anchorY:Number(b.dataset.anchorY),hidden:b.hidden,x:b.offsetLeft,y:b.offsetTop,rect:b.getBoundingClientRect().toJSON(),stage:document.querySelector('#stage').getBoundingClientRect().toJSON()})));
const visible=(rows)=>rows.filter(x=>!x.hidden&&x.rect.width>0&&x.rect.height>0);
try{
  await page.goto(base+'/index.html');
  await page.evaluate(k=>sessionStorage.setItem('motion-demo-key',k),key);
  await page.getByRole('button',{name:'Explore as admin'}).click();
  await page.locator('#demo-role').waitFor({timeout:180000});
  const coachLogin=page.waitForResponse(r=>r.url().endsWith('/platform/auth/demo') && r.request().postDataJSON()?.role==='coach');
  await page.locator('#demo-role').selectOption('coach');
  assert.equal((await (await coachLogin).json()).role,'coach');
  const profile=await info('/platform/me');
  const sarah=profile.students.find(c=>c.name==='Sarah Kim'); assert.ok(sarah);
  let c=await info('/platform/client?id='+encodeURIComponent(sarah.id));
  if(!c.notes.some(n=>n.region_id==='left_hip')){
    const visit=c.sessions[0];assert.ok(visit,'demo has an exact saved visit to link');
    const result=await page.evaluate(async data=>{const response=await fetch('/platform/save',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Platform-Request':'1'},body:JSON.stringify({collection:'notes',item:data})});return {status:response.status,body:await response.json()}},{student_id:sarah.id,region_id:'left_hip',session_id:visit.id,text:'Disposable acceptance note: observe a comfortable left hip range.',visibility:'student',detail:{source:'browser_acceptance'}});
    assert.equal(result.status,200,JSON.stringify(result.body));
    console.log('Saved disposable linked left-hip note:',result.body.id,'visit',visit.id);
    c=await info('/platform/client?id='+encodeURIComponent(sarah.id));
  }
  for (const region_id of ['both_hip','right_knee']) {
    if (c.notes.some(n=>n.region_id===region_id)) continue;
    const response=await page.evaluate(async data=>{const r=await fetch('/platform/save',{method:'POST',headers:{'Content-Type':'application/json','X-Platform-Request':'1'},body:JSON.stringify({collection:'notes',item:data})});return {status:r.status,body:await r.json()}},{student_id:sarah.id,region_id,session_id:c.sessions[0].id,text:'Disposable acceptance note for '+region_id,visibility:'student',detail:{source:'browser_acceptance'}});
    assert.equal(response.status,200,JSON.stringify(response.body));
  }
  c=await info('/platform/client?id='+encodeURIComponent(sarah.id));
  const regions=[...new Set(c.notes.map(n=>n.region_id).filter(Boolean))];
  console.log('Disposable sources:',JSON.stringify(c.notes.filter(n=>n.text.startsWith('Disposable')).map(n=>({id:n.id,region:n.region_id,session:n.session_id}))));
  console.log('Coach Sarah:',sarah.id,'notes:',c.notes.length,'note regions:',regions.join(','));
  assert.ok(regions.includes('right_shoulder'));
  const shoulderNotes=c.notes.filter(n=>n.region_id==='right_shoulder').sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  const note=shoulderNotes[0]; assert.ok(note);
  // A fresh untargeted map has never isolated a full-atlas structure.
  await page.goto(base+'/index.html#page=client&client='+sarah.id+'&tab=anatomy');
  await waitConnected(); await waitVisibleCount(regions.length);
  const fresh = visible(await markerState());
  assert.deepEqual(fresh.map(x=>x.region).sort(), regions.slice().sort());
  assert.ok(fresh.every(x=>x.rect.x>=x.stage.x && x.rect.y>=x.stage.y && x.rect.right<=x.stage.right && x.rect.bottom<=x.stage.bottom));
  console.log('Fresh Coach feedback map:',fresh.map(x=>x.region));
  await page.waitForTimeout(1000); // Let the deliberate whole-body camera flight settle.
  const placement=await page.frameLocator('#atlas').locator('#stage').evaluate(async stage=>{
    const atlas=await import('/src/main.js');
    const rect=stage.getBoundingClientRect();
    const button=document.querySelector('[data-feedback-region=right_knee]');
    const point=atlas.jointCentre('knee_angle_r').project(atlas.gfx.camera);
    const expected={x:(point.x+1)/2*rect.width,y:(1-point.y)/2*rect.height};
    return {expected,anchor:{x:Number(button.dataset.anchorX),y:Number(button.dataset.anchorY)}};
  });
  assert.ok(Math.hypot(placement.expected.x-placement.anchor.x,placement.expected.y-placement.anchor.y)<1,'knee anchor follows the actual posed rig joint');
  console.log('Right-knee rig/marker anchor:',placement);
  const separated=visible(await markerState());
  for(let i=0;i<separated.length;i++)for(let j=i+1;j<separated.length;j++)
    assert.ok(Math.hypot(separated[i].x-separated[j].x,separated[i].y-separated[j].y)>=46,'nearby markers have separate clickable centres');
  if(process.env.MOTION_SCREENSHOT) await page.screenshot({path:process.env.MOTION_SCREENSHOT});
  await page.goto(base+'/index.html#page=client&client='+sarah.id+'&tab=anatomy&region=right_shoulder&id='+note.analysis_id);
  await page.reload();
  await waitConnected(); await waitVisibleCount(1);
  assert.equal(await page.locator('[name=anatomy-layer]').inputValue(),'region');
  let rows=await markerState();
  const targeted=visible(rows);
  console.log('Targeted direct link:',targeted.map(x=>x.region),'hash',new URL(page.url()).hash);
  assert.ok(targeted.some(x=>x.region==='right_shoulder'));
  assert.ok(targeted.every(x=>x.region==='right_shoulder'));
  await page.locator('[name=anatomy-layer]').selectOption('feedback');
  await page.waitForFunction(()=>new URLSearchParams(location.hash.slice(1)).get('view')==='feedback');
  await waitVisibleCount(regions.length);
  rows=await markerState();
  let shown=visible(rows);
  console.log('Feedback map visible:',shown.map(x=>`${x.region}:${x.noteId}@${x.x},${x.y}`).join(' | '));
  assert.ok(shown.length>=2,'expected multiple mapped regions from demo');
  assert.ok(shown.every(x=>x.rect.x>=x.stage.x && x.rect.y>=x.stage.y && x.rect.right<=x.stage.right && x.rect.bottom<=x.stage.bottom),'marker buttons stay on the WebGL stage');
  await page.reload(); await waitConnected(); await waitVisibleCount(regions.length);
  assert.equal(await page.locator('[name=anatomy-layer]').inputValue(),'feedback');
  assert.equal(params().get('view'),'feedback');
  rows=await markerState(); shown=visible(rows);
  console.log('Feedback after reload:',shown.map(x=>x.region));
  assert.ok(shown.length>=2);
  const target=shown.find(x=>x.region==='right_shoulder')||shown[0];
  await page.frameLocator('#atlas').locator(`[data-feedback-region="${target.region}"]`).click({timeout:30000});
  await page.waitForFunction(r=>new URLSearchParams(location.hash.slice(1)).get('region')===r&&new URLSearchParams(location.hash.slice(1)).get('view')==='region',target.region,{timeout:180000});
  await page.waitForFunction(()=>document.querySelector('[name=anatomy-layer]')?.value==='region');
  await waitConnected();
  await page.locator('.anatomy-region-summary h2').getByText(profile.regions.find(r=>r.id===target.region).name,{exact:true}).waitFor();
  const clickedNote=c.notes.find(n=>n.id===target.noteId);assert.ok(clickedNote);
  await page.locator('.anatomy-context .note').filter({hasText:clickedNote.text}).first().waitFor({timeout:60000});
  const src=await page.locator('.anatomy-context .note').filter({hasText:clickedNote.text}).first().locator('a[href*="tab=sessions"]').first().getAttribute('href');
  const srcp=new URLSearchParams(src.slice(1));
  assert.equal(srcp.get('session')||srcp.get('assessment'),clickedNote.session_id||clickedNote.analysis_id);
  assert.equal(srcp.get('client'),sarah.id);
  console.log('Clicked marker route/note/source:',target.region,target.noteId,src);
  await page.locator('[name=anatomy-layer]').selectOption('feedback');
  await waitVisibleCount(regions.length);
  const other=visible(await markerState()).find(x=>x.region==='both_hip' && c.notes.some(n=>n.id===x.noteId && (n.session_id||n.analysis_id)));
  assert.ok(other,'the saved bilateral-hip marker retains its exact visit link');
  if(other){
    await page.frameLocator('#atlas').locator(`[data-feedback-region="${other.region}"]`).click({timeout:30000});
    await page.waitForFunction(r=>new URLSearchParams(location.hash.slice(1)).get('region')===r,other.region,{timeout:180000});
    await page.waitForFunction(()=>document.querySelector('[name=anatomy-layer]')?.value==='region');
    await waitConnected();
    const otherNote=c.notes.find(n=>n.id===other.noteId);assert.ok(otherNote);
    await page.locator('.anatomy-context .note').filter({hasText:otherNote.text}).first().waitFor({timeout:60000});
    const otherSrc=await page.locator('.anatomy-context .note').filter({hasText:otherNote.text}).first().locator('a[href*="tab=sessions"]').first().getAttribute('href');
    const op=new URLSearchParams(otherSrc.slice(1));assert.equal(op.get('session')||op.get('assessment'),otherNote.session_id||otherNote.analysis_id);
    console.log('Second marker route/note/source:',other.region,other.noteId,otherSrc);
  }
  await page.locator('[name=anatomy-layer]').selectOption('feedback');
  await waitVisibleCount(regions.length);
  const left=visible(await markerState()).find(x=>x.region==='left_hip'); assert.ok(left);
  await page.frameLocator('#atlas').locator('[data-feedback-region=left_hip]').click({timeout:30000});
  await page.waitForFunction(()=>new URLSearchParams(location.hash.slice(1)).get('region')==='left_hip'&&document.querySelector('[name=anatomy-layer]')?.value==='region');
  await waitConnected();
  const leftNote=c.notes.find(n=>n.id===left.noteId);assert.ok(leftNote);
  const leftSource=page.locator('.anatomy-context .note').filter({hasText:leftNote.text}).first().locator('a[href*="tab=sessions"]').first();
  await leftSource.waitFor();
  const leftURL=await leftSource.getAttribute('href');
  assert.equal(new URLSearchParams(leftURL.slice(1)).get('session'),leftNote.session_id);
  await leftSource.click();
  await page.waitForFunction(()=>new URLSearchParams(location.hash.slice(1)).get('tab')==='sessions'&&document.querySelector('.page-head h1')?.textContent.startsWith('Visit'));
  assert.equal(params().get('session'),leftNote.session_id);
  await page.locator('#page-content .note').filter({hasText:leftNote.text}).first().waitFor();
  console.log('Left-hip marker and actual source visit open:',leftNote.session_id);
  const studentLogin=page.waitForResponse(r=>r.url().endsWith('/platform/auth/demo') && r.request().postDataJSON()?.role==='student');
  await page.locator('#demo-role').selectOption('student');
  assert.equal((await (await studentLogin).json()).role,'student');
  const student=await info('/platform/me');
  console.log('Student identity:',JSON.stringify({role:student.role,user:student.user.id,students:student.students.map(s=>s.id)}));
  const own=student.students.find(s=>s.id===student.user.id);assert.ok(own);
  const sc=await info('/platform/client?id='+own.id);
  await page.goto(base+'/index.html#page=client&client='+own.id+'&tab=anatomy'); await page.reload(); await waitConnected(); await waitVisibleCount(1);
  rows=await markerState(); shown=visible(rows);
  console.log('Student own map:',own.id,'notes:',sc.notes.length,'visible regions:',shown.map(x=>x.region));
  assert.ok(shown.length>=1);
  assert.ok(shown.every(x=>sc.notes.some(n=>n.region_id===x.region)));
  await page.reload(); await waitConnected(); await waitVisibleCount(1);
  const reloaded=visible(await markerState());
  assert.ok(reloaded.every(x=>sc.notes.some(n=>n.region_id===x.region)));
  assert.ok(reloaded.every(x=>x.rect.x>=x.stage.x && x.rect.y>=x.stage.y && x.rect.right<=x.stage.right && x.rect.bottom<=x.stage.bottom));
  console.log('Student own map after fresh reload:',reloaded.map(x=>x.region));
  assert.deepEqual(errors,[]);
  console.log('PASS: Coach and Student atlas marker acceptance, no page errors');
}catch(e){ console.error('FAIL:',e.stack);process.exitCode=1; }
finally{await browser.close();}
