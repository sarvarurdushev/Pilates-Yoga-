"""Workspace isolation, asynchronous persistence, and upload failure contracts."""
import io
import json
import time
import threading
import urllib.request
import urllib.error

import pytest
from pilates import studio, assessment
from pilates.serve import serve, WEB
from test_alignment import standing
from test_intake_api import png

pytestmark = pytest.mark.mvp

A='live-'+'a'*32
B='live-'+'b'*32
D='demo-'+'d'*32

@pytest.fixture
def repo(tmp_path):
    return studio.Repository(str(tmp_path/'studio.db'))

def wait_job(jobs,key,identifier):
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        result=jobs.get(key,identifier)
        if result['state'] in ('done','failed'):
            return result
        time.sleep(.01)
    pytest.fail('job did not finish')

def test_personal_and_demo_records_are_isolated_and_persist(repo):
    assert repo.load(A)['clients']==[]
    demo=repo.load(D)
    assert len(demo['clients'])==24 and len(demo['reports'])==144
    saved=repo.save_item(A,'clients',{'name':'Local test','demo':True})
    assert saved['demo'] is False
    assert repo.load(B)['clients']==[]
    assert studio.Repository(repo.path).load(A)['clients'][0]['name']=='Local test'
    assert all(r['demo'] for r in demo['reports'])

def test_untrusted_report_and_workspace_writes_are_rejected(repo):
    with pytest.raises(ValueError):repo.load('not-a-workspace')
    with pytest.raises(ValueError):repo.save_item(A,'reports',{'id':'made-up','score':100})
    with pytest.raises(ValueError):repo.save_item(A,'clients',{'id':'../../x'})
    with pytest.raises(ValueError):repo.save_item(A,'clients',{'weight':float('nan')})

def test_multi_view_job_preserves_view_evidence_and_refusals(repo,monkeypatch):
    def fake(payload):
        p=assessment.assess_person(standing(),800,900,view='front')
        if payload['view']=='rear':p.update(suitable=False,metrics=[],score={'value':None})
        return {'people':[p],'width':800,'height':900}
    monkeypatch.setattr(studio.assessment,'photo',fake)
    jobs=studio.AnalysisJobs(repo)
    result=jobs.submit_photo(A,{'client':{'name':'Test'},'photos':[{'view':'front','image':'x'},{'view':'rear','image':'y'}]})
    assert jobs.get(B,result['id']) is None
    done=wait_job(jobs,A,result['id'])
    assert done['state']=='done'
    report=done['result']
    assert report['summary']['complete_views']==1
    assert len(report['views'])==2
    assert repo.load(A)['reports'][0]['id']==report['id']
    assert all('image' not in v and 'image' not in v['report'] for v in report['views'])
    jobs.executor.shutdown()

def test_job_error_is_readable_and_does_not_create_report(repo,monkeypatch):
    def fail(_):raise ValueError('Insufficient image bytes')
    monkeypatch.setattr(studio.assessment,'photo',fail)
    jobs=studio.AnalysisJobs(repo)
    r=jobs.submit_photo(A,{'photos':[{'view':'front','image':'bad'}]})
    done=wait_job(jobs,A,r['id'])
    assert done['state']=='failed' and done['error']=='Insufficient image bytes'
    assert repo.load(A)['reports']==[]
    jobs.executor.shutdown()

def test_duplicate_and_missing_views_refused_before_queue(repo):
    jobs=studio.AnalysisJobs(repo)
    for photos in ([],[{'view':'front'},{'view':'front'}],[{'view':'unknown'}],[None]):
        with pytest.raises(ValueError):jobs.submit_photo(A,{'photos':photos})
    assert not jobs.items
    jobs.executor.shutdown()

def test_two_active_jobs_limit_memory(repo,monkeypatch):
    gate=threading.Event()
    monkeypatch.setattr(studio.assessment,'photo',lambda _: (gate.wait(5) or {'people':[]}))
    jobs=studio.AnalysisJobs(repo)
    try:
        for _ in range(2):jobs.submit_photo(A,{'photos':[{'view':'front','image':'x'}]})
        with pytest.raises(ValueError,match='busy'):jobs.submit_photo(B,{'photos':[{'view':'front','image':'x'}]})
    finally:
        gate.set();jobs.executor.shutdown()

def test_interrupted_video_does_not_leave_temporary_media(repo,monkeypatch,tmp_path):
    monkeypatch.setattr(studio.tempfile,'tempdir',str(tmp_path))
    jobs=studio.AnalysisJobs(repo)
    with pytest.raises(ValueError,match='interrupted'):jobs.submit_video(A,{'view':'front'},io.BytesIO(b'x'),20)
    assert list(tmp_path.glob('studio-video-*'))==[]
    assert list(jobs.items.values())[0]['state']=='failed'
    jobs.executor.shutdown()

def test_portrait_class_toggle_preserves_full_body(monkeypatch):
    from pilates.pose import TiledBackend
    def forbidden(*args,**kwargs):pytest.fail('A narrow portrait must not use class tiles')
    monkeypatch.setattr(TiledBackend,'__call__',forbidden)
    d=standing(cx=150)
    report=assessment.photo({'image':png(300,900),'view':'front','include_3d':False,'tiled':True},backend=lambda _: [d])
    assert len(report['people'])==1 and report['tiled'] is False

def test_http_jobs_return_json_and_workspace_cannot_read_other_job(tmp_path,monkeypatch):
    monkeypatch.setattr(studio.assessment,'photo',lambda _: {'people':[]})
    server,url=serve(None,root=WEB,port=0,analyse=True,db=str(tmp_path/'http.db'))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base=url.split('/index.html')[0]
    def call(path,key=A,body=None):
        req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'X-Studio-Workspace':key,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r)
        except urllib.error.HTTPError as r:return r.code,json.load(r)
    try:
        status,job=call('/studio/analyse',body={'photos':[{'view':'front','image':'bad'}]})
        assert status==202 and job['id']
        assert call('/studio/job?id='+job['id'],B)[0]==404
        assert call('/studio/state','bad')[0]==400
        assert call('/studio/save',body={'collection':'reports','item':{'score':100}})[0]==400
    finally:server.shutdown();server.server_close()

def test_movement_summary_only_exposes_supported_ranges():
    report={'people':[{'person_id':'1','suitable':True,'signals':{'left_knee':{'rom':32.4,'repetitions':2,'confidence':.9,'status':'estimated'},'right_knee':{'status':'unavailable'}}},{'person_id':'2','suitable':False,'signals':{'left_knee':{'rom':100}}}]}
    summary=studio.movement_summary(report,'side_left')
    assert len(summary['metrics'])==1
    assert summary['metrics'][0]['value']==32.4
    assert summary['metrics'][0]['status']=='estimated'
    assert summary['score'] is None
    assert '2 complete cycles' in summary['findings'][0]['text']
