/* One continuous, deterministic teaching story. The first act is the original overlap
 * fixture; later acts keep its cache, cursors, versions and client histories. Configuration
 * changes are explicit teaching checkpoints, not a claim of live engine reconfiguration.
 * Domain time is independent of presentation time: idle gaps are compressed only after
 * scheduling, and never through a native flight or a state change. */
(function (root) {
  'use strict';
  const Overlap = root.TickOverlapScenario || require('./tick-overlap-scenario.js');
  const {BASES, WEIGHTS, DURATIONS:ORIGINAL_DURATIONS} = Overlap;
  const DURATIONS = {...ORIGINAL_DURATIONS, visit:.28, heartbeat:.4, window_read:.7,
    absorb:.4, control_copy:.55, control_notify:.65, control_apply:.5};
  const U=100, GAP=12, SEPARATION=8, CAPACITY=8, MS_PER_SECOND=10;
  const copy=value=>JSON.parse(JSON.stringify(value));
  // Persistent snapshots share unchanged subtrees. This keeps an extended story compact
  // while ensuring later mutations cannot change a previously inspected frame.
  function snapshot(value, previous) {
    if(value===null || typeof value!=='object') return value;
    const keys=Object.keys(value), out=Array.isArray(value)?[]:{};
    let same=!!previous && keys.length===Object.keys(previous).length;
    for(const key of keys){out[key]=snapshot(value[key],previous?.[key]);if(out[key]!==previous?.[key])same=false;}
    return same?previous:out;
  }
  function metadata() {
    return {act:'arrivals', config:{windowMs:0,carry:true,filter:'price',aggregate:false,qualityAgeMs:500,maxAgeMs:2000},
      loop:{number:0,phase:'not shown',lane:null,now:null,batchEnd:null,active:false},
      window:{active:false,next:null,anchor:null,evaluations:0,missed:0},
      health:['UP','UP','UP'],session:'CONTINUOUS',aggregate:{count:0,high:null,low:null},
      heartbeats:0,absorbed:0,controls:0,lost:0,physicalOverwrites:0,suppressed:0,offerFailures:0,
      hold:false,failNextTier:null,lastHeartbeat:null,lastLoss:null,lastControl:null};
  }

  function compile({instrument=0,threshold=5,durations=DURATIONS}={}) {
    durations={...DURATIONS,...durations};
    const prefix=Overlap.compile({instrument,threshold,durations});
    const initial={...copy(prefix.initial),...metadata()};
    const events=prefix.events.map(e=>({...e,state:{...e.state,...metadata()},act:'arrivals'}));
    const activities=prefix.activities.map(a=>({...a,act:'arrivals'}));
    const ticks=prefix.ticks.map(t=>({...t,type:'tick',act:'arrivals'}));
    const chapters=[{id:'arrivals',label:'01 · Shared memory',book:'Ch 3–6, 8, 11',time:0,
      question:'What does an old wake-up read after newer prices arrive?',summary:'Overlapping ticks, LVC overwrite, FIFO lanes, filtering and subscriber conflation.'}];
    let state={...copy(prefix.frame(prefix.duration).state),...metadata()};
    for(const ring of state.rings){ring.lostPending=[];ring.overwritten=0;ring.lost=0;}
    for(const sub of state.subscriptions){sub.failed=[];sub.drainScheduled=false;}
    let now=Math.ceil(prefix.duration*U),order=0,activityId=Math.max(...activities.map(a=>a.id)),passPending=false;
    let previous=events.at(-1).state, heartbeatSequence=0,controlSequence=0;
    const sequence=[104,204,304],queue=[],occupied=events.map(e=>Math.round(e.time*U));
    const logical=u=>u / (U / MS_PER_SECOND);
    const unit=milliseconds=>Math.round(milliseconds/MS_PER_SECOND*U);
    const phaseMs=prefix.firstDrains.map(t=>t*MS_PER_SECOND);
    const lastTick=id=>state.traces[id];

    function reserve(earliest) {
      let u=Math.round(earliest);
      while(occupied.some(other=>Math.abs(other-u)<SEPARATION))u+=SEPARATION;
      occupied.push(u);return u;
    }
    function task(u,fn){queue.push({u,fn,order:order++});}
    function later(earliest,fn){const u=reserve(earliest);task(u,fn);return u;}
    function record(kind,fields={}) {
      previous=snapshot(state,previous);
      const event={index:events.length,kind,time:now/U,at:logical(now),act:state.act,...copy(fields),state:previous};
      events.push(event);return event;
    }
    function point(kind,fields,mutate=()=>{}) {
      if(queue.length)throw new Error(`Unfinished work before ${kind}`);
      now=reserve(now+GAP);mutate();return record(kind,fields);
    }
    function flight(kind,trace,earliest,onEnd,extra={}) {
      const start=Math.round(earliest),end=reserve(start+durations[kind]*U);
      const activity={id:++activityId,kind,traceId:trace.id,provider:trace.provider,start:start/U,end:end/U,act:state.act,...copy(extra)};
      activities.push(activity);task(end,()=>onEnd(activity));return end;
    }
    function flush() {
      let safety=0;
      while(queue.length){if(++safety>10000)throw new Error('Story did not settle');queue.sort((a,b)=>a.u-b.u||a.order-b.order);const next=queue.shift();now=next.u;next.fn();}
    }
    function chapter(id,label,book,question,summary) {
      flush();const event=point('chapter',{title:label,question,summary,book},()=>{state.act=id;});
      chapters.push({id,label,book,question,summary,time:event.time});
    }
    function rebuild(config) {
      point('configured',{config:{...state.config,...config}},()=>{
        state.config={...state.config,...config};state.window={active:false,next:null,anchor:null,evaluations:0,missed:0};
        state.aggregate={count:0,high:null,low:null};state.baseline={bid:null,ask:null,version:state.passed};
        state.work=null;state.lastRead=null;state.lastDecision=null;
      });
    }
    function makeTrace(spec) {
      const trace={...spec,status:'scheduled',storedAt:null,publishedAt:null,dequeuedAt:null,readAt:null,finishedAt:null,legs:null,decision:null,result:null};
      state.traces[spec.id]=trace;ticks.push({...spec});return trace;
    }
    function depth(){return state.rings.reduce((sum,r)=>sum+r.queue.length,0);}
    function publishWord(trace,control=null) {
      const p=trace.provider,ring=state.rings[p];
      state.ingress[p]=null;ingressBusy[p]=false;
      const word={word:control?control.word:instrument,type:control?'control':'tick',control,traceId:trace.id,index:ring.write,publishedAt:logical(now)};
      const overwritten=ring.queue.length===CAPACITY?ring.queue.shift():null;
      if(overwritten){ring.lostPending.push(overwritten);ring.overwritten++;state.physicalOverwrites++;lastTick(overwritten.traceId).status='overwritten ID';lastTick(overwritten.traceId).lostAt=now/U;}
      ring.slots[ring.write%CAPACITY]=copy(word);ring.queue.push(word);ring.write++;ring.maxDepth=Math.max(ring.maxDepth,ring.queue.length);
      if(!control)state.notifications++;
      trace.publishedAt=now/U;trace.status='queued';
      record(control?'control_notified':'notified',{traceId:trace.id,provider:p,word:word.word,control,slot:word.index%CAPACITY,queueTotal:depth(),overwritten});
      requestPass();
    }

    const ingressBusy=[false,false,false],waiting=[[],[],[]],adapterAvailable=[now,now,now];
    function takeIngress(p) {
      if(ingressBusy[p]||!waiting[p].length)return;
      ingressBusy[p]=true;const trace=waiting[p].shift(),control=trace.type==='control';
      flight(control?'control_copy':'copy',trace,now+GAP,()=>{
        state.ingress[p]=trace.id;trace.status=control?'packing control':'storing';
        record(control?'control_copied':'copied',{traceId:trace.id,provider:p,control:trace.control??null});
        if(control) flight('control_notify',trace,now+GAP,()=>{publishWord(trace,trace.control);releaseIngress(p);});
        else flight('store',trace,now+GAP,()=>{
          const previous=copy(state.lvc[p]),overwrittenUnread=!previous.seed&&previous.reads===0;
          if(overwrittenUnread)state.overwrittenUnread++;
          state.stores++;state.lvc[p]={id:trace.id,provider:p,sequence:trace.sequence,bid:trace.bid,ask:trace.ask,at:logical(now),reads:0,seed:false};
          trace.storedAt=now/U;trace.status='notifying';
          record('stored',{traceId:trace.id,provider:p,previous,overwrittenUnread,bid:trace.bid,ask:trace.ask});
          flight('notify',trace,now+GAP,()=>{publishWord(trace);releaseIngress(p);});
        });
      });
    }
    function releaseIngress(p){state.ingress[p]=null;ingressBusy[p]=false;takeIngress(p);}
    function arrival(provider,delta,delay=0) {
      const seq=++sequence[provider],id=`${'ABC'[provider]}${seq}`;
      const at=later(now+GAP+delay*U,()=>{
        const trace=makeTrace({id,provider,sequence:seq,bid:BASES[instrument]+delta,ask:BASES[instrument]+delta+20,type:'tick',act:state.act,time:now/U});
        trace.emittedAt=now/U;trace.status='encoding';state.arrivals++;
        record('emitted',{traceId:id,provider,bid:trace.bid,ask:trace.ask});
        adapterAvailable[provider]=flight('encode',trace,Math.max(now+GAP,adapterAvailable[provider]),()=>{
          trace.status='awaiting ingress';record('encoded',{traceId:id,provider});waiting[provider].push(trace);takeIngress(provider);
        })+GAP;
      });
      return {id,at};
    }
    function control(kind,value,subject,via=0,delay=0) {
      const kindByte=kind==='feed'?1:0,valueByte=kind==='feed'?{UP:0,DEGRADED:1,DOWN:2}[value]:{CONTINUOUS:2,HALTED:3,CLOSED:7}[value];
      const word=BigInt.asIntN(64,(1n<<63n)|(BigInt(kindByte)<<48n)|(BigInt(valueByte)<<40n)|BigInt(subject)).toString();
      const detail={kind,value,subject,word};
      later(now+GAP+delay*U,()=>{
        const trace=makeTrace({id:`C${++controlSequence}:${value}`,provider:via,type:'control',control:detail,act:state.act,time:now/U});
        trace.emittedAt=now/U;trace.status='control frame';
        record('control_emitted',{traceId:trace.id,provider:via,control:detail});waiting[via].push(trace);takeIngress(via);
      });
    }

    function requestPass() {
      if(state.hold||state.loop.active||passPending)return;
      passPending=true;later(now+GAP,()=>{
        passPending=false;state.loop={number:state.loop.number+1,phase:'capture now',lane:null,now:logical(now),batchEnd:null,active:true};
        record('pass_started',{pass:state.loop.number,passNow:state.loop.now});visit(0);
      });
    }
    function visit(p) {
      if(p===3){heartbeat();return;}
      const loopTrace={id:`pass ${state.loop.number}`,provider:p};
      flight('visit',loopTrace,now+GAP,()=>{
        const ring=state.rings[p],skip=Math.max(0,ring.write-ring.read-CAPACITY);
        state.loop.phase=`visit P${p}`;state.loop.lane=p;
        if(skip) {
          const lost=ring.lostPending.splice(0,skip);ring.read+=skip;ring.lost+=skip;state.lost+=skip;
          for(const word of lost){const trace=lastTick(word.traceId);trace.status='lapped';trace.finishedAt=now/U;}
          state.lastLoss={provider:p,count:skip,traces:lost.map(w=>w.traceId),at:logical(now)};
          record('reconciled',{provider:p,count:skip,lost,passNow:state.loop.now});
          later(now+GAP,()=>beginLane(p));
        } else beginLane(p);
      },{lane:p});
    }
    function beginLane(p) {
      const ring=state.rings[p];state.loop.batchEnd=ring.read+Math.min(512,ring.write-ring.read);
      record('lane_visited',{provider:p,batchEnd:state.loop.batchEnd,passNow:state.loop.now});
      consume(p);
    }
    function consume(p) {
      const ring=state.rings[p];
      if(ring.read>=state.loop.batchEnd){visit(p+1);return;}
      later(now+GAP,()=>{
        const word=ring.queue.shift();
        if(!word||word.index!==ring.read)throw new Error('Broken lane FIFO');
        ring.read++;const trace=lastTick(word.traceId);trace.dequeuedAt=now/U;trace.status='reading';
        if(word.type==='control'){
          record('control_dequeued',{traceId:trace.id,provider:p,control:word.control,batchEnd:state.loop.batchEnd,slot:word.index%CAPACITY,passNow:state.loop.now});
          flight('control_apply',trace,now+GAP,()=>{
            const c=word.control;
            if(c.kind==='feed')state.health[c.subject]=c.value;
            else {state.session=c.value;if(c.value==='CONTINUOUS'&&state.config.filter==='session')state.baseline={bid:null,ask:null,version:state.passed};}
            state.controls++;state.lastControl={...copy(c),at:logical(now)};trace.status='applied';trace.finishedAt=now/U;
            record('control_applied',{traceId:trace.id,provider:p,control:c,passNow:state.loop.now});consume(p);
          });
        } else {
          state.dequeued++;if(!state.config.windowMs)state.work={traceId:trace.id,provider:p,phase:'reading',startedAt:now/U,passNow:state.loop.now,legs:null,result:null};
          record('dequeued',{traceId:trace.id,provider:p,word:instrument,slot:word.index%CAPACITY,batchEnd:state.loop.batchEnd,queueTotal:depth(),passNow:state.loop.now});
          if(state.config.windowMs)flight('absorb',trace,now+GAP,()=>{
            state.window.active=true;state.absorbed++;trace.status='absorbed';trace.finishedAt=now/U;
            let sample=null;
            if(state.config.aggregate){sample=copy(state.lvc[p]);const mid=Math.trunc((sample.bid+sample.ask)/2),a=state.aggregate;a.count++;a.high=a.high===null?mid:Math.max(a.high,mid);a.low=a.low===null?mid:Math.min(a.low,mid);}
            record('absorbed',{traceId:trace.id,provider:p,passNow:state.loop.now,sample});consume(p);
          });
          else runChain(trace,'read',()=>consume(p));
        }
      });
    }
    function finishPass() {
      later(now+GAP,()=>{
        state.loop.phase='idle';state.loop.lane=null;state.loop.active=false;state.loop.batchEnd=null;
        record('pass_finished',{pass:state.loop.number,passNow:state.loop.now});
        if(depth())requestPass();
      });
    }
    function heartbeat() {
      const trace={id:`H${String(++heartbeatSequence).padStart(3,'0')}`,provider:-1};
      flight('heartbeat',trace,now+GAP,()=>{
        const w=state.window,c=state.config,passNow=state.loop.now;let action='no-op',missed=0,due=w.next;
        state.loop.phase='heartbeat';state.heartbeats++;
        if(c.windowMs) {
          if(w.next===null){w.anchor=passNow;w.next=passNow+c.windowMs;action='anchor';}
          else if(passNow>=w.next){missed=Math.floor((passNow-w.next)/c.windowMs);w.next+=c.windowMs*(missed+1);w.missed+=missed;action=w.active?'due':'inactive';if(w.active)w.evaluations++;}
          else action='early';
        }
        state.lastHeartbeat={id:trace.id,action,passNow,due,next:w.next,missed,at:logical(now)};
        record('heartbeat',{traceId:trace.id,...state.lastHeartbeat});
        if(action==='due') {
          later(now+GAP,()=>{
            const job=makeTrace({...trace,type:'window',time:now/U,act:state.act});job.emittedAt=now/U;job.dequeuedAt=now/U;job.status='reading';
            state.work={traceId:job.id,provider:-1,phase:'reading',startedAt:now/U,passNow,legs:null,result:null};
            record('window_started',{traceId:job.id,passNow});runChain(job,'window_read',finishPass);
          });
        } else finishPass();
      });
    }
    function runChain(trace,route,done) {
      state.work={traceId:trace.id,provider:trace.provider,phase:'reading',startedAt:now/U,passNow:state.loop.now,legs:null,result:null};
      flight(route,trace,now+GAP,()=>{
        const legs=copy(state.lvc),passNow=state.loop.now,c=state.config;
        const ages=legs.map(leg=>Math.max(0,passNow-leg.at));
        const included=legs.map((leg,p)=>state.health[p]!=='DOWN'&&(c.carry||ages[p]<=c.maxAgeMs));
        const weightSum=WEIGHTS.reduce((sum,w,p)=>sum+(included[p]?w:0),0);
        const quality=['HALTED','CLOSED','SUSPENDED'].includes(state.session)?0:legs.reduce((mask,leg,p)=>mask|((ages[p]>c.qualityAgeMs||state.health[p]==='DOWN')?1<<p:0),0);
        for(const leg of state.lvc)leg.reads++;
        const bid=weightSum?Math.trunc(legs.reduce((sum,leg,p)=>sum+(included[p]?leg.bid*WEIGHTS[p]:0),0)/weightSum):null;
        const result={bid,ask:bid===null?null:bid+20,trigger:trace.id,readAt:logical(now),passNow,legs,ages,included,weightSum,quality:weightSum?quality:null,derivedReady:false,transform:c.aggregate?'hiLo':'mid',health:[...state.health],session:state.session,derived:null};
        trace.legs=legs;trace.readAt=now/U;trace.result=copy(result);trace.status='blending';
        state.work.phase='blending';state.work.legs=legs;state.work.result=copy(result);
        state.lastRead={traceId:trace.id,at:logical(now),time:now/U,legs,bid,ask:result.ask};
        record('read',{traceId:trace.id,provider:trace.provider,legs,result,passNow,newerLeg:trace.provider>=0&&legs[trace.provider].id!==trace.id});
        flight('blend',trace,now+GAP,()=>{
          if(!weightSum){state.suppressed++;trace.status='suppressed';trace.finishedAt=now/U;state.work=null;record('suppressed',{traceId:trace.id,result,passNow});done();return;}
          result.derivedReady=true;
          if(c.aggregate){result.derived={high:state.aggregate.high??0,low:state.aggregate.low??0,count:state.aggregate.count};state.aggregate={count:0,high:null,low:null};}
          const slot=state.blends%8;state.blends++;state.edge[slot]=copy(result);trace.result=copy(result);trace.status='filtering';state.work.phase='filtering';state.work.slot=slot;state.work.result=copy(result);
          record('blended',{traceId:trace.id,provider:trace.provider,result,slot,passNow});
          flight('filter',trace,now+GAP,()=>{
            const baseline=copy(state.baseline),unset=baseline.bid===null;
            const bidMove=unset?null:Math.abs(result.bid-baseline.bid),askMove=unset?null:Math.abs(result.ask-baseline.ask);
            const passed=c.filter==='off'||unset||(c.filter==='session'?bidMove!==0:bidMove>=threshold||askMove>=threshold);
            if(passed){state.passed++;result.version=state.passed;state.baseline=copy(result);}else state.filtered++;
            trace.decision={passed,bidMove,askMove,baseline,at:logical(now),filter:c.filter};trace.result=copy(result);
            state.lastDecision={traceId:trace.id,...copy(trace.decision),result:copy(result)};
            if(!passed){trace.status='filtered';trace.finishedAt=now/U;state.work=null;record('filtered',{traceId:trace.id,provider:trace.provider,result,...trace.decision,passNow});done();}
            else {
              trace.status='publishing';state.work.phase='publishing';state.work.result=copy(result);
              record('passed',{traceId:trace.id,provider:trace.provider,result,...trace.decision,passNow});
              const subscribers=state.subscriptions.filter(sub=>sub.interested);let previousWrite=now;
              subscribers.forEach((sub,n)=>{
                previousWrite=flight('publish',trace,Math.max(now+GAP+n*20,previousWrite+SEPARATION-durations.publish*U),()=>{
                  const replaced=copy(sub.pending);if(replaced)sub.replaced++;
                  sub.pending=copy(result);sub.writes++;
                  if(n===subscribers.length-1){trace.status='published';trace.finishedAt=now/U;state.work=null;}
                  record('published',{traceId:trace.id,provider:trace.provider,tier:sub.tier,result,replaced,passNow});
                  scheduleDrain(sub);
                  if(n===subscribers.length-1)done();
                },{tier:sub.tier,version:result.version});
              });
            }
          });
        });
      });
    }
    function scheduleDrain(sub) {
      if(sub.drainScheduled)return;
      sub.drainScheduled=true;
      const deadline=phaseMs[sub.tier]+(Math.floor((logical(now)-phaseMs[sub.tier])/sub.interval)+1)*sub.interval;
      // Drain deadlines are independent of the shard. Reserve conflicts by moving other
      // illustrative work; these fixed phases are pre-reserved below for the whole story.
      task(unit(deadline),()=>{
        sub.drainScheduled=false;if(!sub.pending)return;
        const result=copy(sub.pending),trace=lastTick(result.trigger);sub.pending=null;
        sub.draining.push({...copy(result),drainedAt:logical(now)});
        record('drained',{traceId:trace.id,provider:trace.provider,tier:sub.tier,result});
        flight('offer',trace,now+GAP,()=>{
          const outgoing=sub.draining.find(v=>v.version===result.version);sub.draining=sub.draining.filter(v=>v!==outgoing);
          if(state.failNextTier===sub.tier){
            state.failNextTier=null;state.offerFailures++;sub.failed.push({...copy(outgoing),failedAt:logical(now)});
            record('offer_failed',{traceId:trace.id,provider:trace.provider,tier:sub.tier,result});return;
          }
          const offered={...outgoing,offeredAt:logical(now)};sub.transit.push(offered);sub.lastOffered=copy(offered);
          record('offered',{traceId:trace.id,provider:trace.provider,tier:sub.tier,result});
          flight('receive',trace,now+GAP,()=>{
            sub.transit=sub.transit.filter(v=>v.version!==result.version);sub.received.push({...offered,receivedAt:logical(now)});
            record('received',{traceId:trace.id,provider:trace.provider,tier:sub.tier,result});
          },{tier:sub.tier,version:result.version});
        },{tier:sub.tier,version:result.version});
      });
    }
    // At most 180 logical seconds; empty subscription checks need no queued tasks.
    for(let t=0;t<3;t++)for(let at=phaseMs[t];at<180000;at+=state.subscriptions[t].interval)if(unit(at)>now)occupied.push(unit(at));
    function passAt(ms){flush();now=Math.max(now,unit(ms));requestPass();flush();}
    function due(extra=5){passAt(state.window.next+extra);}
    function freshBurstBeforeBoundary(deltas=[80,72,90]) {
      flush();now=Math.max(now,unit(state.window.next-200));
      deltas.forEach((delta,p)=>arrival(p,delta,p*.7));flush();due();
    }

    chapter('heartbeat','02 · A heartbeat runs the chain','Ch 9–10','Who does work when no tick arrives?','Arrivals are absorbed; the owning shard closes a five-second window.');
    rebuild({windowMs:5000,carry:true,filter:'off',aggregate:false});requestPass();flush();freshBurstBeforeBoundary();

    chapter('silence','03 · Silence changes quality','Ch 4, 8–9','Can the same price tell a different truth?','No new arrivals. The next heartbeat carries retained prices and stamps their ages.');due();

    chapter('late','04 · A late heartbeat','Ch 9–10','Do three missed boundaries mean three invented prices?','Pause the owner across three boundaries; evaluate once and retain the original five-second grid.');
    point('heartbeat_delayed',{},()=>{state.hold=true;});now=unit(state.window.next+12000);
    point('shard_released',{},()=>{state.hold=false;});requestPass();flush();

    chapter('price_filter','05 · A window can still be filtered','Ch 8–9','Does a new quality byte force a price filter to pass?','Rebuild with the price filter. Establish a fresh baseline, then let the market go quiet.');
    rebuild({windowMs:5000,carry:true,filter:'price',aggregate:false});requestPass();flush();freshBurstBeforeBoundary();due();

    chapter('exclusion','06 · When no leg can contribute','Ch 8–9','What changes when carry-forward is disabled?','An aged-out join produces no candidate; a fresh surviving leg renormalises to all the weight.');
    rebuild({windowMs:5000,carry:false,filter:'off',aggregate:false});requestPass();flush();arrival(0,80);flush();due();
    now=unit(state.window.next-100);arrival(0,80);flush();due();

    chapter('feed','07 · DOWN and UP in lane order','Ch 8, 16','Did the shard know the provider was down before this blend?','A 32-byte control frame becomes a negative word. A later tick on the same lane sees the new status.');
    rebuild({windowMs:0,carry:true,filter:'off',aggregate:false});
    control('feed','DOWN',1,0);arrival(0,90,2);flush();
    control('feed','UP',1,0);arrival(0,90,2);flush();

    chapter('session','08 · A halt makes silence expected','Ch 8, 15–16','Why can an unchanged price pass after reopening?','A lifecycle-aware filter retains its baseline during HALTED and resets on CONTINUOUS.');
    rebuild({windowMs:0,carry:true,filter:'session',aggregate:false});arrival(0,90);flush();
    control('session','HALTED',instrument);arrival(0,90,2);flush();
    control('session','CONTINUOUS',instrument);arrival(0,90,2);flush();

    chapter('overrun','09 · The writer laps the reader','Ch 6, 10, 13','Where did the missing wake-ups go?','Hold the shard while eleven IDs enter an eight-slot lane; reconcile exactly three lost words.');
    rebuild({windowMs:5000,carry:true,filter:'off',aggregate:false});
    point('shard_held',{},()=>{state.hold=true;});
    for(let n=0;n<11;n++)arrival(0,100+n,n*.9);
    arrival(1,85,1.4);arrival(2,95,2.3);flush();
    point('shard_released',{},()=>{state.hold=false;});requestPass();flush();due();

    chapter('delivery','10 · One failed offer','Ch 11, 13','Is an overwritten pending value the same as a failed delivery?','One Institutional offer fails. Other clients continue, and the next version succeeds without retrying the lost one.');
    rebuild({windowMs:0,carry:true,filter:'off',aggregate:false});
    point('transport_blocked',{tier:2},()=>{state.failNextTier=2;});arrival(0,150);arrival(1,95,.7);flush();
    arrival(0,170);flush();

    chapter('aggregate','11 · What the last value forgot','Ch 4, 14–15','Can a final price reveal an earlier spike?','A high/low window remembers observed mids in derived slots, then resets. An empty window writes zeros.');
    rebuild({windowMs:5000,carry:true,filter:'off',aggregate:true});requestPass();flush();
    for(const delta of [120,300,-40,120]){arrival(0,delta);flush();}
    due();due();
    point('story_finished',{});

    // Project raw time to a readable film. Only truly idle spans are compressed: no
    // activity, state commit or transport copy is skipped. Domain timestamps are retained.
    const boundaries=[prefix.duration,...events.filter(e=>e.time>prefix.duration).map(e=>e.time),...activities.filter(a=>a.end>prefix.duration).flatMap(a=>[a.start,a.end])].sort((a,b)=>a-b);
    const gaps=[];
    for(let n=1;n<boundaries.length;n++){
      const start=boundaries[n-1],end=boundaries[n];
      if(end-start>4&&!activities.some(a=>a.start<end&&a.end>start))gaps.push({rawStart:start,rawEnd:end,duration:2.4});
    }
    let saved=0;
    for(const gap of gaps){gap.start=gap.rawStart-saved;gap.end=gap.start+gap.duration;saved+=(gap.rawEnd-gap.rawStart)-gap.duration;}
    function project(raw){let saved=0;for(const g of gaps){if(raw<g.rawStart)break;if(raw<=g.rawEnd)return g.start+(raw-g.rawStart)/(g.rawEnd-g.rawStart)*g.duration;saved+=(g.rawEnd-g.rawStart)-g.duration;}return raw-saved;}
    function unproject(t){let saved=0;for(const g of gaps){if(t<g.start)break;if(t<=g.end)return g.rawStart+(t-g.start)/g.duration*(g.rawEnd-g.rawStart);saved+=(g.rawEnd-g.rawStart)-g.duration;}return t+saved;}
    for(const event of events){event.rawTime=event.time;event.time=project(event.time);}
    for(const activity of activities){activity.start=project(activity.start);activity.end=project(activity.end);}
    for(const tick of ticks)tick.time=project(tick.time);
    for(const ch of chapters)ch.time=project(ch.time);
    const end=events.at(-1).time,duration=end+1.2;
    function frame(seconds){
      const time=Math.max(0,Math.min(duration,Number(seconds)||0));let lo=0,hi=events.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(events[mid].time<=time)lo=mid+1;else hi=mid;}
      const state=lo?events[lo-1].state:initial;
      return {time,logicalMs:unproject(time)*MS_PER_SECOND,eventIndex:lo-1,event:events[lo-1]||null,next:events[lo]||null,state,
        active:activities.filter(a=>a.start<=time&&time<a.end),complete:time>=end,
        chapter:chapters.findLast(c=>c.time<=time)||chapters[0],compression:gaps.find(g=>g.start<=time&&time<g.end)||null};
    }
    return {instrument,threshold,initial,events,activities,ticks,duration,end,chapters,frame,gaps,project,unproject,
      logicalMsPerSecond:MS_PER_SECOND,shardReady:prefix.shardReady,firstDrains:prefix.firstDrains,capacity:CAPACITY,initialCursor:prefix.initialCursor,extended:true};
  }
  const api={compile,DURATIONS};root.TickEngineStory=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
