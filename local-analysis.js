// Extractive local analysis: no model or network service is used here.
const stop = new Set('a an and are as at be been being but by can could did do does for from had has have how i if in into is it its just may me more most my of on or our should so than that the their them then there these they this those to up us was we were what when where which who why will with would you your yes no not also about after before over under only very really some any all one two use using make like get know think say said'.split(' '));
const words = text => (text.toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || []).filter(w => !stop.has(w));
const clean = text => text
  .replace(/```[\s\S]*?```/g,' ')
  .replace(/[^]*/g,' ').replace(/\b(?:filecite|turn\d+file\d+|turn\d+search\d+)\b[^\s]*/gi,' ')
  .replace(/<\/?[A-Za-z][^>]*>/g,' ').replace(/\{[^{}]*(?:=|\{|\})[^{}]*\}/g,' ')
  .replace(/\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\\\([\s\S]*?\\\)/g,' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
  .replace(/(?:^|\n)\s*(?:#{1,6}\s*|[-*•]\s+|\d+[.)]\s+)/g,'\n')
  .replace(/[#*_`>|]/g,' ').replace(/[ \t]+/g,' ').replace(/\n+/g,'\n').trim();
const boilerplate = /\b(?:output of this plugin was redacted|content (?:was|is) redacted|filecite|click here|let me know|hope this helps|as an ai language model)\b/i;
function candidates(text) {
  return clean(text).split(/\n+/).flatMap(line => line.match(/[^.!?]+(?:[.!?]+|$)/g) || []).map(s=>s.trim())
    .filter(s=>s.length>=18 && !boilerplate.test(s) && words(s).length>=3 && !/[\\{}<>]/.test(s) && !/\b(?:radius|padding|align|flex|fontsize|asyncimage|classname|height|width)\s*[=:]/i.test(s));
}
const sentences = candidates;
function title(sentence) {
  let text = sentence.replace(/^(?:so|well|okay|sure|exactly|yes|no|here(?:'s| is)|in other words|for example|for instance)[,:.!]?\s*/i,'').replace(/[.!?]+$/,'').trim();
  text = text.replace(/^(?:[-–—\s]+|\d+[.)]\s*)/,'');
  if (text.length > 85) text = text.slice(0,82).replace(/\s+\S*$/,'')+'…';
  return text || 'Conversation idea';
}
function similarity(a,b){const aa=new Set(words(a)),bb=new Set(words(b));if(!aa.size||!bb.size)return 0;let count=0;for(const w of aa)if(bb.has(w))count++;return count/Math.sqrt(aa.size*bb.size)}
function kind(text, role) {
  if (/\b(?:i (?:see|get it|understand)|that makes sense|now i understand|aha|the key (?:idea|point)|the important (?:thing|point)|breakthrough)\b/i.test(text)) return 'breakthrough';
  if (/\b(?:for example|for instance|such as|imagine|analogy)\b/i.test(text)) return 'example';
  if (/\b(?:actually|correction|rather|clarif(?:y|ication)|more precisely|instead)\b/i.test(text)) return 'clarification';
  if (/\b(?:in conclusion|in summary|to summarize|ultimately|finally)\b/i.test(text)) return 'conclusion';
  if (role === 'user' && /\?/.test(text)) return 'question';
  return 'concept';
}
function selectSentence(text, frequencies) {
  const options=sentences(text); if(!options.length)return '';
  let best=options[0], score=-Infinity;
  for(const [i,s] of options.entries()) {const tokens=[...new Set(words(s))];const value=tokens.reduce((n,w)=>n+(frequencies.get(w)||0),0)/Math.sqrt(Math.max(tokens.length,1))+(i===0?2:0)+(s.length>35&&s.length<200?2:0);if(value>score){best=s;score=value}}
  return best.length>260?best.slice(0,257).replace(/\s+\S*$/,'')+'…':best;
}
export function localAnalyze(messages) {
  const frequencies=new Map();for(const m of messages) for(const word of new Set(words(m.text))) frequencies.set(word,(frequencies.get(word)||0)+1);
  // Group adjacent turns around a question or a substantial change in topic.
  const sections=[]; let section=null;
  for(let i=0;i<messages.length;i++){
    const m=messages[i], text=sentences(m.text).join(' '); if(!text)continue;
    const newQuestion=m.role==='user'&&section&&section.refs.some(r=>messages[r].role==='assistant');
    const topicShift=section&&section.refs.length>=2&&similarity(section.text,text)<0.09&&m.role==='user';
    if(!section||newQuestion||topicShift||section.text.length>5000){section={text:'',refs:[]};sections.push(section)}
    section.text+=(section.text?' ':'')+text;section.refs.push(i);
  }
  const first=messages.find(m=>m.role==='user' && sentences(m.text).length) || messages.find(m=>sentences(m.text).length);
  if (!first) throw new Error('There is not enough readable conversation text to create a map.');
  const rootSummary=selectSentence(first.text,frequencies);
  const nodes=[{id:'root',title:title(rootSummary),description:rootSummary,type:'subject',refs:[messages.indexOf(first)]}];
  const edges=[];
  // Keep the entire conversation represented, but combine neighboring short
  // sections when a very long chat would otherwise overwhelm the map.
  const maxSections=45;
  const groupSize=Math.max(1,Math.ceil(sections.length/maxSections));
  for(let i=0;i<sections.length;i+=groupSize){
    const group=sections.slice(i,i+groupSize), refs=group.flatMap(s=>s.refs), text=group.map(s=>s.text).join(' ');
    const scored=refs.map(ref=>{const summary=selectSentence(messages[ref].text,frequencies);return {ref,summary,type:kind(summary,messages[ref].role)};}).filter(x=>x.summary);
    if(!scored.length)continue;
    // Prefer substantive explanations, while retaining explicit breakthroughs.
    scored.sort((a,b)=>Number(b.type==='breakthrough')-Number(a.type==='breakthrough') || Number(messages[b.ref].role==='assistant')-Number(messages[a.ref].role==='assistant'));
    const chosen=scored[0], id=`section-${i}`;
    nodes.push({id,title:title(chosen.summary),description:chosen.summary,type:chosen.type,refs:[chosen.ref,...refs.filter(ref=>ref!==chosen.ref)]});
    let parent=nodes[0], best=0;
    for(const prior of nodes.slice(1,-1)){const score=similarity(prior.description,text);if(score>best){best=score;parent=prior}}
    if(best<0.18) parent=nodes[0];
    // These labels describe grouping/navigation, not a causal claim.
    edges.push({source:parent.id,target:id,label:parent.id==='root'?'discusses':'related topic'});
    // Surface an explicit example or moment of understanding within a section
    // when it adds material beyond the section's main extract.
    for (const extra of scored.filter(x=>x.ref!==chosen.ref && ['breakthrough','example','clarification'].includes(x.type)).slice(0,2)) {
      if (nodes.length >= 80 || similarity(extra.summary,chosen.summary) > .7) continue;
      const extraId=`section-${i}-passage-${extra.ref}`;
      nodes.push({id:extraId,title:title(extra.summary),description:extra.summary,type:extra.type,refs:[extra.ref]});
      edges.push({source:id,target:extraId,label:extra.type==='example'?'example':'also discusses'});
    }
  }
  if(nodes.length<2)throw new Error('There is not enough readable conversation text to create a map.');
  return {title:title(rootSummary),nodes,edges};
}
