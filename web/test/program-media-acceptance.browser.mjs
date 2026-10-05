/** Disposable local Coach media, exercise-sharing, reusable-plan and narrow-builder acceptance.
 * Uses actual local PNG/MP4 uploads. The video fixture is an existing generated exercise
 * demonstration; capture labels are checked against saved capture rows, not guessed.
 * MOTION_BASE_URL=http://127.0.0.1:8150 CHROMIUM=/path/to/chrome node test/program-media-acceptance.browser.mjs
 */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const base=process.env.MOTION_BASE_URL||'http://127.0.0.1:8150';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'Use a disposable local server.');
const key=process.env.MOTION_DEMO_KEY||randomBytes(16).toString('hex');
const prefix='MEDIA_SCOPE_ACCEPTANCE_'+key.slice(0,6);
const video=await readFile(process.env.MOTION_VIDEO_FIXTURE||new URL('../../../validation/tree-demo.mp4',import.meta.url));
const photo=await readFile(new URL('../assets/studio/bird-dog.png',import.meta.url));
const browser=await chromium.launch({...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1400,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const report={fixture:'Existing local generated exercise PNG/MP4; fictional saved client captures',base};
const request=async(path,body)=>page.evaluate(async({path,body})=>{
  const response=await fetch('/platform/'+path,{credentials:'same-origin',...(body?{method:'POST',headers:{'Content-Type':'application/json','X-Platform-Request':'1'},body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
},{path,body});
const info=async(path)=>{const r=await request(path);assert.equal(r.status,200,path+' '+JSON.stringify(r.body));return r.body;};
const upload=async(exercise,bytes,filename,mime)=>{
  const result=await page.evaluate(async({exercise,data,filename,mime})=>{
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    const r=await fetch('/platform/upload?'+new URLSearchParams({kind:'exercise',exercise_id:exercise,filename}),
      {method:'POST',credentials:'same-origin',headers:{'Content-Type':mime,'X-Platform-Request':'1'},body:bytes});
    return {status:r.status,body:await r.json()};
  },{exercise,data:bytes.toString('base64'),filename,mime});
  assert.equal(result.status,200,JSON.stringify(result.body));return result.body;
};
const switchRole=async(role,user_id)=>{
  const result=await request('auth/demo',{key,role,user_id});assert.equal(result.status,200,JSON.stringify(result.body));
  await page.goto(base+'/index.html');await page.locator('#demo-role').waitFor();return info('me');
};
const openSummary=async(card,text)=>{
  const summary=card.getByText(text,{exact:true});
  if(!(await summary.locator('..').getAttribute('open')!==null))await summary.click();
};
const movement=(name)=>page.locator('.pd-edit-step:not(.pd-edit-note)').filter({has:page.locator('.pd-edit-step-head strong',{hasText:name})}).first();
const openMedia=async(name)=>{const card=movement(name);await openSummary(card,'Configure movement');await openSummary(card,'Photos, videos and references');return card;};
const save=async(reason)=>{
  await page.locator('[name=change_reason]').fill(reason);
  const response=page.waitForResponse(r=>r.url().endsWith('/platform/save')&&r.request().postDataJSON()?.collection==='programs');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  const r=await response;assert.equal(r.status(),200,await r.text());const item=await r.json();
  await page.locator('dialog').waitFor({state:'hidden'});return item;
};
const edit=async(route)=>{await page.goto(route);await page.getByRole('button',{name:'Edit program',exact:true}).click();await page.locator('.pd-edit-step').first().waitFor();};
try{
  await page.goto(base+'/index.html');await page.evaluate(k=>sessionStorage.setItem('motion-demo-key',k),key);
  await page.getByRole('button',{name:'Explore as coach',exact:true}).click();
  await page.getByRole('heading',{name:'Your coaching day',exact:true}).waitFor({timeout:180000});
  const coach=await info('me');const client=coach.students.find(s=>s.name==='Sarah Kim');assert.ok(client);
  const clientData=await info('client?id='+client.id);const assignment=clientData.programs.find(p=>p.active)||clientData.programs[0];
  const route=base+'/index.html#'+new URLSearchParams({page:'program',id:assignment.program_id,client:client.id});
  await edit(route);
  const custom={};
  for(const scope of ['private','organization']){
    await page.locator('#pd-new-exercise').click();
    const box=page.locator('#pd-custom-exercise');const name=prefix+'_'+scope;
    await box.locator('[name=custom_name]').fill(name);await box.locator('[name=custom_scope]').selectOption(scope);
    await box.locator('[name=custom_instruction]').fill('Fixture instruction: move through a comfortable supported range.');
    const response=page.waitForResponse(r=>r.url().endsWith('/platform/save')&&r.request().postDataJSON()?.collection==='exercises');
    await box.getByRole('button',{name:'Create and add',exact:true}).click();const r=await response;
    assert.equal(r.status(),200,await r.text());custom[scope]=await r.json();
    assert.equal(custom[scope].visibility,scope);assert.equal(custom[scope].detail.program_only,false);
    await movement(name).waitFor();
  }
  let saved=await save('Create personal and organization custom movements for disposable acceptance');
  report.custom={private:custom.private.id,organization:custom.organization.id,owner:coach.user.id};
  console.log('Created and saved both custom exercise scopes:',report.custom);
  const assets={
    shared:await upload(custom.private.id,video,'existing-library-clip.mp4','video/mp4'),
    privateVideo:await upload(custom.private.id,video,'coach-only-clip.mp4','video/mp4'),
    privatePhoto:await upload(custom.private.id,photo,'coach-only-photo.png','image/png'),
  };
  await edit(route);const name=custom.private.name;
  for(const [kind,asset] of Object.entries(assets)){
    let card=await openMedia(name);await card.locator('[name=existing_media]').selectOption(asset.id);
    await card.locator('[name=new_media_kind]').selectOption(kind==='privatePhoto'?'coach_photo':'exercise_library');
    await card.getByRole('button',{name:'Add selected media',exact:true}).click();card=await openMedia(name);
    const row=card.locator('.pd-media-row').last();await row.locator('[name=media_caption]').fill(prefix+'_'+kind);
    await row.locator('[name=media_visibility]').selectOption(kind==='shared'?'student':'coach');
  }
  let card=await openMedia(name);
  const captures=(await info('list?'+new URLSearchParams({collection:'media',student_id:client.id,limit:'200'}))).items.filter(m=>m.kind==='capture');
  assert.ok(captures.length);const capture=captures.find(m=>m.capture_view&&m.capture_protocol)||captures[0];
  const labels=await card.locator('[name=client_capture] option').evaluateAll(options=>options.map(o=>({id:o.value,label:o.textContent})));
  const selectedLabel=labels.find(o=>o.id===capture.id);assert.ok(selectedLabel);
  assert.match(selectedLabel.label,/Photo|Video/);assert.match(selectedLabel.label,/uploaded/);
  assert.ok(selectedLabel.label.includes(capture.filename));
  if(capture.capture_view)assert.ok(selectedLabel.label.includes(({front:'Front',rear:'Back',side_left:'Left side',side_right:'Right side'}[capture.capture_view]||capture.capture_view)+' view'));
  if(capture.capture_protocol)assert.ok(selectedLabel.label.includes(capture.capture_protocol));
  assert.equal(new Set(labels.filter(o=>o.id).map(o=>o.label)).size,labels.filter(o=>o.id).length,'Repeated filenames must retain distinct capture choice labels.');
  await card.locator('[name=client_capture]').selectOption(capture.id);await card.locator('[name=client_capture_caption]').fill(prefix+'_saved_client_capture');
  await card.getByRole('button',{name:'Attach client capture',exact:true}).click();
  card=await openMedia(name);assert.equal(await card.locator('.pd-media-row').last().locator('[name=media_kind]').inputValue(),'client_capture');
  report.clientCapture={id:capture.id,option:selectedLabel.label,view:capture.capture_view,protocol:capture.capture_protocol};
  await page.locator('#pd-add-section').click();await page.locator('[name=section_name]').fill(prefix+'_empty');
  await page.locator('#pd-apply-section-name').click();
  const empty=page.locator('[data-section="'+prefix+'_empty"]');await empty.waitFor();
  card=movement(name);await openSummary(card,'Configure movement');
  const retained='Unsaved rationale must survive empty-section removal.';
  await card.locator('[name=why_assigned]').fill(retained);
  await empty.locator('[data-remove-section]').click();
  assert.equal(await empty.count(),0);card=movement(name);await openSummary(card,'Configure movement');
  assert.equal(await card.locator('[name=why_assigned]').inputValue(),retained,'Removing an empty section must preserve other card edits.');
  saved=await save('Existing clip/client capture, Coach-only media and empty section removal acceptance');
  assert.ok(!saved.detail.sections.includes(prefix+'_empty'));
  const step=saved.steps.find(s=>s.exercise_id===custom.private.id);assert.equal(step.detail.why_assigned,retained);
  assert.equal(step.detail.media.find(m=>m.media_id===assets.shared.id).primary,true);
  assert.equal(step.detail.media.find(m=>m.media_id===capture.id).kind,'client_capture');
  report.media=Object.fromEntries(Object.entries(assets).map(([k,v])=>[k,{id:v.id,mime:v.mime,size:v.size}]));
  report.emptySection='removed and saved; unsaved other-card rationale retained';
  await edit(route);await page.setViewportSize({width:390,height:844});await movement(name).scrollIntoViewIfNeeded();
  const narrow=await page.locator('dialog').evaluate(d=>({left:d.getBoundingClientRect().left,right:d.getBoundingClientRect().right,
    width:innerWidth,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth}));
  assert.ok(narrow.left>=0&&narrow.right<=narrow.width+1);assert.ok(narrow.scrollWidth<=narrow.clientWidth+1,JSON.stringify(narrow));
  const titleWidth=await movement(name).locator('.pd-edit-step-head > div:nth-child(2)').evaluate(el=>el.getBoundingClientRect().width);
  assert.ok(titleWidth>180,'Narrow movement names need a readable line, not a column of individual characters.');
  await movement(name).getByRole('button',{name:'Duplicate',exact:true}).waitFor({state:'visible'});
  const narrowCard=await openMedia(name);
  for(const selector of ['[name=existing_media]','[name=client_capture]']){
    const picker=narrowCard.locator(selector);await picker.scrollIntoViewIfNeeded();
    assert.ok(await picker.isVisible());
    const bounds=await picker.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:innerWidth}));
    assert.ok(bounds.left>=0&&bounds.right<=bounds.width+1,'Narrow picker must stay inside the viewport: '+JSON.stringify(bounds));
  }
  assert.ok(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1),'Expanded narrow media controls must not cause horizontal scrolling.');
  await movement(name).locator('.pd-edit-step-head').scrollIntoViewIfNeeded();
  if(process.env.MOTION_NARROW_SCREENSHOT)await page.screenshot({path:process.env.MOTION_NARROW_SCREENSHOT});
  report.narrow={...narrow,titleWidth};await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.setViewportSize({width:1400,height:1000});
  const studentLogin=page.waitForResponse(r=>r.url().endsWith('/platform/auth/demo')&&r.request().postDataJSON()?.role==='student');
  await page.locator('#demo-role').selectOption('student');assert.equal((await (await studentLogin).json()).role,'student');
  await page.getByRole('heading',{name:'Your practice, today',exact:true}).waitFor();await page.goto(route);await page.reload();
  const studentCard=page.locator('.pd-practice-card').filter({hasText:name}).first();await studentCard.waitFor();
  await studentCard.scrollIntoViewIfNeeded();await studentCard.getByText(prefix+'_shared',{exact:true}).waitFor();
  await studentCard.getByText(prefix+'_saved_client_capture',{exact:true}).waitFor();
  const studentText=await page.locator('#page-content').innerText();
  for(const kind of ['privatePhoto','privateVideo'])assert.ok(!studentText.includes(prefix+'_'+kind));
  assert.equal(await studentCard.locator('.pd-media').filter({hasText:prefix+'_shared'}).locator('.pd-media-badge').innerText(),'Primary demonstration · Exercise library media');
  assert.equal(await studentCard.locator('.pd-media').filter({hasText:prefix+'_saved_client_capture'}).locator('.pd-media-badge').innerText(),'Client capture');
  await page.waitForFunction(id=>{const v=document.querySelector(`video[src="/platform/media?id=${id}"]`);return v?.readyState>=2&&v.videoWidth>0;},assets.shared.id);
  for(const id of [assets.privatePhoto.id,assets.privateVideo.id]){
    const denied=await request('record?collection=media&id='+id);assert.ok([403,404].includes(denied.status));
    const download=await page.evaluate(async id=>(await fetch('/platform/media?id='+id)).status,id);assert.ok([403,404].includes(download));
  }
  const studentExercise=await info('record?collection=exercises&id='+custom.private.id);
  assert.ok(studentExercise.media.some(m=>m.id===assets.shared.id));
  assert.ok(!studentExercise.media.some(m=>[assets.privatePhoto.id,assets.privateVideo.id].includes(m.id)));
  report.student='shared clip decodes; saved client capture shown; Coach-only photo/video absent from UI, exercise API and direct media download';
  if(process.env.MOTION_STUDENT_SCREENSHOT)await page.screenshot({path:process.env.MOTION_STUDENT_SCREENSHOT});
  const unrelatedStudent=coach.students.find(s=>s.id!==client.id);assert.ok(unrelatedStudent);
  await switchRole('student',unrelatedStudent.id);
  assert.equal((await request('record?collection=exercises&id='+custom.private.id)).status,404);
  assert.equal((await info('record?collection=exercises&id='+custom.organization.id)).id,custom.organization.id);
  const admin=await switchRole('admin');
  assert.equal((await info('record?collection=exercises&id='+custom.private.id)).id,custom.private.id);
  assert.equal((await info('record?collection=exercises&id='+custom.organization.id)).id,custom.organization.id);
  const otherCoach=admin.coaches.find(c=>c.id!==coach.user.id);assert.ok(otherCoach);await switchRole('coach',otherCoach.id);
  assert.equal((await request('record?collection=exercises&id='+custom.private.id)).status,404);
  assert.equal((await info('record?collection=exercises&id='+custom.organization.id)).id,custom.organization.id);
  await page.goto(base+'/index.html#page=exercises');await page.locator('[name=repertoire-search]').fill(prefix);
  await page.locator('#repertoire-list').getByText(custom.organization.name,{exact:true}).waitFor();
  assert.equal(await page.locator('#repertoire-list').getByText(custom.private.name,{exact:true}).count(),0);
  report.exerciseScope='creator and organization Admin can access both; unrelated Coach sees organization item but private item returns404 and is absent from repertoire; assigned Student can open the private movement; unrelated Student can access organization exercise but private exercise returns404';
  await switchRole('coach',coach.user.id);
  const second=coach.students.find(s=>s.id!==client.id);assert.ok(second);
  const foreignRoute=base+'/index.html#'+new URLSearchParams({page:'program',id:assignment.program_id,client:second.id});
  await edit(foreignRoute);assert.equal(await page.locator('.pd-source-link').count(),0,'Original client report must not appear in destination draft.');
  const copied=await save('Reuse this plan for another assigned client without foreign evidence');assert.notEqual(copied.id,assignment.program_id);
  assert.equal(copied.detail.student_id,second.id);assert.equal(copied.detail.source_analysis_id,null);assert.equal(copied.detail.source_finding,'');
  assert.ok(!copied.steps.some(s=>s.detail?.media?.some(m=>m.kind==='client_capture')));
  assert.ok(!copied.steps.some(s=>s.detail?.source?.id&&clientData.analyses.some(a=>a.id===s.detail.source.id)));
  const original=await info('record?collection=programs&id='+assignment.program_id);
  assert.equal(original.version,saved.version,'Reusing a plan must not create a revision on the original client program.');
  assert.equal(original.detail.source_analysis_id,saved.detail.source_analysis_id);
  assert.ok(original.steps.some(s=>s.detail?.media?.some(m=>m.media_id===capture.id)));
  const secondData=await info('client?id='+second.id);assert.ok(secondData.programs.some(p=>p.program_id===copied.id&&p.active));
  report.reusablePlan={original:assignment.program_id,copied:copied.id,destination:second.id,source:'foreign assessment/finding/capture removed; original unchanged; destination assignment active'};
  assert.ok((await page.locator('.pd-atlas').evaluateAll(frames=>frames.map(f=>f.getAttribute('src')))).every(src=>!src||src==='about:blank'));
  assert.deepEqual(errors,[]);report.pageErrors=errors;report.result='PASS';console.log(JSON.stringify(report,null,2));
  if(process.env.MOTION_REPORT)await writeFile(process.env.MOTION_REPORT,JSON.stringify(report,null,2)+'\n');
}catch(error){console.error('FAIL:',error.stack);process.exitCode=1;if(process.env.MOTION_FAILURE_SCREENSHOT)await page.screenshot({path:process.env.MOTION_FAILURE_SCREENSHOT}).catch(()=>{});}
finally{await browser.close();}
