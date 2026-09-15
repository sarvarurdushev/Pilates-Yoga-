import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rotatePoint} from '../src/poseCanvas.js';
test('a side rotation reveals model depth and preserves vertical direction',()=>{
 const [x,y,z]=rotatePoint([2,3,7],Math.PI/2);assert.ok(Math.abs(x-7)<1e-10);assert.equal(y,3);assert.ok(Math.abs(z+2)<1e-10);
});
test('view rotation preserves Euclidean joint distances at arbitrary angles',()=>{
 const a=[.1,-.4,.5],b=[-.7,.3,-.2],distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
 for(const yaw of [0,.1,1.5,Math.PI,4.8]) for(const pitch of [-.6,0,.4])assert.ok(Math.abs(distance(a,b)-distance(rotatePoint(a,yaw,pitch),rotatePoint(b,yaw,pitch)))<1e-10);
});
