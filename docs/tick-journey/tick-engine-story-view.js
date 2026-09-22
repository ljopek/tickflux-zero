/* Explanatory HTML for the extended story. All diagram components and moving packets
 * are still native Flowdot; this module only presents domain observations. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),names=TickOverlapScenario.NAMES;
  const tiers=['Starter','Professional','Institutional'];
  const ms=n=>n==null?'—':Number(n.toFixed(1))+' ms';
  const bits=n=>(n??0).toString(2).padStart(8,'0');
  const price=n=>n==null?'no candidate':(n/100000).toFixed(5);
  const labelConfig=c=>`${c.windowMs?'5 s window':'arrivals'} · ${c.filter==='off'?'filter omitted':c.filter==='session'?'session filter':'price filter'}${c.aggregate?' · hi/lo':''}`;
  const book={arrivals:'ch05-the-last-value-cache.md',heartbeat:'ch09-time-is-just-another-event.md',silence:'ch08-blending-many-opinions-one-answer.md',late:'ch09-time-is-just-another-event.md',price_filter:'ch09-time-is-just-another-event.md',exclusion:'ch08-blending-many-opinions-one-answer.md',feed:'ch16-everything-is-just-another-event.md',session:'ch16-everything-is-just-another-event.md',overrun:'ch06-lanes-laps-and-losing-on-purpose.md',delivery:'ch11-leaving-the-building.md',aggregate:'ch15-extending-without-touching.md'};
  function describe(e,state) {
    if(!e||!e.act||e.act==='arrivals')return null;
    const id=e.traceId,r=e.result,c=state.config,ctl=e.control;
    const text={
      chapter:[e.title,`${e.question} ${e.summary}`,'EngineService.java'],
      configured:['Teaching checkpoint: wire the next chain.',`${labelConfig(c)}; carry-forward ${c.carry?'enabled':'disabled'}. This example rebuilds operator state, including its window grid and filter baseline, while retaining the illustrated cache, lane cursors and delivery histories. It does not claim that the engine implements live chain swapping.`,'stream/ChainCompiler.java'],
      pass_started:[`Pass ${e.pass}: the owner captures now.`,`Cached now = ${ms(e.passNow)}. This same value goes to every tick and the heartbeat in this pass, even though their visual actions land at different times. Ingress and client drains can continue independently.`,'EngineService.java'],
      lane_visited:[`Visit P${e.provider}; capture W = ${e.batchEnd}.`,`The shard drains only this visited batch before moving to the next provider. It visits all three lanes, including empty ones, before invoking its heartbeat. The real batch limit is 512 words.`,'EngineService.java'],
      pass_finished:[`Pass ${e.pass} is complete.`,`All provider lanes had their turn, then heartbeat ran with the same ${ms(e.passNow)} cached now. The owner can start another pass. Empty idle passes are condensed in this film.`,'EngineService.java'],
      heartbeat:[e.action==='anchor'?'The first heartbeat anchors the window.':e.action==='due'?e.missed?'A late heartbeat evaluates once.':'Time reaches the window boundary.':e.action==='no-op'?'An arrival-driven heartbeat does no work.':'Heartbeat: the window is not due.',
        e.action==='anchor'?`At cached now ${ms(e.passNow)}, set the first deadline to ${ms(e.next)}. No price is produced by this anchoring beat.`:
        e.action==='due'?`Cached now ${ms(e.passNow)} crossed deadline ${ms(e.due)}. Run the active instrument once.${e.missed?` Skip ${e.missed} missed window opportunities; do not invent their prices.`:''} The next boundary stays on the original grid: ${ms(e.next)}. Subscriber drains still have separate clocks.`:
        e.action==='no-op'?'The owner still calls onHeartbeat after its lane visits. This configured chain runs on arrivals, so the call returns without creating a tick.':`Cached now ${ms(e.passNow)} is before ${ms(e.next)}. A heartbeat is time as data, not a promise of an output.`, 'stream/CompiledChain.java'],
      window_started:[`${id} starts a window evaluation.`,`The heartbeat handed execution to the active instrument on this same shard. Capture its current provider legs using cached pass now ${ms(e.passNow)}. This is a time-triggered job, not a new provider tick.`,'stream/CompiledChain.java'],
      absorbed:[`${id} activates the window; no blend runs.`,`The price already lives in the LVC. Consuming this ID marks the instrument active, then returns ABSORBED.${e.sample?` The accumulator observes ${e.sample.id}'s mid ${Math.trunc((e.sample.bid+e.sample.ask)/2)} through this provider's LVC slot.`:' No extra collection of ticks is built.'} Emission belongs to a due heartbeat.`,'stream/CompiledChain.java'],
      control_emitted:[`${ctl?.value} enters as a 32-byte frame.`,`The control frame uses provider P${e.provider}'s stream. It carries absolute ${ctl?.kind==='feed'?'provider health':'session state'} for ${ctl?.kind==='feed'?'P'+ctl?.subject:'instrument '+ctl?.subject}. It does not overwrite a price cell.`,'ControlWord.java'],
      control_copied:['Pack control state into one signed word.',`Kind, value, reason and subject fit under the sign bit: ${ctl?.word}. Unlike a tick ID, this word contains the state to apply. Source sequence and source time are not packed into it.`,'ControlWord.java'],
      control_notified:[`${ctl?.value} waits in the same provider lane.`,`The negative control word occupies slot ${e.slot}. A later tick ID on this lane cannot pass it. Feed status is broadcast to all shards in the engine; this timeline expands the selected instrument's owner.`,'IngressLane.java'],
      control_dequeued:[`The shard recognises the negative word.`,`R advances past slot ${e.slot}. The owner will apply ${ctl?.value} on its own thread, in this provider's lane order. Applying control alone does not run an arrival-driven blend.`,'EngineService.java'],
      control_applied:[`${ctl?.kind==='feed'?'P'+ctl?.subject:'Session'} is now ${ctl?.value}.`,ctl?.kind==='feed'?`The owner updates provider status. ${ctl?.value==='DOWN'?'This leg is excluded from subsequent blends, and surviving weights renormalise.':'The leg becomes eligible again, subject to the age policy.'} Its retained LVC price is still stored.`:`${ctl?.value==='HALTED'?'Expected silence gates quality flags. The session-aware filter keeps its existing baseline.':'The lifecycle-aware operator resets its baseline on CONTINUOUS, so the next unchanged price can pass.'} Ordinary price filters do not automatically implement this session hook.`,'EngineService.java'],
      heartbeat_delayed:['The owning shard is paused across window boundaries.',`The next window is due at ${ms(state.window.next)}, but the owner is deliberately stalled. No separate timer thread may run its chain. When this shard resumes, its late heartbeat will evaluate once and advance the original grid.`,'stream/CompiledChain.java'],
      shard_held:['Let the writer get ahead.',`The selected shard is deliberately held. Ingress continues storing prices and publishing words into the eight-slot teaching ring. This is a controlled overload example, not a measured pause duration.`,'IngressLane.java'],
      shard_released:[state.act==='late'?'The owner resumes after missing window boundaries.':'Release the reader; check for a lap.',state.act==='late'?'The owner captures a new now on its next pass, visits its lanes, then handles the overdue heartbeat. No other thread emitted prices while it was paused.':`The writer continued while the reader waited. Before consuming a surviving word, the reader reconciles W − R against capacity 8 and counts the missing entries exactly.`,'IngressLane.java'],
      reconciled:[`Exactly ${e.count} wake-ups were overwritten.`,`P${e.provider}: skip ${e.lost?.map(w=>w.traceId).join(', ')} and advance R by ${e.count}. Eight surviving words stay available. No old payload is reconstructed; the LVC independently retains the latest price. This loss is separate from filtering and pending-slot replacement.`,'IngressLane.java'],
      transport_blocked:[`${tiers[e.tier]} will reject one offer.`,`The next offer on this publication fails. The fixture will show a counted transport drop, no receipt for that version, and continued progress for the other subscribers.`,'fanout/AeronClientPublication.java'],
      offer_failed:[`${tiers[e.tier]} did not accept v${r?.version}.`,`Count one failed offer. The drained value is not returned to the pending slot and no retry backlog is created. There will be no receipt for this version at this client; later versions can still succeed.`,'fanout/AeronClientPublication.java'],
      suppressed:['No eligible leg. No candidate.',`All three provider legs failed the blend's inclusion rule. Carry-forward is disabled and all are past the 2,000 ms blend-age bound. The join stops the chain before the price filter or subscriber writes.`,'blend/WeightedAverageBlendStrategy.java'],
      story_finished:['One history, several different reasons for missing prices.',`${state.arrivals} arrivals; ${state.absorbed} absorbed notifications; ${state.blends} candidates; ${state.filtered} filtered; ${state.suppressed} join suppressed; ${state.lost} lapped words; ${state.offerFailures} failed offer. Client receipt counters retain the differences. The last empty high/low window wrote zeros while carrying the same price.`,'EngineService.java']
    };
    if(e.kind==='read') {
      const legs=e.legs.map(l=>l.id).join(' + '),eligible=r.included.map((yes,p)=>yes?'P'+p:null).filter(Boolean).join(', ')||'none';
      return {title:id.startsWith('H')?`${id} reads because time passed.`:`${id} reads under the current policy.`,text:`Captured ${legs} at pass now ${ms(r.passNow)}. Eligible legs: ${eligible}; included weight ${r.weightSum}. ${r.bid===null?'The join cannot create a result.':`Bid ${r.bid}; quality ${bits(r.quality)}. The quality mask describes freshness separately from inclusion.`}`,file:'blend/WeightedAverageBlendStrategy.java'};
    }
    if(e.kind==='blended')return {title:r.derived?r.derived.count?'The window remembers the spike and dip.':'An empty window writes zero aggregates.':`A candidate occupies Edge slot ${e.slot}.`,text:r.derived?`Bid ${r.bid} comes from the current LVC. Derived slot 48 holds high mid ${r.derived.high}; slot 56 holds low mid ${r.derived.low}, from ${r.derived.count} observed legs. Reset this instrument's accumulator for the next window. ${r.derived.count?'Last-value state alone cannot recover these extremes.':'No prints differs from a flat market.'}`:`Captured inputs produce bid ${r.bid} and ask ${r.ask}. Quality byte ${bits(r.quality)} is restamped; the mid transform writes ${Math.trunc((r.bid+r.ask)/2)} into derived slot 48.`,file:'stream/ChainCompiler.java'};
    if(e.kind==='passed')return {title:`${id} produces v${r.version}.`,text:e.filter==='off'?`This configured chain omits the price filter. Publish bid ${r.bid} with quality ${bits(r.quality)}, even when the price equals the previous window.`:e.baseline.bid===null?`The new ${e.filter==='session'?'session-aware':'price'} filter has no baseline. This first candidate passes and establishes bid ${r.bid}.`:`The candidate moved ${e.bidMove} / ${e.askMove} units and passes the configured filter. Its quality is ${bits(r.quality)}.`,file:'filter/InsignificantChangeFilter.java'};
    if(e.kind==='filtered')return {title:e.bidMove===0?'The price did not change; the filter stops it.':`A ${e.bidMove}-unit move is filtered.`,text:`${id} evaluated a candidate at ${r.bid} / ${r.ask}, quality ${bits(r.quality)}. This filter compares prices; a quality-only change does not force a pass. Keep baseline ${e.baseline.bid} / ${e.baseline.ask} and its last-passed quality ${bits(e.baseline.quality)}. No subscriber slot is written.`,file:'filter/InsignificantChangeFilter.java'};
    if(e.kind==='stored'&&e.overwrittenUnread)return {title:`${id} replaces an unread provider price.`,text:`${e.previous.id} → ${id}: ${e.previous.bid} → ${e.bid}. No shard read captured that old provider version. A window may only have absorbed its notification; absorbing does not retain its payload.`,file:'lvc/OffHeapLastValueCache.java'};
    if(e.kind==='notified'&&e.overwritten)return {title:`${id} overwrites an unread ring word.`,text:`Physical slot ${e.slot} now contains instrument ID ${e.word}. ${e.overwritten.traceId}'s notification has gone. W advances while R stays behind; the reader counts the loss when it reconciles.`,file:'IngressLane.java'};
    const entry=text[e.kind];return entry?{title:entry[0],text:entry[1],file:entry[2]}:null;
  }
  function eventDetails(event,run) {
    if(!event)return '';
    // Describe the selected commit's own before/after snapshots, even when following
    // an older tick while the shared clock and live cache continue to advance.
    const index=run.events.indexOf(event),before=index>0?run.events[index-1].state:run.initial,after=event.state;
    const p=event.provider,t=event.tier,kind=event.kind;
    const fields=[],add=(label,value)=>fields.push([label,value]);
    const change=(label,a,b,format=String)=>{if(a!==b)add(label,`${format(a)} → ${format(b)}`);};
    const version=value=>value?'v'+value.version:'clean';
    const versions=values=>values.map(v=>'v'+v.version).join(', ')||'none';
    let actor=`Owning shard ${run.instrument%3}`;
    if(['emitted','encoded','control_emitted'].includes(kind))actor=names[p]+' adapter';
    if(['copied','stored','notified','control_copied','control_notified'].includes(kind))actor=`Ingress ${p} / ${names[p]}`;
    if(['drained','offered','offer_failed'].includes(kind))actor=tiers[t]+' delivery worker';
    if(kind==='received')actor=tiers[t]+' client';
    if(kind==='published')actor+=` → ${tiers[t]} subscription`;
    const subject=event.control?.kind==='feed'?`${names[event.control.subject]} / provider P${event.control.subject}`:`${TickOverlapScenario.PAIRS[run.instrument]} / instrument ${run.instrument}`;
    add('Event',`${event.traceId||'owner'} · ${kind.replaceAll('_',' ')} · ${index+1} of ${run.events.length}`);
    add('Who / subject',`${actor} · ${subject}`);
    if(kind==='stored')add('Cache cell',`${event.previous.id}: ${price(event.previous.bid)} → ${event.traceId}: ${price(event.bid)}`);
    if(Number.isInteger(p)&&p>=0&&p<3){
      const a=before.rings[p],b=after.rings[p];
      if(a.read!==b.read||a.write!==b.write)add(`P${p} lane`,`R ${a.read} → ${b.read}; W ${a.write} → ${b.write}; retained words ${a.queue.length} → ${b.queue.length}`);
    }
    if(event.control)add('Control word',`${event.control.word} · ${event.control.value}`);
    if(event.word!==undefined&&!event.control)add('Lane word',`Instrument ID ${event.word}${event.slot!==undefined?' · physical slot '+event.slot:''}`);
    if(kind==='read')add('Captured prices',event.legs.map((leg,p)=>`${names[p]} ${leg.id}: ${price(leg.bid)}`).join(' · '));
    if(event.result&&['blended','passed','filtered','published','drained','offered','received','offer_failed','suppressed'].includes(kind)){
      const r=event.result;
      add('Candidate',`${r.version?'v'+r.version+' · ':''}${r.bid==null?'no eligible price':`bid ${price(r.bid)} / ask ${price(r.ask)}`}${r.quality!=null?' · quality '+bits(r.quality):''}`);
    }
    if(event.lost)add('Overwritten IDs',event.lost.map(word=>word.traceId).join(', '));
    change('Filter baseline',before.baseline.bid,after.baseline.bid,value=>value==null?'unset':price(value));
    if(before.window&&after.window)change('Next window',before.window.next,after.window.next,ms);
    if(event.passNow!=null)add('Pass clock',`${ms(event.passNow)} cached for this owner pass`);
    if(before.health&&after.health)for(let provider=0;provider<3;provider++)change(names[provider]+' health',before.health[provider],after.health[provider]);
    change('Session',before.session,after.session);
    if(Number.isInteger(t)){
      const a=before.subscriptions[t],b=after.subscriptions[t];
      change('Pending value',version(a.pending),version(b.pending));
      change('Replacements',a.replaced,b.replaced);
      change('To offer',versions(a.draining),versions(b.draining));
      change('In transport',versions(a.transit),versions(b.transit));
      change('Client receipts',a.received.length,b.received.length);
      change('Failed offers',a.failed?.length??0,b.failed?.length??0);
    }
    const oldTrace=before.traces[event.traceId],newTrace=after.traces[event.traceId];
    if(newTrace)change('Journey status',oldTrace?.status||'scheduled',newTrace.status);
    return fields.map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
  }
  function mechanism(chosen,state,run) {
    const legs=chosen?.legs,r=chosen?.result;
    const included=r?.included||[true,true,true],weightSum=r?.weightSum??100;
    let html=`<table><caption>Live LVC vs ${legs?'captured read for '+chosen.id:'a shard read (none yet)'}</caption><thead><tr><th>Provider</th><th>Live bid</th><th>Captured leg</th><th>Weight / quality</th></tr></thead><tbody>${state.lvc.map((live,p)=>`<tr><td>${names[p]}<small>${state.health[p]}</small></td><td><strong>${live.id}</strong> · ${live.bid}<small>stored ${ms(live.at)}</small></td><td class="${legs&&legs[p].id!==live.id?'changed':''}">${legs?`<strong>${legs[p].id}</strong> · ${legs[p].bid}<small>${r?.ages?ms(r.ages[p])+' old at pass now':legs[p].id===live.id?'same stored version':'captured earlier'}</small>`:'—'}</td><td>${legs?`${included[p]?(100*TickOverlapScenario.WEIGHTS[p]/weightSum).toFixed(1)+'%':'excluded'}<small>${r?.bid===null?'no output byte':(r?.quality??0)&(1<<p)?'quality bit set':'quality bit clear'}</small>`:'—'}</td></tr>`).join('')}</tbody></table>`;
    if(r){
      const terms=legs.map((leg,p)=>included[p]?`${leg.bid}×${TickOverlapScenario.WEIGHTS[p]}`:null).filter(Boolean);
      html+=`<p><code>${weightSum?'trunc(('+terms.join(' + ')+') / '+weightSum+') = '+r.bid:'No included weight → no candidate'}</code></p>`;
      const derived=r.derived;
      if(r.bid!==null)html+=`<div class="record-strip"><span>64-byte result</span><span>bid / ask<br><b>${r.bid??'—'} / ${r.ask??'—'}</b></span><span>35 · quality<br><b>${bits(r.quality)}</b></span><span>48 · ${derived?'high mid':'mid'}<br><b>${r.derivedReady===false?'awaiting derive':derived?derived.high:Math.trunc((r.bid+r.ask)/2)}</b></span><span>56 · ${derived?'low mid':'unused'}<br><b>${r.derivedReady===false?'awaiting derive':derived?derived.low:'—'}</b></span></div>`;
    }
    html+=`<p>Current filter: <strong>${state.config.filter==='off'?'omitted':state.config.filter==='session'?'session-aware baseline':run.threshold+'-unit price movement'}</strong>. Last passing baseline: <strong>${state.baseline.bid??'unset'}</strong>.</p>`;
    if(chosen?.decision)html+=`<p>${chosen.id}: <strong class="${chosen.decision.passed?'pass':'filtered'}">${chosen.decision.passed?'PASS → v'+r.version:'FILTERED'}</strong>${chosen.decision.bidMove===null?' · first result establishes a baseline':' · Δ bid '+chosen.decision.bidMove}.</p>`;
    return html;
  }
  function updateClock(frame,run) {
    $('clock-note').textContent=frame.compression?`${frame.state.hold?'Owner paused; interval compressed':'Quiet interval compressed'} · ${((frame.compression.rawEnd-frame.compression.rawStart)*run.logicalMsPerSecond/1000).toFixed(2)} market seconds in ${frame.compression.duration} teaching seconds. No packets or state changes are skipped.`:'Teaching motion is slowed. The market clock and cached pass now are shown separately.';
  }
  function render(frame,run) {
    const state=frame.state,w=state.window,loop=state.loop,c=state.config;

    const steps=['capture now','visit P0','visit P1','visit P2','heartbeat'];
    $('loop-story').innerHTML=`<h3>The owning shard / S${run.instrument%3}</h3><div class="loop-steps">${steps.map((s,i)=>`<span tabindex="0" title="${loopHelp[i]}" class="${loop.phase===s?'current':''}">${s}</span>`).join('')}</div><p>Pass ${loop.number||'—'} · cached now <strong>${ms(loop.now)}</strong> · ${state.hold?'reader held':loop.phase}</p><p>Window: ${c.windowMs?`every 5,000 ms · ${w.active?'instrument active':'not activated'}<br>Next boundary <strong>${ms(w.next)}</strong> · ${w.evaluations} evaluations · ${w.missed} skipped`:'arrival-driven; heartbeat is a no-op'}</p>`;
    $('policy-story').innerHTML=`<h3>The chain in this chapter</h3><p><strong>${labelConfig(c)}</strong></p><p>Carry-forward ${c.carry?'on':'off'} · blend age bound 2,000 ms<br>Quality age bound 500 ms · session <strong>${state.session}</strong></p><p>Provider health: ${state.health.map((s,p)=>`<span class="${s==='DOWN'?'filtered':''}">P${p} ${s}</span>`).join(' · ')}</p>${c.aggregate?`<p>Window observations: ${state.aggregate.count}<br>High ${state.aggregate.high??'—'} · low ${state.aggregate.low??'—'}</p>`:'<p>Checkpoints rebuild operator state; retained prices and delivery histories continue.</p>'}`;
    const replaced=state.subscriptions.reduce((sum,s)=>sum+s.replaced,0);
    $('loss-story').innerHTML=`<h3>Different reasons a price does not arrive</h3><dl class="outcome-counts"><div><dt>Absorbed by window</dt><dd>${state.absorbed}</dd></div><div><dt>Price / session filtered</dt><dd>${state.filtered}</dd></div><div><dt>No eligible blend legs</dt><dd>${state.suppressed}</dd></div><div><dt>Lapped lane words</dt><dd>${state.lost}</dd></div><div><dt>Pending replacements</dt><dd>${replaced}</dd></div><div><dt>Failed offers</dt><dd>${state.offerFailures}</dd></div></dl>`;
  }
  const loopHelp=[
    'now — Capture the current time once at the start of this owning shard’s pass. Every tick and the heartbeat in this pass use that same cached time.',
    ...names.map((name,p)=>`P${p} — Visit the ${name} notification lane. Snapshot its write cursor, then consume that batch in order (up to 512 words). Later writes wait for the next visit.`),
    'HB — Heartbeat. After all provider visits, call onHeartbeat with the same cached now. A due window evaluates once; an early beat or arrival-driven chain produces no output. This is a call on the owner thread, not a separate timer.'
  ];
  function componentHelp(node,x,y) {
    let help=typeof node.inspect==='function'?node.inspect(0):node.inspect||'';
    if(node instanceof Flowdot.Pipeline) {
      const stage=node.stages.findIndex((_,i)=>{const [sx,sy]=node.port('stage:'+i);return Math.abs(x-sx)<=Math.max(20,node.nodeR)&&Math.abs(y-sy)<=Math.max(20,node.nodeR);});
      if(stage>=0){
        if(node.id.startsWith('loop'))help=loopHelp[stage];
        else if(node.id.startsWith('work'))help=[
          'Join — Read the latest eligible provider prices from the last-value cache and blend them with relative weights. A queued ID does not retain the old price.',
          'Derive — Transform the blended result in the shard’s reusable record. The story writes a mid price, or window high/low values, into derived slots.',
          'Filter — Compare the candidate with the last passing baseline. Small moves can stop here; chapters may omit this filter or use a session-aware baseline.',
          'Fanout — Write this result to interested subscriptions. Replacing a still-pending result conflates it; each subscriber drains on its own cadence.'
        ][stage];
        else if(node.id.startsWith('adapter'))help=[
          'Tick — A provider price arrives for a currency pair. Each provider progresses independently.',
          'Wire — Encode a price into a reusable 64-byte record before sending it across Aeron to ingress. Control events use 32-byte frames.'
        ][stage];
      }
    }
    return help;
  }
  function chapterLink(chapter) {
    const original={
      'Feeds overlap':'ch07-where-ticks-come-from.md',
      'Overwrite before read':book.arrivals,
      'Old ID, latest prices':book.arrivals,
      'Filter a repeated blend':'ch09-time-is-just-another-event.md',
      'Replace a pending value':book.delivery,
      'Delivery histories':book.delivery
    };
    return '../'+(book[chapter.id]||original[chapter.label]||book.arrivals);
  }

  window.TickStoryPresentation={describe,eventDetails,mechanism,render,updateClock,bits,labelConfig,price,componentHelp,chapterLink};
})();
