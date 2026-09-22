/* A deterministic teaching interleaving, not an engine latency or concurrency simulator.
 * Independent ingress workers overlap. One shard visits provider lanes in order, snapshots
 * each lane's W, and completes each chain before reading its next notification.
 * State commits are strictly separated; visual activities can overlap across many ticks.
 */
(function (root) {
  'use strict';
  const fixture = root.TickArrivalScenario || require('./tick-arrival-scenario.js');
  const {BASES, INTERESTS, INTERVALS, WEIGHTS} = fixture;
  const NAMES = ['Refinitiv', 'Bloomberg', 'EBS'];
  const PAIRS = ['EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CHF', 'AUD/USD', 'USD/CAD'];
  const DURATIONS = {encode:.6, copy:.55, store:.8, notify:.65, read:.7, blend:.8, filter:.8, publish:1.15, offer:.3, receive:.65};
  // Seconds on the shared teaching clock. The first wave lets ingress get ahead of the
  // shard; the later wave changes prices while that shard is working through old IDs.
  const EMISSIONS = [
    {time:.4, provider:0, sequence:101, delta:20},
    {time:1.15, provider:1, sequence:201, delta:12},
    {time:1.95, provider:2, sequence:301, delta:20},
    {time:3.1, provider:0, sequence:102, delta:22},
    {time:4.9, provider:1, sequence:202, delta:35},
    {time:5.85, provider:2, sequence:302, delta:24},
    {time:16.1, provider:0, sequence:103, delta:42},
    {time:18.25, provider:2, sequence:303, delta:60},
    {time:23.25, provider:1, sequence:203, delta:37},
    {time:28.15, provider:0, sequence:104, delta:70},
    {time:30.35, provider:2, sequence:304, delta:63},
    {time:32.1, provider:1, sequence:204, delta:65}
  ];
  const UNITS = 100; // integer centiseconds eliminate ambiguous floating-point event ordering
  const LOGICAL_MS_PER_SECOND = 10;
  const GAP = 12, SEPARATION = 8; // dependency gap and minimum distance between state commits
  const CAPACITY = 8, INITIAL_CURSOR = 6;
  const clone = value => JSON.parse(JSON.stringify(value));

  function compile({instrument=0, threshold=5, emissions=EMISSIONS, durations=DURATIONS, shardReady=6.4, firstDrains=[48,3.17,.84]}={}) {
    if (!Number.isInteger(instrument) || instrument < 0 || instrument >= BASES.length) throw new RangeError('Unknown instrument');
    if (!Number.isInteger(threshold) || threshold < 1) throw new RangeError('Threshold must be a positive integer');
    if (!Number.isFinite(shardReady) || shardReady < 0) throw new RangeError('Invalid shard start');
    if (!Array.isArray(firstDrains) || firstDrains.length!==3 || firstDrains.some(time => !Number.isFinite(time) || time<=0)) throw new RangeError('Invalid initial subscription deadlines');
    if (!Array.isArray(emissions) || !emissions.length) throw new RangeError('At least one arrival is required');
    for (const kind of Object.keys(DURATIONS)) if (!(durations[kind] > 0) || !Number.isFinite(durations[kind])) throw new RangeError(`Invalid ${kind} duration`);
    const seen = new Set();
    for (const tick of emissions) {
      if (!Number.isFinite(tick.time) || tick.time < 0 || !Number.isInteger(tick.provider) || tick.provider < 0 || tick.provider > 2 || !Number.isInteger(tick.sequence) || !Number.isInteger(tick.delta)) throw new RangeError('Invalid provider arrival');
      const id = `${tick.provider}:${tick.sequence}`;
      if (seen.has(id)) throw new RangeError('Duplicate provider sequence');
      seen.add(id);
    }
    const base = BASES[instrument], logical = u => u / UNITS * LOGICAL_MS_PER_SECOND;
    const ticks = emissions.map(e => ({...e, id:`${'ABC'[e.provider]}${e.sequence}`, bid:base+e.delta, ask:base+e.delta+20}));
    const state = {
      lvc:[0,10,-10].map((delta,p) => ({id:`${'ABC'[p]}${(p+1)*100}`, provider:p, sequence:(p+1)*100, bid:base+delta, ask:base+delta+20, at:0, reads:0, seed:true})),
      rings:Array.from({length:3}, (_,provider) => ({provider, write:INITIAL_CURSOR, read:INITIAL_CURSOR, queue:[], slots:Array(CAPACITY).fill(null), maxDepth:0})),
      traces:Object.fromEntries(ticks.map(tick => [tick.id, {...tick, status:'scheduled', storedAt:null, publishedAt:null, readAt:null, finishedAt:null, legs:null, decision:null, result:null}])),
      ingress:[null,null,null], adapter:[null,null,null], work:null, lastRead:null, lastDecision:null,
      edge:Array(8).fill(null), baseline:{bid:base+1,ask:base+21,version:0},
      arrivals:0, stores:0, notifications:0, dequeued:0, blends:0, passed:0, filtered:0, overwrittenUnread:0,
      subscriptions:INTERESTS.map((ids,tier) => ({tier, interested:ids.includes(instrument), interval:INTERVALS[tier], pending:null, draining:[], transit:[], received:[], replaced:0, writes:0, lastOffered:null}))
    };
    const initial = clone(state), events = [], activities = [], queue = [], occupied = [];
    let serial = 0, activityId = 0, busy = false, dequeueScheduled = false, visit = null, nextLane = 0;
    const ingressBusy = [false,false,false], waiting = [[],[],[]], adapterAvailable = [0,0,0];
    const horizon = Math.ceil((Math.max(...ticks.map(tick => tick.time)) + ticks.length*12 + 120) * UNITS);

    // Reserve distinct commits before simulation. Deadline phases are deliberately offset,
    // and other teaching operations wait a few frames if their illustrative times collide.
    function reserve(earliest) {
      let u = Math.round(earliest);
      while (occupied.some(other => Math.abs(other-u) < SEPARATION)) u += SEPARATION;
      occupied.push(u);
      return u;
    }
    function task(u, fn) { queue.push({u, fn, order:serial++}); }
    function later(earliest, fn) { const u = reserve(earliest); task(u, fn); return u; }
    function record(kind, u, fields={}) {
      const event = {index:events.length, kind, time:u/UNITS, at:logical(u), ...clone(fields), state:clone(state)};
      events.push(event);
      return event;
    }
    function flight(kind, tick, earliest, onEnd, extra={}) {
      const start = Math.round(earliest), end = reserve(start + durations[kind]*UNITS);
      const activity = {id:++activityId, kind, traceId:tick.id, provider:tick.provider,
        start:start/UNITS, end:end/UNITS, ...clone(extra)};
      activities.push(activity);task(end, u => onEnd(u, activity));
      return end;
    }
    function queuedTotal() { return state.rings.reduce((sum, ring) => sum + ring.queue.length, 0); }

    function release(u, tick) {
      state.traces[tick.id].finishedAt = u / UNITS;
      state.work = null; busy = false;
      requestDequeue(u);
    }
    function requestDequeue(u) {
      if (busy || dequeueScheduled || !queuedTotal()) return;
      dequeueScheduled = true;
      later(Math.max(u + GAP, shardReady*UNITS), consume);
    }
    function consume(u) {
      dequeueScheduled = false;
      // Mirror runShardLoop: drain through the W captured when this lane was visited,
      // then visit the next provider. There is no global FIFO across different lanes.
      if (visit && state.rings[visit.provider].read >= visit.end) { nextLane=(visit.provider+1)%3; visit=null; }
      if (!visit) {
        for (let n=0;n<3;n++) {
          const p=(nextLane+n)%3, ring=state.rings[p];
          if (ring.queue.length) { visit={provider:p,end:ring.write};break; }
        }
      }
      if (!visit) return;
      busy = true;
      const ring=state.rings[visit.provider], notification=ring.queue.shift(), tick=state.traces[notification.traceId];
      ring.read++;state.dequeued++;tick.status='reading';tick.dequeuedAt=u/UNITS;
      state.work={traceId:tick.id,provider:tick.provider,phase:'reading',startedAt:u/UNITS,batchEnd:visit.end,legs:null,result:null};
      record('dequeued', u, {traceId:tick.id,provider:tick.provider,word:instrument,slot:notification.index%CAPACITY,batchEnd:visit.end,queueTotal:queuedTotal()});
      flight('read', tick, u+GAP, at => {
        const legs=clone(state.lvc);
        for (const leg of state.lvc) leg.reads++;
        tick.legs=legs;tick.readAt=at/UNITS;tick.status='blending';
        const bid=Math.trunc(legs.reduce((sum,leg,p) => sum+leg.bid*WEIGHTS[p],0)/100);
        const ask=Math.trunc(legs.reduce((sum,leg,p) => sum+leg.ask*WEIGHTS[p],0)/100);
        const result={bid,ask,trigger:tick.id,readAt:logical(at),legs:clone(legs)};
        tick.result=clone(result);state.work.legs=clone(legs);state.work.result=clone(result);state.work.phase='blending';
        state.lastRead={traceId:tick.id,at:logical(at),time:at/UNITS,legs:clone(legs),bid,ask};
        record('read',at,{traceId:tick.id,provider:tick.provider,legs,result,newerLeg:legs[tick.provider].sequence!==tick.sequence});
        flight('blend',tick,at+GAP, blendedAt => {
          const slot=state.blends%8;state.blends++;
          state.edge[slot]=clone(result);state.work.slot=slot;state.work.phase='filtering';tick.status='filtering';
          record('blended',blendedAt,{traceId:tick.id,provider:tick.provider,result,slot});
          flight('filter',tick,blendedAt+GAP, filteredAt => {
            const baseline=clone(state.baseline), bidMove=Math.abs(result.bid-baseline.bid), askMove=Math.abs(result.ask-baseline.ask);
            const passed=bidMove>=threshold || askMove>=threshold;
            if (passed) { state.passed++;result.version=state.passed;state.baseline=clone(result); }
            else state.filtered++;
            tick.decision={passed,bidMove,askMove,baseline,at:logical(filteredAt)};tick.result=clone(result);
            state.lastDecision={traceId:tick.id,...clone(tick.decision),result:clone(result)};
            if (!passed) {
              tick.status='filtered';release(filteredAt,tick);
              record('filtered',filteredAt,{traceId:tick.id,provider:tick.provider,result,...tick.decision});
            } else {
              tick.status='publishing';state.work.phase='publishing';state.work.result=clone(result);
              record('passed',filteredAt,{traceId:tick.id,provider:tick.provider,result,...tick.decision});
              const subscribers=state.subscriptions.filter(sub => sub.interested);
              // The same shard visits subscribers in order. Their copies travel with small,
              // deliberate offsets and commit separately, keeping the global order visible.
              let previousWrite=filteredAt;
              subscribers.forEach((sub,n) => { previousWrite=flight('publish',tick,Math.max(filteredAt+GAP+n*20,previousWrite+SEPARATION-durations.publish*UNITS), writtenAt => {
                const replaced=sub.pending?clone(sub.pending):null;
                if (replaced) sub.replaced++;
                sub.pending=clone(result);sub.writes++;
                if (n===subscribers.length-1) { tick.status='published';release(writtenAt,tick); }
                record('published',writtenAt,{traceId:tick.id,provider:tick.provider,tier:sub.tier,result,replaced});
              },{tier:sub.tier,version:result.version}); });
            }
          });
        });
      });
    }

    function takeIngress(p, now) {
      if (ingressBusy[p] || !waiting[p].length) return;
      ingressBusy[p]=true;
      const tick=waiting[p].shift();
      flight('copy',tick,now+GAP,copiedAt => {
        state.ingress[p]=tick.id;tick.status='storing';
        record('copied',copiedAt,{traceId:tick.id,provider:p});
        flight('store',tick,copiedAt+GAP,storedAt => {
          const previous=clone(state.lvc[p]), overwrittenUnread=!previous.seed && previous.reads===0;
          if (overwrittenUnread) state.overwrittenUnread++;
          state.stores++;state.lvc[p]={id:tick.id,provider:p,sequence:tick.sequence,bid:tick.bid,ask:tick.ask,at:logical(storedAt),reads:0,seed:false};
          tick.storedAt=storedAt/UNITS;tick.status='notifying';
          record('stored',storedAt,{traceId:tick.id,provider:p,previous,overwrittenUnread,bid:tick.bid,ask:tick.ask});
          flight('notify',tick,storedAt+GAP,notifiedAt => {
            const ring=state.rings[p];
            if (ring.queue.length >= CAPACITY) throw new Error('This fixture exceeds the eight-slot teaching ring; it does not model a lap');
            const word={word:instrument,traceId:tick.id,index:ring.write,publishedAt:logical(notifiedAt)};
            ring.slots[ring.write%CAPACITY]=clone(word);ring.queue.push(word);ring.write++;
            ring.maxDepth=Math.max(ring.maxDepth,ring.queue.length);state.notifications++;
            tick.publishedAt=notifiedAt/UNITS;tick.status='queued';state.ingress[p]=null;ingressBusy[p]=false;
            record('notified',notifiedAt,{traceId:tick.id,provider:p,word:instrument,slot:word.index%CAPACITY,queueTotal:queuedTotal()});
            requestDequeue(notifiedAt);takeIngress(p,notifiedAt);
          });
        });
      });
    }

    // Independent subscription clocks. Staggered phases avoid synchronised tier drains.
    // Empty checks are not timeline events, and a drain snapshots exactly one pending value.
    for (let tier=0;tier<3;tier++) {
      const period=INTERVALS[tier]/LOGICAL_MS_PER_SECOND*UNITS;
      for (let u=Math.round(firstDrains[tier]*UNITS);u<horizon;u+=period) {
        occupied.push(u);
        task(u, at => {
          const sub=state.subscriptions[tier];
          if (!sub.pending) return;
          const result=clone(sub.pending), tick=state.traces[result.trigger];
          sub.pending=null;sub.draining.push({...clone(result),drainedAt:logical(at)});
          record('drained',at,{traceId:tick.id,provider:tick.provider,tier,result});
          flight('offer',tick,at+GAP,offeredAt => {
            const copy=sub.draining.find(item => item.version===result.version);
            sub.draining=sub.draining.filter(item => item!==copy);
            const offered={...copy,offeredAt:logical(offeredAt)};
            sub.transit.push(offered);sub.lastOffered=clone(offered);
            record('offered',offeredAt,{traceId:tick.id,provider:tick.provider,tier,result});
            flight('receive',tick,offeredAt+GAP,receivedAt => {
              sub.transit=sub.transit.filter(item => item.version!==result.version);
              sub.received.push({...offered,receivedAt:logical(receivedAt)});
              record('received',receivedAt,{traceId:tick.id,provider:tick.provider,tier,result});
            },{tier,version:result.version});
          },{tier,version:result.version});
        });
      }
    }
    for (const source of ticks) later(source.time*UNITS, u => {
      const tick=state.traces[source.id], p=tick.provider;
      state.arrivals++;tick.emittedAt=u/UNITS;tick.status='encoding';state.adapter[p]=tick.id;
      record('emitted',u,{traceId:tick.id,provider:p,bid:tick.bid,ask:tick.ask});
      const end=flight('encode',tick,Math.max(u+GAP,adapterAvailable[p]), encodedAt => {
        tick.status='awaiting ingress';state.adapter[p]=null;waiting[p].push(tick);
        record('encoded',encodedAt,{traceId:tick.id,provider:p});takeIngress(p,encodedAt);
      });
      adapterAvailable[p]=end+GAP;
    });

    while (queue.length) {
      queue.sort((a,b) => a.u-b.u || a.order-b.order);
      const next=queue.shift();next.fn(next.u);
    }
    events.sort((a,b) => a.time-b.time);
    if (events.some((event,n) => n && event.time <= events[n-1].time)) throw new Error('Teaching commits must have distinct times');
    if (Object.values(state.traces).some(tick => tick.finishedAt==null) || state.subscriptions.some(sub => sub.pending || sub.draining.length || sub.transit.length)) throw new Error('Teaching fixture did not finish before its deadline horizon');
    activities.sort((a,b) => a.start-b.start || a.id-b.id);
    const end=events.at(-1).time, duration=end+1.2;
    const important = [
      {label:'Feeds overlap',event:events.find(e => new Set(activities.filter(a=>a.start<=e.time && e.time<a.end).map(a=>a.traceId)).size>=3) || events.find(e=>e.kind==='emitted'),why:'Several provider payloads share the scene.'},
      {label:'Overwrite before read',event:events.find(e => e.kind==='stored' && e.overwrittenUnread),why:'A newer payload replaces a price before the shard reads it.'},
      {label:'Old ID, latest prices',event:events.find(e => e.kind==='read' && e.newerLeg),why:'A queued wake-up reads the newest provider legs.'},
      {label:'Filter a repeated blend',event:events.find(e => e.kind==='filtered'),why:'Compare the candidate with the last result that passed.'},
      {label:'Replace a pending value',event:events.find(e => e.kind==='published' && e.replaced),why:'The slow subscriber retains only its latest unread result.'},
      {label:'Delivery histories',event:events.at(-1),why:'Compare what each client actually received.'}
    ].filter(item => item.event).sort((a,b) => a.event.time-b.event.time);
    function frame(seconds) {
      const time=Math.max(0,Math.min(duration,Number(seconds)||0));
      let lo=0,hi=events.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(events[mid].time<=time)lo=mid+1;else hi=mid;}
      return {time,logicalMs:time*LOGICAL_MS_PER_SECOND,eventIndex:lo-1,event:events[lo-1]||null,next:events[lo]||null,
        state:lo?events[lo-1].state:initial,active:activities.filter(a => a.start<=time && time<a.end),complete:time>=end};
    }
    return {instrument,threshold,initial,events,activities,ticks:clone(ticks),duration,end,chapters:important,frame,
      logicalMsPerSecond:LOGICAL_MS_PER_SECOND,shardReady,firstDrains:[...firstDrains],capacity:CAPACITY,initialCursor:INITIAL_CURSOR};
  }
  const api={compile,EMISSIONS,DURATIONS,BASES,PAIRS,NAMES,INTERESTS,INTERVALS,WEIGHTS,LOGICAL_MS_PER_SECOND};
  root.TickOverlapScenario=api;
  if(typeof module!=='undefined' && module.exports) module.exports=api;
})(globalThis);
