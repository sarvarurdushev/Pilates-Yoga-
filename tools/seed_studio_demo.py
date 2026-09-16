"""Create the explicitly synthetic investor dataset; contains no real client data."""
import json, math, random
from datetime import datetime, timedelta
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
rng=random.Random(72026)
TODAY=datetime(2026,9,16,9)
names=['Alex Morgan','Sofia Park','Daniel Kim','Maya Chen','Noah Lee','Olivia Brooks','Ethan Cho','Emma Patel','Lucas Rivera','Chloe Han','Liam Wilson','Ava Rossi','Leo Martin','Isla Jung','Oliver Cruz','Mia Scott','James Lin','Nora Davis','Theo Wang','Zoe Nguyen','Henry Moon','Ella Reed','Felix Song','Luna Costa']
goals=['Build a consistent Pilates practice','Improve movement confidence','Develop strength and balance','Return to regular studio classes','Explore shoulder mobility','Track posture with repeatable captures']
clients=[];reports=[];notes=[];bookings=[];payments=[]
points=[[.5,.105],[.47,.10],[.53,.10],[.44,.12],[.56,.12],[.37,.24],[.63,.24],[.32,.39],[.68,.39],[.30,.53],[.70,.53],[.43,.51],[.57,.51],[.43,.71],[.57,.71],[.42,.925],[.58,.925]]
bones=[[5,6],[5,11],[6,12],[11,12],[5,7],[7,9],[6,8],[8,10],[11,13],[13,15],[12,14],[14,16],[0,1],[0,2],[1,3],[2,4]]

def metric(id,name,value,region,view,unit='deg'):
 return {'id':id,'name':name,'value':round(value,1 if unit=='deg' else 3),'unit':unit,'confidence':.91,'status':'demo','region':region,'view':view,'source':'Synthetic demonstration data','reason':'Illustrative value, not measured from the sample photograph.'}

for i,name in enumerate(names):
 cid=f'demo-client-{i+1:02d}';start=TODAY-timedelta(days=185-i*3)
 clients.append({'id':cid,'name':name,'email':name.lower().replace(' ','.')+'@example.invalid','joined':start.date().isoformat(),'goal':goals[i%len(goals)],'age':27+i%22,'height_cm':round(163+i%19,1),'weight_kg':round(55+i%23+.4,1),'status':'active' if i<21 else 'follow-up','coach':'Jamie Lee','demo':True,'avatar_color':['blue','violet','teal','amber'][i%4],'plan':'Movement foundations' if i%2==0 else 'Mobility & balance'})
 for visit in range(6):
  date=TODAY-timedelta(days=(5-visit)*30+i%7)
  if visit==5:date-=timedelta(days=i%4)
  factor=1-visit*.105 if i%5 else 1-visit*.03
  sh=(5.8+i%4)*factor;hip=(4.2+i%3)*factor;head=(7.6+i%4)*factor
  views=[];allmetrics=[]
  for vi,view in enumerate(['front','rear','side_left','side_right']):
   metrics=[metric('head_lateral_tilt','Head / ear-line tilt',head,'Head',view),metric('shoulder_tilt','Shoulder height difference',sh,'Shoulders',view),metric('pelvic_obliquity','Hip height difference',hip,'Pelvis',view),metric('trunk_lean_lateral','Lateral trunk inclination',2.4*factor,'Torso',view)] if vi<2 else [metric('forward_head','Forward-head offset proxy',.18*factor,'Head',view,'ratio'),metric('trunk_lean_sagittal','Sagittal trunk inclination',4.4*factor,'Torso',view)]
   allmetrics+=metrics
   kp=[[round(x*400,1),round(y*700,1)] for x,y in points]
   if vi>=2:kp=[[200+(x-.5)*.22*400,round(y*700,1)] for x,y in points]
   score=round(100-(abs(sh)+abs(hip)+abs(head)+2.4*factor)*2.5,1)
   person={'person_id':'1','suitable':True,'mode':'standing','view':view,'view_source':'Synthetic demo view','metrics':metrics,'score':{'value':score,'reason':'Illustrative trend, not a validated clinical score.'},'landmarks':{'keypoints':kp,'scores':[.95]*17,'bones':bones},'validation':{'valid':True,'reasons':[],'checks':{'visible_core_joints':8}},'pose3d':{'status':'unavailable','reason':'Open the anatomy reference to explore a general body model. Demo photography is not a 3D scan.'}}
   views.append({'view':view,'image':{'src':'/assets/studio/demo-four-views.png','panel':vi,'label':'AI-generated illustrative photo; simulated overlays'},'report':{'kind':'photo','width':400,'height':700,'people':[person],'demo':True}})
  rid=f'{cid}-visit-{visit+1}'
  reports.append({'id':rid,'client_id':cid,'client_name':name,'kind':'posture','created_at':date.isoformat(),'demo':True,'provenance':'Synthetic demo · fictional client and measurements','views':views,'body':{'height_cm':clients[-1]['height_cm'],'weight_kg':round(clients[-1]['weight_kg']+(5-visit)*.25,1),'source':'Simulated device/manual record'},'summary':{'score':round(score,1),'score_label':'Illustrative alignment index','metrics':allmetrics,'coverage':4,'complete_views':4,'findings':[{'region':'Shoulders','level':'observe','text':f'Illustrative shoulder height difference: {sh:.1f}°. Review camera positioning and repeatability before making a plan.','source':'Synthetic example'},{'region':'Movement','level':'info','text':'Add a controlled arm raise and side-view squat to explore movement alongside the standing assessment.','source':'Coach workflow example'}],'recommendations':[{'id':'foundation','title':'Movement foundations','reason':'A balanced sequence covering comfortable mobility, controlled strength and supported balance. Coach review required.','exercise_ids':['bird-dog','bridge','balance'],'source':'https://www.nhs.uk/live-well/exercise/how-to-improve-strength-flexibility/'},{'id':'capture','title':'Repeat the same capture protocol','reason':'Use the same views, camera height, distance and relaxed stance for the next check-in.','exercise_ids':[],'source':'Capture protocol'}],'unavailable':['Muscle activation is not measured by photographs','Spinal curvature needs appropriate clinical assessment','Body composition requires a measuring device']},'mobility_demo':{'shoulder':round(132+visit*4+i%8,1),'hip':round(82+visit*3+i%9,1),'knee':round(111+visit*2+i%6,1),'ankle':round(18+visit+i%3,1),'source':'Synthetic movement values; not clinical norms'}})
  notes.append({'id':f'note-{cid}-{visit}','client_id':cid,'date':date.date().isoformat(),'title':['Initial consultation','Practice review','Movement check-in','Program update','Progress review','Next phase'][visit],'text':'Fictional coaching note for the investor demonstration. Reviewed comfort, consistency and movement confidence. Discussed a repeatable capture setup and a manageable practice schedule.','goal':clients[-1]['goal'],'followup':(date+timedelta(days=30)).date().isoformat(),'private':True,'demo':True})
 for w in range(1,25):
  for day in (0,3):
   d=TODAY-timedelta(days=w*7+day)+timedelta(hours=i%7)
   bookings.append({'id':f'book-{cid}-{w}-{day}','client_id':cid,'client_name':name,'date':d.isoformat(),'title':['Mat foundations','Mobility flow','Reformer essentials'][i%3],'coach':'Jamie Lee','duration':50,'status':'attended' if rng.random()<.86 else 'missed','demo':True})
 for day in range(5):
  d=TODAY+timedelta(days=day,hours=i%8)
  if i%3==day%3:bookings.append({'id':f'upcoming-{cid}-{day}','client_id':cid,'client_name':name,'date':d.isoformat(),'title':'Mat foundations','coach':'Jamie Lee','duration':50,'status':'reserved','demo':True})
 payments.append({'id':f'pay-{cid}','client_id':cid,'client_name':name,'date':(TODAY-timedelta(days=i%20)).date().isoformat(),'description':'8-session membership · demonstration only','amount':240,'currency':'USD','status':'paid' if i%6 else 'pending','demo':True})
programs=[{'id':'program-foundations','name':'Movement foundations','description':'A balanced, adaptable sequence for comfortable movement and a consistent studio practice.','difficulty':'Foundations','weeks':6,'client_id':'demo-client-01','steps':[{'exercise_id':e,'sets':2,'reps':8,'seconds':60} for e in ['breathing','bird-dog','bridge','wall-slide','balance','stretch']],'demo':True},{'id':'program-mobility','name':'Mobility & balance','description':'A gentle sequence to explore range, control and supported balance.','difficulty':'Gentle','weeks':4,'steps':[{'exercise_id':e,'sets':2,'reps':8,'seconds':60} for e in ['breathing','wall-slide','balance','stretch']],'demo':True}]
equipment=[{'id':f'equipment-{i}','name':name,'quantity':n,'status':'Ready','last_check':'2026-09-10','demo':True} for i,(name,n) in enumerate([('Reformer',8),('Pilates mat',20),('Magic circle',12),('Resistance band',18),('Foam roller',12),('Stability ball',10)])]
data={'schema':1,'demo':True,'studio':'Motion Yoga · Demo Studio','coach':'Jamie Lee','demo_date':TODAY.date().isoformat(),'notice':'All clients, financial entries and longitudinal measurements are synthetic examples. No client outcomes or clinical efficacy are claimed.','clients':clients,'reports':reports,'notes':notes,'programs':programs,'bookings':bookings,'payments':payments,'equipment':equipment}
path=ROOT/'web/assets/studio/demo.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,separators=(',',':')))
print(f'{len(clients)} fictional clients, {len(reports)} reports, {len(bookings)} attendance/reservation entries; {path.stat().st_size:,} bytes')
