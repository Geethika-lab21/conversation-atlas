import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localAnalyze } from '../local-analysis.js';

test('groups related turns, highlights source messages, and finds examples', () => {
  const messages=[{role:'user',text:'How do habits form when people repeat an action?'},{role:'assistant',text:'A cue triggers a behavior and a reward encourages repetition. For example, reading a page before bed can become a routine.'},{role:'user',text:'What about motivation on difficult days?'},{role:'assistant',text:'The key point is to make the action small enough to repeat even on difficult days.'}];
  const map=localAnalyze(messages);
  assert.ok(map.nodes.length >= 3);
  for(const node of map.nodes) {assert.ok(node.refs.length);assert.ok(node.refs.every(i=>i>=0&&i<messages.length));assert.ok(node.description.length>0)}
  assert.ok(map.nodes.some(n=>n.type==='breakthrough'));
  assert.ok(map.edges.every(e=>map.nodes.some(n=>n.id===e.source)&&map.nodes.some(n=>n.id===e.target)));
});

test('represents a long conversation without dropping source turns', () => {
  const messages=Array.from({length:120},(_,i)=>({role:i%2?'assistant':'user',text:`${i%2?'The explanation discusses':'What is important about'} subject number ${i} and how can it be understood?`}));
  const map=localAnalyze(messages);
  const refs=new Set(map.nodes.flatMap(n=>n.refs));
  assert.equal(refs.size,messages.length);
});

test('does not promote redactions, citation tokens, JSX or equations into node labels', () => {
  const messages=[
    {role:'assistant',text:'The output of this plugin was redacted'},
    {role:'user',text:'Explain representation learning and feature engineering in neural networks.'},
    {role:'assistant',text:'fileciteturn1file0\n<box border radius="xl" padding={3}><title size="xl">\n\\[ \\quad \\| w \\| \\leq c \\]\nRepresentation learning helps a neural network learn useful features from data.'}
  ];
  const map=localAnalyze(messages);
  assert.match(map.nodes[0].title,/representation/i);
  for(const node of map.nodes) assert.doesNotMatch(node.title,/redacted|filecite|radius|padding|\\quad|<box/i);
  assert.ok(map.nodes.some(node=>node.refs.includes(2)));
});
