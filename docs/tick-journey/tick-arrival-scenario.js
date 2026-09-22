/* Deterministic teaching fixture. No engine or transport is run by this model. */
(function (root) {
  'use strict';
  const BASES = [108560, 14852000, 127240, 89120, 67340, 135210];
  const INTERESTS = [[0, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4, 5]];
  const INTERVALS = [1000, 100, 10];
  const WEIGHTS = [50, 30, 20];
  // at = provider emission time in illustrative logical milliseconds.
  const ARRIVALS = [
    {at:20, provider:0, delta:20, sequence:101},
    {at:55, provider:1, delta:12, sequence:201},
    {at:80, provider:2, delta:20, sequence:301},
    {at:125, provider:0, delta:22, sequence:102},
    {at:150, provider:1, delta:35, sequence:202},
    {at:165, provider:2, delta:24, sequence:302},
    {at:180, provider:2, delta:60, sequence:303},
    {at:400, provider:0, delta:42, sequence:103}
  ];
  const DURATIONS = {arrival:.5, store:1.4, notify:1, blend:1.3, filter:1.2, fanout:1.2, drain:1, receive:.6};
  const ORDER = {arrival:0, store:1, notify:2, blend:3, filter:4, fanout:5, drain:6, receive:7};
  const clone = value => JSON.parse(JSON.stringify(value));

  function compile({instrument=0, threshold=5, arrivals=ARRIVALS}={}) {
    if (!Number.isInteger(instrument) || instrument<0 || instrument>=BASES.length) throw new RangeError('Unknown instrument');
    if (!Number.isInteger(threshold) || threshold<1) throw new RangeError('Threshold must be a positive fixed-point integer');
    const base = BASES[instrument];
    const seed = {bid:base+1, ask:base+21, version:0};
    const state = {
      lvc:[0,10,-10].map((delta,p)=>({bid:base+delta, ask:base+delta+20, at:0, sequence:(p+1)*100, provider:p})),
      baseline:clone(seed), candidate:null, lastDecision:null,
      arrivals:0, blends:0, passed:0, filtered:0,
      subscriptions:INTERESTS.map((set,tier)=>({tier, interested:set.includes(instrument), interval:INTERVALS[tier], pending:null, offered:null, received:[], replaced:0})),
      decisions:[]
    };
    const initial = clone(state), raw = [], candidates = new Map();
    for (const source of arrivals) {
      const tick = {...source, id:`${'ABC'[source.provider]}#${source.sequence}`, bid:base+source.delta, ask:base+source.delta+20};
      ['arrival','store','notify','blend','filter','fanout'].forEach((kind,offset)=>raw.push({at:source.at+offset, kind, tick, provider:source.provider}));
    }
    for (let tier=0;tier<3;tier++) for(let at=INTERVALS[tier];at<=1000;at+=INTERVALS[tier]) {
      raw.push({at,kind:'drain',tier}, {at:at+1,kind:'receive',tier});
    }
    raw.sort((a,b)=>a.at-b.at || ORDER[a.kind]-ORDER[b.kind] || (a.tier??0)-(b.tier??0));
    const events = [];
    let teaching = 0;
    for (const rawEvent of raw) {
      const event = {...rawEvent}, tick=event.tick;
      if (event.kind==='arrival') state.arrivals++;
      else if (event.kind==='store') {
        event.previous = clone(state.lvc[tick.provider]);
        state.lvc[tick.provider] = {bid:tick.bid,ask:tick.ask,at:event.at,sequence:tick.sequence,provider:tick.provider};
      } else if (event.kind==='notify') {
        event.word = instrument; // Attribution is the lane, never a sequence encoded in the word.
      } else if (event.kind==='blend') {
        event.legs = clone(state.lvc);
        const bid=Math.trunc(state.lvc.reduce((sum,leg,p)=>sum+leg.bid*WEIGHTS[p],0)/100);
        const ask=Math.trunc(state.lvc.reduce((sum,leg,p)=>sum+leg.ask*WEIGHTS[p],0)/100);
        state.candidate={bid,ask,trigger:tick.id,at:event.at};
        candidates.set(tick.id,state.candidate);
        event.result=clone(state.candidate);state.blends++;
      } else if (event.kind==='filter') {
        const candidate=candidates.get(tick.id);
        event.baseline=clone(state.baseline);
        event.bidMove=Math.abs(candidate.bid-state.baseline.bid);
        event.askMove=Math.abs(candidate.ask-state.baseline.ask);
        event.passed=event.bidMove>=threshold || event.askMove>=threshold;
        candidate.passed=event.passed;
        if (event.passed) {
          state.passed++;candidate.version=state.passed;state.baseline=clone(candidate);
        } else state.filtered++;
        event.result=clone(candidate);
        state.lastDecision={at:event.at,trigger:tick.id,bid:candidate.bid,ask:candidate.ask,passed:event.passed,baseline:event.baseline.bid,bidMove:event.bidMove,askMove:event.askMove,version:candidate.version??null};
        state.decisions.push(clone(state.lastDecision));
      } else if (event.kind==='fanout') {
        const candidate=candidates.get(tick.id);
        if (!candidate.passed) continue;
        event.result=clone(candidate);event.replacements=[];
        for(const subscription of state.subscriptions) if(subscription.interested) {
          if(subscription.pending) {
            event.replacements.push({tier:subscription.tier,from:subscription.pending.version,to:candidate.version});
            subscription.replaced++;
          }
          subscription.pending=clone(candidate);
        }
      } else if (event.kind==='drain') {
        const subscription=state.subscriptions[event.tier];
        if (!subscription.interested || !subscription.pending) continue; // Empty checks have no output and no visual event.
        event.result=clone(subscription.pending);
        subscription.offered={...subscription.pending,offeredAt:event.at};subscription.pending=null;
      } else if (event.kind==='receive') {
        const subscription=state.subscriptions[event.tier];
        if (!subscription.offered) continue;
        event.result=clone(subscription.offered);
        subscription.received.push({...subscription.offered,receivedAt:event.at});subscription.offered=null;
      }
      event.start=teaching;teaching+=DURATIONS[event.kind];event.end=teaching;
      event.state=clone(state);events.push(event);
    }
    // A short final hold makes the last receipt readable before playback stops.
    const duration=teaching+2;
    function frame(seconds) {
      const activeIndex=events.findIndex(event=>seconds<event.end);
      if(activeIndex<0) return {state:events.at(-1).state,event:events.at(-1),progress:1,logicalMs:events.at(-1).at,complete:true};
      const event=events[activeIndex], previous=events[activeIndex-1];
      const progress=Math.max(0,Math.min(1,(seconds-event.start)/(event.end-event.start)));
      return {state:previous?previous.state:initial,event,progress,logicalMs:previous?.at??0,complete:false};
    }
    function stateAtLogical(ms) {
      let result=initial;for(const event of events){if(event.at>ms)break;result=event.state;}return result;
    }
    return {instrument,threshold,initial,events,duration,frame,stateAtLogical};
  }
  const api={compile,BASES,ARRIVALS,INTERESTS,INTERVALS,WEIGHTS};
  root.TickArrivalScenario=api;
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
})(globalThis);
