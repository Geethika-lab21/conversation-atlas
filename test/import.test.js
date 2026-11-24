import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../server.js';

// A small positional-encoded stream shaped like a shared page. Split the
// payload between enqueue calls to exercise the streamed HTML format.
test('extracts both sides of a streamed shared conversation', () => {
  const flat = [{_1:2},'linear_conversation',[3,4],{_5:6},{_5:7},'message',{_8:9,_10:11,_12:13},{_8:16,_10:14,_12:15},'id','first','author',{_17:18},'content',{_19:20},{_17:21},{_19:22},'second','role','user','parts',[23],'assistant',[24],'Question text','Answer text'];
  const payload = JSON.stringify(flat)+'\n';
  const at = Math.floor(payload.length/2);
  const html = `<script>streamController.enqueue(${JSON.stringify(payload.slice(0,at))});streamController.enqueue(${JSON.stringify(payload.slice(at))});</script>`;
  assert.deepEqual(extract(html).map(({role,text})=>({role,text})),[{role:'user',text:'Question text'},{role:'assistant',text:'Answer text'}]);
  assert.deepEqual(extract(payload,true).map(({role,text})=>({role,text})),[{role:'user',text:'Question text'},{role:'assistant',text:'Answer text'}]);
});
test('continues to extract older embedded JSON', () => {
  const data = {messages:[{id:'a',author:{role:'user'},content:{parts:['Hello']}},{id:'b',author:{role:'assistant'},content:{parts:['Hi']}}]};
  assert.equal(extract(`<script>${JSON.stringify(data)}</script>`).length,2);
});
