/** Approved Render deployment: fresh welcome/demo authentication and role/client navigation.
 * Run only after the requested SHA is live:
 * MOTION_EXPECTED_SHA=<full SHA> CHROMIUM=/path/to/chromium node test/hosted-platform.browser.mjs
 * The private demo key is written with mode 0600 for the separate hosted API runner.
 * Public receipts contain fingerprints, never the access key or key-bearing client IDs.
 */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {chmod,readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const approved='https://pilates-yoga-j1kz.onrender.com';
const base=(process.env.MOTION_BASE_URL||approved).replace(/\/$/,'');
assert.equal(base,approved,'This browser receipt is restricted to the explicitly approved Render service.');
const expected=process.env.MOTION_EXPECTED_SHA;
assert.match(expected||'',/^[a-f0-9]{40}$/,'MOTION_EXPECTED_SHA must identify the complete live commit.');
const reused=Boolean(process.env.MOTION_DEMO_KEY_FILE);
const key=reused?(await readFile(process.env.MOTION_DEMO_KEY_FILE,'utf8')).trim():randomBytes(16).toString('hex');
assert.match(key,/^[a-f0-9]{32}$/,'The private demo key file must contain one valid key.');
const privateKeyFile='/tmp/motion-hosted-browser-private-key-1005';
const fingerprint=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,16);
const redact=value=>String(value).replaceAll(key,'[demo-key-redacted]');
const started=Date.now();
const report={base,expectedCommit:expected,keyFingerprint:fingerprint(key),freshWorkspace:!reused,startedAt:new Date().toISOString(),authAttempts:[],pageErrors:[]};
const browser=await chromium.launch({...(process.env.CHROMIUM?{executablePath:process.env.CHROMIUM}:{}),
  args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.setDefaultTimeout(60000);
const attempts=new WeakMap();
page.on('pageerror',error=>report.pageErrors.push(redact(error.message)));
page.on('request',request=>{
  if(new URL(request.url()).pathname!=='/platform/auth/demo'||request.method()!=='POST')return;
  const body=request.postDataJSON();
  const attempt={role:body.role,keyFingerprint:fingerprint(body.key),
    userFingerprint:body.user_id?fingerprint(body.user_id):null,startedAfterMs:Date.now()-started};
  attempts.set(request,attempt);report.authAttempts.push(attempt);
});
page.on('response',response=>{
  const attempt=attempts.get(response.request());
  if(attempt){attempt.status=response.status();attempt.durationMs=Date.now()-started-attempt.startedAfterMs;}
});
page.on('requestfailed',request=>{
  const attempt=attempts.get(request);
  if(attempt){attempt.failure=redact(request.failure()?.errorText||'Request failed');attempt.durationMs=Date.now()-started-attempt.startedAfterMs;}
});
const request=async(path)=>page.evaluate(async path=>{
  const response=await fetch('/platform/'+path,{credentials:'same-origin'});
  let body;try{body=await response.json();}catch{body={error:'Non-JSON response omitted'};}
  return {status:response.status,body};
},path);
const info=async path=>{const response=await request(path);assert.equal(response.status,200,path.split('?')[0]+' returned '+response.status);return response.body;};
const checkDeployment=async()=>{
  const response=await page.request.get(base+'/evidence/capabilities',{timeout:60000,headers:{'Cache-Control':'no-cache'}});
  assert.equal(response.status(),200,'Deployment capabilities unavailable');
  const capabilities=await response.json();assert.equal(capabilities.deployment?.commit,expected,'The requested deployment is not live.');
  return capabilities.deployment.commit;
};
const role=async(name,heading,userId)=>{
  if(userId){
    // Other acceptance jobs may add clients before this same-key follow-up.
    // Select the original seeded fixture explicitly instead of assuming default order.
    const opening=Date.now();
    const response=await page.request.post(base+'/platform/auth/demo',{data:{key,role:name,user_id:userId},headers:{'X-Platform-Request':'1',Origin:base},timeout:180000});
    report.authAttempts.push({role:name,keyFingerprint:fingerprint(key),userFingerprint:fingerprint(userId),
      status:response.status(),durationMs:Date.now()-opening,explicitFixtureSelection:true});
    assert.equal(response.status(),200,'Explicit fixture role authentication failed.');
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});
  }else await page.locator('#demo-role').selectOption(name);
  await page.getByRole('heading',{name:heading,exact:true}).waitFor({timeout:195000});
  const profile=await info('me');assert.equal(profile.role,name);return profile;
};
const assertClient=async id=>{
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('client'),id);
  await page.locator('.client-context h2').getByText('Sarah Kim',{exact:true}).waitFor();
};
const openSelectedReport=async id=>{
  await page.getByRole('link',{name:'Open this session →',exact:true}).first().click();
  await page.locator('.session-at-glance').waitFor();
  const selected=page.getByRole('link',{name:'Open selected analysis →',exact:true});await selected.waitFor();
  const assessment=new URLSearchParams((await selected.getAttribute('href')).slice(1)).get('id');assert.ok(assessment);
  await selected.click();await page.locator('.report-summary').waitFor();await assertClient(id);
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('id'),assessment);
  assert.match(await page.locator('.report-summary').innerText(),/Sarah Kim/);
  return assessment;
};
try{
  report.liveCommit=await checkDeployment();
  await writeFile(privateKeyFile,key+'\n',{mode:0o600});await chmod(privateKeyFile,0o600);
  await page.goto(base+'/index.html',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('heading',{name:'Welcome to your studio',exact:true}).waitFor();
  await page.evaluate(value=>sessionStorage.setItem('motion-demo-key',value),key);
  const opening=Date.now();await page.getByRole('button',{name:'Explore as coach',exact:true}).click();
  await page.getByRole('heading',{name:'Your coaching day',exact:true}).waitFor({timeout:195000});
  const coach=await info('me');assert.equal(coach.role,'coach');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('motion-demo-key')),key,'Automatic reconnect must retain this fresh workspace key.');
  const initialAttempts=report.authAttempts.filter(attempt=>attempt.role==='coach');
  assert.ok(initialAttempts.length>=1&&initialAttempts.length<=3);assert.equal(initialAttempts.at(-1).status,200);
  assert.ok(initialAttempts.every(attempt=>attempt.keyFingerprint===fingerprint(key)&&attempt.userFingerprint===null));
  report.welcome={elapsedMs:Date.now()-opening,attempts:initialAttempts.length,transientRecovery:initialAttempts.some(attempt=>attempt.status>=500||attempt.failure),normalUIClick:true,fresh:!reused,reused};
  console.log('Welcome/demo reached Coach dashboard:',report.welcome);
  const sarah=coach.students.find(client=>client.name==='Sarah Kim');assert.ok(sarah);
  const organization=coach.organization.id;
  await page.locator('#sidebar').getByRole('link',{name:'My clients',exact:true}).click();
  await page.locator('#people-list .client-card').filter({has:page.getByRole('heading',{name:'Sarah Kim',exact:true})}).click();
  await page.getByRole('heading',{name:'Sarah Kim · coaching workspace',exact:true}).waitFor();await assertClient(sarah.id);
  const client=await info('client?id='+encodeURIComponent(sarah.id));assert.equal(client.sessions.length,20);
  const visitStat=page.locator('.stats .stat').filter({has:page.locator('span',{hasText:'Visits'})});assert.equal(await visitStat.locator('strong').innerText(),'20');
  const assessment=await openSelectedReport(sarah.id);
  await page.locator('.client-return').click();await page.getByRole('heading',{name:'Sarah Kim · coaching workspace',exact:true}).waitFor();await assertClient(sarah.id);
  report.coach={assignedClients:coach.students.length,clientFingerprint:fingerprint(sarah.id),visits:client.sessions.length,
    assessmentFingerprint:fingerprint(assessment),selectedClientPreserved:true,actualSessionReportAndReturn:true};
  const admin=await role('admin','Organization overview');assert.equal(admin.organization.id,organization);
  const seededClients=admin.students.filter(client=>client.id.startsWith(organization+'-student')).length;
  assert.equal(seededClients,34);if(!reused)assert.equal(admin.students.length,34);assert.equal(admin.locations.length,4);
  assert.equal(await page.locator('.stats .stat').filter({has:page.locator('span',{hasText:'Client profiles'})}).locator('strong').innerText(),String(admin.students.length));
  assert.equal(await page.locator('.stats .stat').filter({has:page.locator('span',{hasText:'Locations'})}).locator('strong').innerText(),'4');
  report.admin={clients:admin.students.length,seededClients,locations:admin.locations.length,organizationFingerprint:fingerprint(organization)};
  const student=await role('student','Your practice, today',reused?sarah.id:undefined);assert.equal(student.organization.id,organization);
  assert.deepEqual(student.students.map(client=>client.id),[sarah.id]);assert.equal(student.user.id,sarah.id);
  const foreign=admin.students.find(client=>client.id!==sarah.id);assert.ok(foreign);
  assert.equal((await request('client?id='+encodeURIComponent(foreign.id))).status,403);
  await page.locator('#topbar .breadcrumb').getByRole('link',{name:'My workspace',exact:true}).click();await page.getByRole('heading',{name:'Your practice',exact:true}).waitFor();await assertClient(sarah.id);
  const ownAssessment=await openSelectedReport(sarah.id);
  const advanced=page.locator('.report-advanced').filter({has:page.getByText('Advanced measurements',{exact:true})});
  assert.equal(await advanced.getAttribute('open'),null);assert.equal(await advanced.locator('[data-section=coordinates]').isVisible(),false);
  assert.equal(await page.locator('#review-session').count(),0);
  await page.locator('.client-return').click();await page.getByRole('heading',{name:'Your practice',exact:true}).waitFor();
  await page.locator('.client-tabs').getByRole('link',{name:'Program',exact:true}).click();
  await page.getByRole('heading',{name:'Your current program',exact:true}).waitFor();await assertClient(sarah.id);
  await page.getByRole('link',{name:'Open today’s practice',exact:true}).click();
  await page.getByRole('heading',{name:'Today’s program',exact:true}).waitFor();await assertClient(sarah.id);
  assert.match(await page.getByRole('heading',{name:'Client, source and next step',exact:true}).locator('../..').innerText(),/Sarah Kim.*Assigned plan/s);
  const card=page.locator('.pd-practice-card').first();await card.locator('.pd-why').waitFor();
  const bodyLink=card.locator('a.pd-region-chip').filter({hasText:'View body'}).first();await bodyLink.waitFor();
  const bodyParams=new URLSearchParams((await bodyLink.getAttribute('href')).slice(1));assert.equal(bodyParams.get('client'),sarah.id);assert.ok(bodyParams.get('region'));
  await bodyLink.click();await page.getByRole('heading',{name:'Client body map',exact:true}).waitFor();await assertClient(sarah.id);
  const region=bodyParams.get('region');assert.equal(await page.locator('[name=body-region]').inputValue(),region);
  const frameParams=new URLSearchParams(new URL(await page.locator('#atlas').getAttribute('src'),base).search);assert.equal(frameParams.get('client'),sarah.id);assert.equal(frameParams.get('region'),region);
  await page.locator('.anatomy-region-summary').waitFor();assert.match(await page.locator('.anatomy-region-summary').innerText(),/Sarah Kim/i);
  report.student={ownClientFingerprint:fingerprint(sarah.id),assessmentFingerprint:fingerprint(ownAssessment),foreignClientStatus:403,
    advancedInitiallyCollapsed:true,coordinatesInitiallyHidden:true,coachReviewUnavailable:true,
    assignedProgramAndWhyVisible:true,bodyRegion:region,bodyContextAndIframeClientVerified:true,
    rendererRepeated:false,rendererNote:'Hosted selected-client/body shell verified; full native atlas rendering was verified separately locally.'};
  if(process.env.MOTION_HOSTED_ATLAS==='1'){
    await page.locator('#anatomy-status').getByText('Connected to').waitFor({timeout:45000});
    await page.frameLocator('#atlas').locator('#labels button').first().waitFor({timeout:45000});
    report.student.rendererRepeated=true;report.student.rendererNote='Hosted atlas connected and displayed native structure labels.';
  }
  if(process.env.MOTION_HOSTED_SCREENSHOT)await page.screenshot({path:process.env.MOTION_HOSTED_SCREENSHOT});
  assert.ok(report.authAttempts.every(attempt=>attempt.keyFingerprint===report.keyFingerprint));assert.deepEqual(report.pageErrors,[]);
  report.liveCommitAfter=await checkDeployment();report.result='PASS';
}catch(error){report.result='FAIL';report.error=redact(error.stack||error.message);process.exitCode=1;
  if(process.env.MOTION_HOSTED_FAILURE_SCREENSHOT)await page.screenshot({path:process.env.MOTION_HOSTED_FAILURE_SCREENSHOT}).catch(()=>{});
}finally{
  report.elapsedMs=Date.now()-started;report.finishedAt=new Date().toISOString();
  if(process.env.MOTION_REPORT)await writeFile(process.env.MOTION_REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));await browser.close();
}
