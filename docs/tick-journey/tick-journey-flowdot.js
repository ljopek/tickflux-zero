/* One host clock; native Flowdot routes, packets and state reactions. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const Model = TickOverlapScenario;
  const {NAMES:names, PAIRS:pairs, BASES:bases, INTERESTS:interests} = Model;
  const tiers = ['Starter', 'Professional', 'Institutional'];
  const colours = ['#emerald', '#sky', '#violet'];
  const source = $('flow-source').textContent.trim();
  const fixed = n => (n / 100000).toFixed(5);
  const ms = n => Number(n.toFixed(1)) + ' ms';
  const service = '../../tickflux-poc/tickflux-engine-service/src/main/java/com/tickflux/engine/service/';
  const core = '../../tickflux-poc/tickflux-core/src/main/java/com/tickflux/core/';
  const EPS = 1e-9;
  let view, run, scene, agenda = [], cursor = 0, time = 0, playing = false, raf = null, last = null;
  let instrument = 0, provider = 1, threshold = 5, mode = 'engine', speed = 1, focus = '', detailKey = '';
  let templates = new Map(), handles = new Map(), plans = new Map(), trackRows = [], nativeMetadata = {};
  let trackAct = null, trackStart = 0, trackEnd = 1;

  function emit(name, payload = {}) { view.rt.emit(name, {...payload}); }
  function routeName(a) {
    if (['visit','absorb','control_apply'].includes(a.kind)) return `begin_${a.kind}_${instrument%3}_${a.provider}`;
    if (a.kind==='heartbeat') return `begin_heartbeat_${instrument%3}`;
    if (a.kind==='window_read') return `begin_window_read_${instrument}`;
    if (['control_copy','control_notify'].includes(a.kind)) return `begin_${a.kind}_${instrument}_${a.provider}`;
    if (['encode','copy','store','notify','read'].includes(a.kind)) return `begin_${a.kind}_${instrument}_${a.provider}`;
    if (['blend','filter'].includes(a.kind)) return `begin_${a.kind}_${instrument}`;
    if (['publish','offer'].includes(a.kind)) return `begin_${a.kind}_${instrument}_${a.tier}`;
    return `begin_receive_${a.tier}`;
  }
  function colour(kind, p) {
    if (kind.startsWith('control') || ['visit','heartbeat','window_read','absorb'].includes(kind)) return '#violet';
    return ['encode','copy','store'].includes(kind) ? colours[p] : ['notify','read'].includes(kind) ? '#white' : '#amber';
  }
  function parseScene() {
    scene = Flow.parse(source, {safe:true});
    templates = new Map();
    for (const event of scene.events) {
      const actions = event.actions.filter(a => a.verb === 'spawn');
      if (!actions.length) continue;
      // The distribution's on-parser strips # colours. The public IR still supports them.
      const kind = event.name.split('_')[1];
      for (const action of actions) action.color = colour(kind, Number(event.name.split('_').at(-1)));
      if (actions.length !== 1) throw new Error(`Expected one native route in ${event.name}`);
      templates.set(event.name, actions[0]);
    }
  }
  function nativeDurations() {
    return Object.fromEntries(Object.keys(mode==='engine'?TickEngineStory.DURATIONS:Model.DURATIONS).map(kind => {
      const template = templates.get(routeName({kind,provider:0,tier:0}));
      if (!template) throw new Error(`Missing native route for ${kind}`);
      return [kind,template.route.slice(1).reduce((sum,hop) => sum+hop.dur,0)];
    }));
  }

  function buildAgenda() {
    agenda = run.events.map(event => ({time:event.time,kind:'commit',event}));
    plans = new Map();
    for (const activity of run.activities) {
      const template = templates.get(routeName(activity));
      const total = template.route.slice(1).reduce((sum,hop) => sum+hop.dur,0);
      const scale = (activity.end-activity.start)/total;
      let offset = activity.start;
      const legs = template.route.slice(1).map((hop,n) => {
        const from = template.route[n];
        const duration = hop.dur*scale;
        offset += duration;
        agenda.push({time:n===template.route.length-2?activity.end:offset,kind:'hop'});
        return {from:[from.node,from.port || 'out'],to:[hop.node,hop.port || 'in'],dur:duration};
      });
      plans.set(activity.id,legs);
      agenda.push({time:activity.start,kind:'start',activity});
    }
    const priority = {hop:0,commit:1,start:2};
    agenda.sort((a,b) => a.time-b.time || priority[a.kind]-priority[b.kind]);
  }
  function spawn(activity) {
    const legs = plans.get(activity.id).map(leg => {
      const from = view.byId[leg.from[0]], to = view.byId[leg.to[0]];
      if (!from || !to) throw new Error(`Unknown native route endpoint for ${activity.kind}`);
      return {from:[from,leg.from[1]],to:[to,leg.to[1]],dur:leg.dur,onArrive:() => to.pulse?.(view.diagram.now)};
    });
    const packet = view.diagram.flow.spawn(legs, {
      style:{color:Flowdot.resolveColor(colour(activity.kind,activity.provider),view.diagram.theme),r:5.2},
      data:{activityId:activity.id,traceId:activity.traceId,kind:activity.kind}
    });
    // Retain the handle returned by the public spawn API. No private packet/timer arrays
    // are read or changed. Native pos() supplies the label anchor; Flowdot owns interpolation.
    handles.set(activity.id,{packet,activity});
  }
  function commit(e) {
    const i = instrument, p = e.provider, t = e.tier;
    if (e.kind === 'emitted') emit('emitted');
    else if (e.kind === 'stored') emit(`stored_${i}_${p}`,{bid:e.bid});
    else if (e.kind === 'notified') emit(`notified_${i}_${p}`);
    else if (e.kind === 'dequeued') emit(`dequeued_${i}_${p}`);
    else if (e.kind === 'read') emit(`read_${i}`);
    else if (e.kind === 'blended') emit(`blended_${i%3}_${e.slot}`,{instrument:i});
    else if (e.kind === 'passed' || e.kind === 'filtered') emit(e.kind);
    else if (e.kind === 'published') emit(`published_${i}_${t}`,{version:e.result.version});
    else if (e.kind === 'drained') emit(`drained_${i}_${t}`);
    else if (e.kind === 'offered') emit(`offered_${t}`,{version:e.result.version});
    else if (e.kind === 'received') emit(`received_${t}`,{price:fixed(e.result.bid)});
    else if (e.kind === 'control_notified') emit(`notified_${i}_${p}`);
    else if (e.kind === 'control_dequeued') emit(`dequeued_${i}_${p}`);
    else if (e.kind === 'reconciled') for(let n=0;n<e.count;n++) emit(`reconcile_${i}_${p}`);
    else if (e.kind === 'heartbeat') emit('heartbeat');
    else if (e.kind === 'absorbed') emit('absorbed');
    else if (e.kind === 'offer_failed') emit(`offer_failed_${t}`,{version:e.result.version});
    syncMetadata(e.state);
  }
  function syncMetadata(state) {
    const changed=(key,value,handler=key)=>{if(nativeMetadata[key]!==value){nativeMetadata[key]=value;emit(handler,{value});}};
    changed('pass_clock',state.loop?.now==null?'—':Number(state.loop.now.toFixed(1))+'');
    changed('window_clock',state.window?.next==null?'—':Number(state.window.next.toFixed(1))+'');
    changed('session_state',state.session||'CONTINUOUS');
    const config=state.config;
    changed('mode_state',config?`${config.windowMs?'5s window':'arrivals'} / ${config.filter==='off'?'no filter':config.filter+' filter'}${config.aggregate?' / hi-lo':''}`:'arrivals / price filter');
    const result=state.edge[(state.blends+7)%8];
    changed('quality_state',result?TickStoryPresentation.bits(result.quality):'—');
    changed('derived_state',result?result.derived?`48 high ${result.derived.high} / 56 low ${result.derived.low}`:`48 mid ${Math.trunc((result.bid+result.ask)/2)} / 56 unused`:'—');
    for(let p=0;p<3;p++){
      const status=state.health?.[p]||'UP';
      if(nativeMetadata['health'+p]!==status){nativeMetadata['health'+p]=status;emit(`health_${status==='DOWN'?'down':'up'}_${p}`,{status});}
    }
  }
  function mount() {
    view?.dispose();
    view = Flowdot.mount($('diagram'),scene,{safe:true,autoStart:false,seed:42});
    view.diagram.inspector($('inspector'),'Hover a native component. Tick tags are teaching provenance. Rings carry instrument IDs or signed control words; heartbeat stays on the owner.');
    view.diagram.overlay(annotate);
    time=0;cursor=0;handles=new Map();detailKey='';nativeMetadata={};
    for (let i=0;i<6;i++) for (let p=0;p<3;p++) emit(`seed_cell_${i}_${p}`,{bid:bases[i]+[0,10,-10][p]});
    for (let s=0;s<3;s++) for (let p=0;p<3;p++) for (let n=0;n<run.initialCursor;n++) emit(`seed_ring_${s}_${p}`);
    syncMetadata(run.initial);
  }
  function updateNative(next, atBoundary) {
    const dt = Math.max(0,next-time);
    view.diagram.now=next;view.rt.update(dt,next);
    if (dt>0) view.diagram.flow.update(dt+(atBoundary?1e-10:0));
    for (const component of view.diagram.components) component.update?.(dt,next);
    for (const [id,{packet}] of handles) if (packet.done) handles.delete(id);
    time=next;
  }
  function advanceTo(target) {
    target=Math.max(0,Math.min(run.duration,target));
    if (target<time) throw new Error('Use seek for backward replay');
    while (cursor<agenda.length && agenda[cursor].time<=target+EPS) {
      const at=agenda[cursor].time;
      updateNative(at,true);
      const group=[];
      while(cursor<agenda.length && Math.abs(agenda[cursor].time-at)<EPS) group.push(agenda[cursor++]);
      // Native arrivals finish first, then a state commit, then any new travelling packets.
      for (const action of group) if (action.kind==='commit') commit(action.event);
      for (const action of group) if (action.kind==='start') spawn(action.activity);
    }
    if (target>time) updateNative(target,false);
  }
  function pause() {
    playing=false;last=null;
    if (raf!==null) cancelAnimationFrame(raf);
    raf=null;
  }
  function seek(target) {
    target=Number(target);
    if (!Number.isFinite(target)) throw new TypeError('Seek time must be finite');
    pause();mount();advanceTo(target);render();
  }
  function play() {
    if (playing) {pause();render();return;}
    if (time>=run.duration) seek(0);
    playing=true;last=null;render();raf=requestAnimationFrame(safely(tick));
  }
  function tick(now) {
    if (!playing) return;
    if (last!==null) advanceTo(time+Math.min(.1,(now-last)/1000)*speed);
    last=now;
    if (time>=run.duration) pause();
    render();if (playing) raf=requestAnimationFrame(safely(tick));
  }
  function configure() {
    pause();mode=$('mode').value;instrument=Number($('pair').value);provider=Number($('provider').value);threshold=Number($('threshold').value);
    parseScene();
    const single = mode==='single';
    const emissions = single ? [{time:.4,provider,sequence:(provider+1)*100+1,delta:[40,60,80][provider]}] : Model.EMISSIONS;
    run=mode==='engine'?TickEngineStory.compile({instrument,threshold,durations:nativeDurations()}):Model.compile({instrument,threshold,emissions,durations:nativeDurations(),shardReady:single?0:6.4,firstDrains:single?[12,3.17,.84]:[48,3.17,.84]});
    buildAgenda();focus='';$('focus').replaceChildren(new Option('Latest change',''),...run.ticks.slice().sort((a,b)=>a.time-b.time).map(tick => new Option(`${tick.id} / ${tick.type==='window'?'heartbeat':names[tick.provider]}`,tick.id)));
    $('provider-control').hidden=!single;$('scrub').max=String(run.duration);
    $('heading').textContent=run.extended?'TickFlux. Zero engine.':single?'One tick. The same shared memory.':'Many ticks. One shared memory.';
    $('story-panels').hidden=!run.extended;$('clock-note').hidden=!run.extended;
    $('intro').textContent=run.extended?'One continuous history: overlapping prices, quiet windows, control messages, overload and delivery. Every state change stays ordered.':single?'Isolate one arrival using the same workers, memory, filtering, and subscriber clocks.':'Prices overlap. State changes stay ordered. See what an older wake-up reads after newer prices arrive.';
    $('beats').replaceChildren(...run.chapters.map((chapter,index) => {
      const stop=document.createElement('div'),button=document.createElement('button'),small=document.createElement('span');
      const target=chapter.time??chapter.event.time,help=[chapter.question,chapter.summary||chapter.why].filter(Boolean).join(' ');
      stop.className='chapter-stop';small.textContent=target.toFixed(2)+' s';button.append(small,chapter.label);button.title=help;
      const description=document.createElement('span');description.className='sr-only';description.id=`chapter-help-${index}`;description.textContent=help;
      button.setAttribute('aria-describedby',description.id);
      button.addEventListener('click',safely(()=>seek(target)));stop.append(button,description);
      const link=document.createElement('a');link.href=TickStoryPresentation.chapterLink(chapter);link.textContent='Book chapter ↗';
      link.setAttribute('aria-label',`Read the book chapter for ${chapter.label}`);link.title=help;stop.append(link);
      return stop;
    }));
    trackAct=null;buildTracks(run.extended?run.chapters[0]:null);
    seek(0);
  }
  function chooseFocus(id) { focus=id;$('focus').value=id;detailKey='';render(); }

  function buildTracks(chapter=null) {
    const project=run.project||((t)=>t), final=run.frame(run.duration).state;
    trackAct=chapter?.id??null;trackStart=chapter?.time??0;
    const index=chapter?run.chapters.indexOf(chapter):-1;
    trackEnd=chapter?(run.chapters[index+1]?.time??run.duration):run.duration;
    const span=trackEnd-trackStart;
    const ticks=run.ticks.filter(t=>!chapter||t.act===chapter.id).sort((a,b)=>a.time-b.time);
    $('tracks-heading').textContent=chapter?'Activity in this chapter':'All ticks, one clock';
    $('tracks-note').textContent=chapter?'Rows zoom into this chapter; the main scrubber spans the complete history. Follow a row without stopping other events.':'Select a row to follow its provenance. Playback and stepping always advance the whole scene.';
    $('tracks').innerHTML=`<div class="track-scale"><span>Event / origin</span><div>${Array.from({length:6},(_,n)=>`<span style="left:${n*20}%">${(trackStart+span*n/5).toFixed(0)}s</span>`).join('')}</div><span>Now</span></div>`;
    trackRows=ticks.map(tick=>{
      const trace=final.traces[tick.id],row=document.createElement('div');row.className='track-row';row.dataset.trace=tick.id;
      const intervals=tick.type==='window'?[['working',trace.dequeuedAt,trace.finishedAt]]:[['payload',trace.emittedAt,trace.publishedAt],['waiting',trace.publishedAt,trace.dequeuedAt??trace.finishedAt],['working',trace.dequeuedAt,trace.finishedAt]];
      const origin=tick.type==='window'?'heartbeat':tick.type==='control'?'control / P'+tick.provider:names[tick.provider];
      row.innerHTML=`<button class="trace-pick" aria-label="Follow ${tick.id}, ${origin}" aria-pressed="false">${tick.id}<small>${origin}</small></button><div class="track-lane" style="--provider:${Flowdot.resolveColor(tick.type==='control'?'#violet':colours[tick.provider]||'#violet')}">${intervals.filter(([,a,b])=>a!=null&&b!=null).map(([kind,a,b])=>{const start=project(a),end=project(b);return `<span class="track-segment ${kind} " style="left:${100*(start-trackStart)/span}%;width:${Math.max(.15,100*(end-start)/span)}%" title="${tick.id}: ${kind} from ${start.toFixed(2)} to ${end.toFixed(2)} teaching seconds"></span>`;}).join('')}<i class="time-cursor"></i></div><span class="trace-status">scheduled</span>`;
      row.querySelector('button').addEventListener('click',()=>chooseFocus(focus===tick.id?'':tick.id));$('tracks').append(row);return {row,id:tick.id};
    });
    if(!ticks.length)$('tracks').insertAdjacentHTML('beforeend','<p class="small-note">No new provider arrivals. Follow the owner’s heartbeat in the diagram.</p>');
  }

  function annotate(g,env) {
    const {Draw,Tween}=Flowdot, frame=run.frame(time), state=frame.state, cache=view.byId.cache;
    if(run.extended&&state.config.filter==='off'){const [x,y]=view.byId[`work${instrument%3}`].port('stage:2');g.fillStyle=env.theme.panel2;g.fillRect(x-18,y-7,36,15);Draw.text(g,'bypass',x,y+3,{size:8,align:'center',c:env.theme.muted});}
    for(let row=0;row<6;row++) for(let p=0;p<5;p++) {
      const [cx,cy]=cache.port(`cell:${row}:${p}`),x=cx-cache.cw/2,y=cy-cache.ch/2,cell=cache.cell(row,p);
      if(p>=3) {
        g.save();g.strokeStyle=env.theme.dim;g.globalAlpha=.45;
        for(let k=7;k<cache.cw-4;k+=9){g.beginPath();g.moveTo(x+k,y+6);g.lineTo(x+5,y+k+1);g.stroke();}g.restore();
        Draw.text(g,'spare',cx,y+43,{size:9,align:'center',c:env.theme.muted});
      } else {
        g.fillStyle=cell.fresh>0?Tween.mix(env.theme.cellBg,cache.colColors[p],cell.fresh):env.theme.cellBg;
        g.fillRect(x+3,y+37,cache.cw-6,15);
        Draw.text(g,`${row===instrument?Number(state.lvc[p].at.toFixed(1)):0} ms`,cx,y+46,{size:8.5,align:'center',c:env.theme.text});
        if(row===instrument) Draw.text(g,state.lvc[p].id,cx,y+13,{size:9,align:'center',c:env.theme.series[p]});
      }
    }
    for(let p=0;p<3;p++) Draw.text(g,`P${p}`,cache.port(`colTop:${p}`)[0],cache.y-12,{size:10.5,align:'center',c:env.theme.series[p]});
    const outline=(node,c=env.theme.accent) => {const b=node.bounds();g.save();g.strokeStyle=c;g.lineWidth=1.7;Draw.roundRect(g,b.x-3,b.y-3,b.w+6,b.h+6,8);g.stroke();g.restore();};
    const [cx,cy]=cache.port(`cell:${instrument}:0`);
    g.save();g.strokeStyle=env.theme.accent;g.lineWidth=1.7;Draw.roundRect(g,cx-cache.cw/2-3,cy-cache.ch/2-3,3*(cache.cw+cache.gap)-cache.gap+6,cache.ch+6,8);g.stroke();g.restore();
    for(let t=0;t<3;t++) for(let row=0;row<6;row++) {
      const node=view.byId[`shelf${t}_${row}`];
      if(!interests[t].includes(row)){g.save();g.globalAlpha=.78;g.fillStyle=env.theme.bg;g.fillRect(node.x+1,node.y+20,node.w-2,node.h-21);g.restore();Draw.text(g,'×',node.x+node.w/2,node.y+40,{size:14,align:'center',c:env.theme.muted});}
      else if(row===instrument) outline(node,state.subscriptions[t].pending?env.theme.accent:env.theme.dim);
    }
    for(let p=0;p<3;p++) {
      const node=view.byId[`lane${instrument%3}_${p}`], ring=state.rings[p], center=node.port('center');
      Draw.text(g,`R${ring.read} W${ring.write} · ${ring.queue.length}`,center[0]+node.r+8,center[1]+17,{size:8.5,c:ring.queue.length?env.theme.white:env.theme.muted});
      if(ring.queue.some(word=>word.traceId===focus)) outline(node,env.theme.white);
    }
    if(state.work) {
      const worker=view.byId[`work${instrument%3}`];outline(worker);
      Draw.text(g,`${state.work.traceId} / ${state.work.phase}`,worker.x+12,worker.y+worker.h-8,{size:10,c:env.theme.accent});
    } else if(time<run.shardReady) {
      const worker=view.byId[`work${instrument%3}`];
      Draw.text(g,`Teaching hold until ${run.shardReady.toFixed(1)} s`,worker.x+12,worker.y+worker.h-8,{size:9,c:env.theme.muted});
    }
    if(state.lastDecision && !state.lastDecision.passed && frame.logicalMs-state.lastDecision.at<10) {
      const [x,y]=view.byId[`work${instrument%3}`].port('stage:2');
      Draw.text(g,'× FILTERED',x,y+34,{c:env.theme.bad,size:10,align:'center'});
    }
    // Labels follow native packet positions; collision avoidance moves only the label.
    const labels=[];
    for(const {packet,activity:a} of handles.values()) {
      if(packet.done) continue;
      const [x,y]=view.diagram.flow.pos(packet),selected=!focus || a.traceId===focus;
      const label=a.kind==='visit'?'P'+a.provider:a.kind==='heartbeat'?a.traceId+' · time':a.kind==='absorb'?a.traceId+' · absorb':['notify','read'].includes(a.kind)?`ID ${instrument} · ${a.traceId}`:a.version?`v${a.version} · ${a.traceId}`:a.traceId;
      g.save();g.font='10px ui-monospace,monospace';const w=g.measureText(label).width+12,h=20;
      let left=Math.max(5,Math.min(view.diagram.W-w-5,x-w/2)),top=y-28;
      for(const offset of [-28,14,-51,37,-74]) {
        top=Math.max(5,Math.min(view.diagram.H-h-5,y+offset));
        if(!labels.some(b=>left<b.x+b.w+3 && left+w+3>b.x && top<b.y+b.h+3 && top+h+3>b.y))break;
      }
      labels.push({x:left,y:top,w,h});g.globalAlpha=selected?1:.5;
      if(focus===a.traceId){g.strokeStyle=env.theme.white;g.lineWidth=1.5;g.beginPath();g.arc(x,y,10,0,Math.PI*2);g.stroke();}
      g.strokeStyle=packet.style.color;g.lineWidth=.8;g.beginPath();g.moveTo(x,y);g.lineTo(left+w/2,top<y?top+h:top);g.stroke();
      Draw.box(g,left,top,w,h,{fill:env.theme.bg,stroke:packet.style.color,r:4});
      Draw.text(g,label,left+6,top+13,{size:10,c:env.theme.text});g.restore();
    }
  }

  function describe(e,state) {
    if(run?.extended){const described=TickStoryPresentation.describe(e,state);if(described)return described;}
    if(!e) return {title:'The places exist before the prices.',text:'Seeded prices occupy the cache. Empty rings begin at R = W = 6 in the eight-slot teaching view. Start the shared clock: three providers will overlap while the shard briefly waits, then reads the latest available values.',file:'EngineService.java'};
    const id=e.traceId,p=e.provider,t=e.tier,result=e.result;
    const text={
      emitted:[`${id} joins the shared timeline.`,`${names[p]} emits bid ${e.bid}. Other arrivals keep moving on their own lanes. This tick has a teaching identity, but no identity tag is added to the engine’s wire format.`,'ingress/AeronAdapterIngress.java'],
      encoded:[`${id} is in the reusable 64-byte shape.`,`The adapter completed its canonical record. Its bytes can now cross Aeron to ingress ${p}; other providers progress independently.`,'ingress/AeronAdapterIngress.java'],
      copied:[`Ingress ${p} has copied ${id}.`,`Aeron bytes enter a reused receive segment. This worker completes the cache write and notification before processing another tick from the same provider.`,'ingress/AeronAdapterIngress.java'],
      stored:[e.overwrittenUnread?`${id} replaces a price that was never read.`:`${id} overwrites one LVC cell.`,`${e.previous?.id} → ${id} in P${p}: ${e.previous?.bid} → ${e.bid}.${e.overwrittenUnread?' The previous price had not been captured by a shard read. Its queued wake-up still exists; it cannot recover the old price.':' Other provider columns retain their current values.'} Address: (${instrument} × 5 + ${p}) × 64 = ${(instrument*5+(p??0))*64} bytes.`,'lvc/OffHeapLastValueCache.java'],
      notified:[`${id} publishes an ID, not its price.`,`P${p} writes instrument ID ${instrument} into physical slot ${e.slot}, then advances W. There are now ${e.queueTotal} unread IDs across this shard’s lanes. ${id} is teaching provenance only.`,'IngressLane.java'],
      dequeued:[`The shard takes the wake-up from ${id}.`,`R advances past physical slot ${e.slot}. This lane visit drains only through the captured W = ${e.batchEnd}; later publications wait for its next visit. The shard completes this chain before taking another ID.`,'EngineService.java'],
      read:[e.newerLeg?`An older wake-up reads newer prices.`:`${id} reads the latest provider legs.`,`${id} caused this read, which captured ${e.legs?.map(leg=>leg.id).join(' + ')}. ${e.newerLeg?`Its provider’s current leg is ${e.legs?.[p].id}, not ${id}. `:''}Weights 50 / 30 / 20 give bid ${result?.bid}. The captured values below remain fixed while subsequent arrivals update the live cache.`,'blend/WeightedAverageBlendStrategy.java'],
      blended:[`A derived price occupies Edge slot ${e.slot}.`,`The captured legs produce bid ${result?.bid}, ask ${result?.ask}. The mid transform writes ${(result?.bid+result?.ask)/2} in place. Later LVC overwrites do not change this already-derived candidate.`,'stream/ChainCompiler.java'],
      passed:[`${id} produces v${result?.version}.`,`Bid moved ${e.bidMove} and ask moved ${e.askMove} fixed-point units from the last-passed baseline. Threshold ${threshold}: pass. Advance the baseline, then visit interested subscriber shelves in order.`,'filter/InsignificantChangeFilter.java'],
      filtered:[e.bidMove===0?`Another ID. The same blended price.`:`A move of ${e.bidMove} units is filtered.`,`${id} was stored and its wake-up was consumed. This read’s candidate (${result?.bid} / ${result?.ask}) does not move enough from ${e.baseline?.bid} / ${e.baseline?.ask}. The threshold is ${threshold}. Keep the last-passed baseline and leave all subscriber shelves unchanged.`,'filter/InsignificantChangeFilter.java'],
      published:[e.replaced?`${tiers[t]} replaces unread v${e.replaced.version}.`:`${tiers[t]} stores v${result?.version}.`,`${e.replaced?`Pending v${e.replaced.version} → v${result?.version}. This is conflation, separate from the earlier filter decision.`:'The matching instrument slot becomes dirty.'} Each subscriber owns its pending value and drain clock; other ticks continue moving.`,'fanout/ConflatingClientFanout.java'],
      drained:[`${tiers[t]} snapshots its pending v${result?.version}.`,`Its deadline clears this instrument’s dirty bit. The copied v${result?.version} is now on its way to offer. A later publish may dirty the shelf again while this earlier value is still travelling.`,'fanout/ConflatingClientFanout.java'],
      offered:[`${tiers[t]} offers v${result?.version}.`,`Aeron accepts bid ${result?.bid}. This version keeps its own identity in transit; a newer shelf value cannot retroactively change the message already offered.`,'fanout/AeronClientPublication.java'],
      received:[`${tiers[t]} receives v${result?.version}.`,`The client actually sees ${fixed(result?.bid)} at ${ms(e.at)}. Its history records this receipt; pending versions replaced before a drain were never sent.`,'fanout/AeronClientPublication.java']
    };
    const [title,body,file]=text[e.kind];return {title,text:body,file};
  }

  function renderDetails(frame) {
    const state=frame.state;
    const event=focus?run.events.slice(0,frame.eventIndex+1).findLast(e=>e.traceId===focus):frame.event;
    const d=focus&&!event?{title:`${focus} has not started yet.`,text:'This event is scheduled later in the shared timeline. Stepping and playback continue to advance every provider, the owner and the clients.',file:'EngineService.java'}:describe(event,state);
    $('beat-label').textContent=event?`${focus?'Following '+focus:'Latest state change'} / ${event.time.toFixed(2)} s / ${ms(event.at)} logical`:focus?'Following '+focus+' / scheduled':'Before the first arrival';
    $('beat-title').textContent=run.extended?d.title:frame.complete && !focus?'The queues emptied. Clients saw different histories.':d.title;
    $('explanation').textContent=run.extended?d.text:frame.complete && !focus?`${state.arrivals} arrivals updated the cache; ${state.blends} wake-ups triggered reads. ${state.passed} candidates passed and ${state.filtered} were filtered. ${state.overwrittenUnread} provider price${state.overwrittenUnread===1?' was':'s were'} overwritten before any shard read. The client counters show different receipt totals: filtering and pending-slot replacement are different operations.`:d.text;
    $('event-details').innerHTML=TickStoryPresentation.eventDetails(event,run);
    $('source-link').href=event?.kind==='drained'?core+'conflation/ConflationBuffer.java':service+d.file;
    const chosen=focus?state.traces[focus]:state.work?state.traces[state.work.traceId]:state.lastRead?state.traces[state.lastRead.traceId]:null;
    const legs=chosen?.legs;
    $('mechanism').innerHTML=run.extended?TickStoryPresentation.mechanism(chosen,state,run):`<table><caption>Live cache vs ${legs?'captured read for '+chosen.id:'a shard read (none yet)'}</caption><thead><tr><th>Provider</th><th>Live LVC bid</th><th>Used in blend</th></tr></thead><tbody>${state.lvc.map((leg,p)=>`<tr><td>${names[p]}</td><td><strong>${leg.id}</strong> · ${leg.bid}<small>stored ${ms(leg.at)}</small></td><td class="${legs && legs[p].id!==leg.id?'changed':''}">${legs?`<strong>${legs[p].id}</strong> · ${legs[p].bid}<small>${legs[p].id===leg.id?'same stored version':'captured earlier; not recomputed'}</small>`:'—'}</td></tr>`).join('')}</tbody></table>${legs?`<p><code>(${legs[0].bid}×50 + ${legs[1].bid}×30 + ${legs[2].bid}×20) / 100 = ${chosen.result.bid}</code></p>`:''}<p>Last-passed baseline: <strong>${state.baseline.bid} / ${state.baseline.ask}</strong>. Minimum move: <strong>${threshold} units</strong>.</p><p>${chosen?.decision?`${chosen.id}: Δ bid ${chosen.decision.bidMove}, Δ ask ${chosen.decision.askMove} → <strong class="${chosen.decision.passed?'pass':'filtered'}">${chosen.decision.passed?'PASS':'FILTERED'}</strong>.`:legs?'These legs have been captured; this candidate has not reached its filter decision.':'The cache holds prices. The rings hold only IDs.'}</p>`;
    for(const {row,id} of trackRows) {
      const trace=state.traces[id]||{status:'scheduled'};row.classList.toggle('lapped',['lapped','overwritten ID'].includes(trace.status));row.classList.toggle('selected',focus===id);row.classList.toggle('future',trace.status==='scheduled');
      row.querySelector('button').setAttribute('aria-pressed',String(focus===id));row.querySelector('.trace-status').textContent=trace.status;
      row.querySelector('.trace-status').className='trace-status '+(trace.status==='filtered'?'filtered':trace.status==='published'?'pass':'');
    }

  }

  function render() {
    const frame=run.frame(time),state=frame.state;
    if(run.extended&&trackAct!==frame.chapter.id)buildTracks(frame.chapter);
    emit('frame_meters',{queueCount:state.rings.reduce((sum,r)=>sum+r.queue.length,0),packetCount:view.diagram.flow.size});
    view.diagram.render();$('scrub').value=String(time);
    $('scrub').setAttribute('aria-valuetext',`${time.toFixed(2)} teaching seconds, ${ms(frame.logicalMs)} logical, ${state.arrivals} arrivals, ${frame.active.length} moving packets`);
    $('clock').textContent=`${time.toFixed(2)} / ${run.duration.toFixed(2)} s`;
    $('play').textContent=playing?'Pause':time>=run.duration?'Replay sequence':time>0?'Continue sequence':mode==='single'?'Follow this tick':'Play the sequence';
    $('play').setAttribute('aria-pressed',String(playing));$('next').disabled=!frame.next;$('previous').disabled=time<=0;
    $('trace').textContent=`${pairs[instrument]} → shard ${instrument%3} · ${run.ticks.filter(t=>!t.type||t.type==='tick').length} arrivals`;
    const journeyCount=Object.values(state.traces).filter(t=>t.status!=='scheduled' && t.finishedAt===null).length;
    $('logical-clock').textContent=`${ms(frame.logicalMs)} logical`;
    $('moving-count').textContent=`${frame.active.length} packets moving`;
    $('journey-count').textContent=`${journeyCount} unfinished tick journeys`;
    $('next-change').textContent=frame.next?`Next: ${frame.next.traceId||'owner'} / ${frame.next.kind} at ${frame.next.time.toFixed(2)} s`:'Every scheduled state change has completed.';
    $('tracks').style.setProperty('--cursor',`${Math.max(0,Math.min(100,100*(time-trackStart)/(trackEnd-trackStart)))}%`);
    let chapter=-1;run.chapters.forEach((item,n)=>{if(time>=(item.time??item.event.time))chapter=n;});
    [...$('beats').querySelectorAll('button')].forEach((button,n)=>{if(n===chapter)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
    const key=`${frame.eventIndex}:${focus}:${frame.complete}`;
    if(key!==detailKey){detailKey=key;renderDetails(frame);if(run.extended)TickStoryPresentation.render(frame,run);}
    if(run.extended){TickStoryPresentation.updateClock(frame,run);$('clock-note').classList.toggle('compressed',!!frame.compression);}
  }
  function fail(error) {pause();$('error').hidden=false;$('error').textContent=`The diagram could not run: ${error.message}`;console.error(error);}
  const safely=fn=>(...args)=>{try{return fn(...args);}catch(error){fail(error);}};
  $('play').addEventListener('click',safely(play));$('reset').addEventListener('click',safely(()=>seek(0)));
  $('next').addEventListener('click',safely(()=>seek(run.frame(time).next?.time??run.duration)));
  $('previous').addEventListener('click',safely(()=>seek(run.events.findLast(e=>e.time<time-EPS)?.time??0)));
  $('finish').addEventListener('click',safely(()=>seek(run.duration)));
  $('scrub').addEventListener('input',safely(e=>seek(e.target.value)));
  for(const id of ['mode','pair','provider','threshold']) $(id).addEventListener('change',safely(configure));
  $('speed').addEventListener('change',()=>{speed=Number($('speed').value);});
  $('focus').addEventListener('change',()=>chooseFocus($('focus').value));
  // Native inspect text stays in the DSL. Only individual pipeline stages need extra context.
  $('diagram').addEventListener('mousemove',e=>{
    if(!view)return;
    const rect=e.currentTarget.getBoundingClientRect(),x=(e.clientX-rect.left)*view.diagram.W/rect.width,y=(e.clientY-rect.top)*view.diagram.H/rect.height;
    const node=view.diagram.components.findLast(c=>c.hoverable&&c.contains(x,y));
    const help=node?TickStoryPresentation.componentHelp(node,x,y):'';
    if(help)e.currentTarget.title=help;else e.currentTarget.removeAttribute('title');
    if(!playing)view.diagram.render();
  });
  $('diagram').addEventListener('mouseleave',e=>{e.currentTarget.removeAttribute('title');if(!playing&&view)view.diagram.render();});
  $('source-view').textContent=source;
  $('download').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([source+'\n'],{type:'text/plain'})),link=document.createElement('a');
    link.href=url;link.download='tick-journey.flow';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();if(view)render();}});
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{if(e.matches){pause();render();}});
  window.addEventListener('pagehide',()=>{pause();view?.dispose();});
  window.addEventListener('pageshow',e=>{if(e.persisted)seek(time);});
  window.TickJourney=Object.freeze({seek,advanceTo:target=>{advanceTo(target);render();},get view(){return view;},get run(){return run;},get time(){return time;},get playing(){return playing;},get focus(){return focus;},frame:()=>run.frame(time)});
  safely(configure)();
})();
