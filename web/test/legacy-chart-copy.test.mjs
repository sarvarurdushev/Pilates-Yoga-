import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreLines } from '../src/session/charts.js';
import { historicalQuantityCopy } from '../src/session/lab.js';

test('historical subjective scores with absent endpoints do not imply improvement', () => {
  const html = scoreLines({scale:10,lines:{comfort:{label:'Comfort',latest:6,moved:1,points:[
    {date:'2026-01-01',score:5},{date:'2026-02-01',score:6},
  ]}}});
  assert.match(html,/Coach-defined subjective scale \/10; endpoints not recorded/);
  assert.match(html,/change alone does not identify improvement/);
  assert.doesNotMatch(html,/class="ss-up"/);
});

test('historical quality formulas distinguish ratio, angle spread and missing units', () => {
  assert.match(historicalQuantityCopy('control').definition,/divided by twice the detected repetition count/);
  assert.match(historicalQuantityCopy('tempo ratio').definition,/return duration divided by outward duration/);
  assert.match(historicalQuantityCopy('range consistency',{unit:'deg'}).definition,/Standard deviation/);
  const old = historicalQuantityCopy('range consistency',{}, {source:'Synthetic legacy scenario'});
  assert.equal(old.technical,true);
  assert.match(old.definition,/unit and calculation are not defined/);
  assert.equal(old.source,'Synthetic legacy scenario');
  assert.match(historicalQuantityCopy('knee symmetry',{unit:'deg'}).definition,/camera-plane gap/);
});
