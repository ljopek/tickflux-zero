/*
 * Flowdot — bundled by tools/build.js. Do not edit; edit src/ and rebuild.
 * Browser <script> use only (exposes window.Flowdot / SceneBuilder / Flow).
 * Node consumers: require('flowdot').
 */
/* ─────────── src/flowdot.js ─────────── */
/*
 * Flowdot — a tiny framework for animated architecture / data-flow diagrams on canvas 2D.
 *
 * Goals: reusable components with clear interfaces, a first-class flow model (a packet follows
 * a route of legs with ONE identity, so a dot never changes colour mid-air or teleports), and
 * pure logic that is unit-testable in node without a browser.
 *
 * UMD: attaches to `window.Flowdot` in the browser and `module.exports` under node.
 *
 * Concepts
 *   Theme      palette by role
 *   Tween      easing + interpolation (pure)
 *   Draw       stateless canvas helpers
 *   Component  positioned visual with named ports + hover inspect  (Box/Core/RingBuffer/Matrix/Pipeline)
 *   Connector  a pulseable edge between two ports
 *   FlowSystem packets travelling routes of legs; onArrive hooks fire in order  (pure update)
 *   Diagram    the shell: canvas/DPR, loop, hit-test, inspector, overlays
 */
(function (global) {
  "use strict";

  // ─────────────────────────────────────────────────────────── Theme
  const Theme = {
    bg:'#060910', panel:'#0f1724', panel2:'#0d131e', line:'#26374a',
    text:'#e8f0fb', muted:'#93a6bd', white:'#ffffff',
    hot:'#4d9bff', bad:'#ff5a7a', idle:'#3a4a63', dim:'#41536e', accent:'#ffd24a',
    // matrix cell fills (empty / down / stroke) — themed so a light scheme recolours them too
    cellBg:'#0e1c28', cellDown:'#2a1620', cellStroke:'#16222f',
    // the asphalt track a road's coloured surface rides on — themed so a light scheme gets a light track
    roadBed:'#0b131d',
    // domain palette (a diagram may override) — vivid so the roles stand out on the dark bg
    series:['#5ef2a0','#5cb4ff','#c98cff'],
    // named colour tokens (referenced as `#emerald` etc.) — MAP per theme; dark values == the hex the
    // examples use today, so a token'd example renders as it did. Author-facing vocabulary; see resolveColor.
    colors:{ emerald:'#5ef2a0', sky:'#5cb4ff', violet:'#c98cff', amber:'#f2cc60', rose:'#ff9db1',
             mint:'#6ee7b7', lime:'#7ee787', azure:'#4f9dff', bronze:'#c98a4a' },
    // default colour PER COMPONENT KIND (a role name resolved against the active theme) — so a diagram
    // that names no colours still renders fully themed, and a per-kind override / theme swap flows in
    // one place (see themeKindColor + the `colors <kind>:#tok` statement). Values == today's scattered
    // fallbacks, so nothing recolours. matrix draws its columns from the `series` ramp; flow uses road.
    kindColors:{ box:'line', core:'line', ring:'hot', matrix:'accent', pipeline:'accent',
                 zone:'line', road:'hot', edge:'line', flow:'hot' }
  };

  // ─────────────────────────────────────────────────────────── named theme packs
  // A registry so a diagram can pick a house style with `theme <name>` (or a page can register its own
  // brand via Flowdot.registerTheme). A named theme overlays the default Theme, so it may be partial.
  const Themes = { dark: Theme };
  function registerTheme(name, obj){ Themes[name] = obj; return obj; }
  function resolveTheme(spec){
    if (spec == null) return Object.assign({}, Theme);
    if (typeof spec === 'string') {
      const t = Themes[spec];
      if (!t) throw new Error('flowdot: unknown theme "' + spec + '" (registered: ' + Object.keys(Themes).join(', ') + ')');
      return Object.assign({}, Theme, t);
    }
    return Object.assign({}, Theme, spec);                 // an explicit object overlays the default
  }
  // One shipped example theme: a light scheme (register your own house style via registerTheme).
  registerTheme('light',     { bg:'#f4f6fb', panel:'#ffffff', panel2:'#eef2f8', line:'#94a3b8', text:'#1a2230',
    muted:'#5b6b82', white:'#0b1119', hot:'#2563eb', bad:'#dc2626', idle:'#b7c2d4', dim:'#9fb0c6',
    accent:'#b45309', cellBg:'#eef2f8', cellDown:'#fde2e4', cellStroke:'#d3dbe6', roadBed:'#d3dbe6',
    series:['#0e9f6e','#2563eb','#7c3aed'],
    colors:{ emerald:'#0e9f6e', sky:'#2563eb', violet:'#7c3aed', amber:'#b45309', rose:'#c81e5b',
             mint:'#10b981', lime:'#3f9142', azure:'#1d4ed8', bronze:'#9a6a2e' } });

  // ─────────────────────────────────────────────────────────── colour resolution (the `#` sigil)
  // Every colour is written `#<something>` (D-C). resolveColor maps it against the ACTIVE theme so a
  // token flips when the theme does, while hex + CSS names stay literal:
  //   #rgb / #rrggbb        → literal hex (never maps — exact control)
  //   #<theme token>        → theme.colors[name]  (emerald/sky/…  — MAPS per theme)
  //   #<theme role>         → theme[name]         (text/muted/line/accent/hot/… — MAPS per theme)
  //   #<css colour name>    → the bare name       (steelblue/lightblue/… — literal, canvas accepts it)
  //   else                  → throw, listing the theme's tokens (a typo like #skyy is loud, not silent)
  // A non-string or non-`#` value passes through unchanged (defensive; the parser enforces the sigil).
  const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black ' +
    'blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue ' +
    'cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue ' +
    'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
    'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow ' +
    'grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon ' +
    'lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink ' +
    'lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime ' +
    'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose ' +
    'moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen ' +
    'paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red ' +
    'rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue ' +
    'slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
    'whitesmoke yellow yellowgreen transparent currentcolor').split(' '));
  function resolveColor(value, theme) {
    if (typeof value !== 'string' || value[0] !== '#') return value;   // not a `#…` colour → pass through
    const body = value.slice(1), th = theme || Theme;
    if (/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(body)) return value;  // #hex literal
    if (th.colors && th.colors[body] != null) return th.colors[body];  // theme token → maps
    const sm = /^series(\d+)$/.exec(body);                             // #series0/1/2 → the theme's ramp (maps; for `each` loops)
    if (sm && Array.isArray(th.series) && th.series[+sm[1]] != null) return th.series[+sm[1]];
    if (typeof th[body] === 'string') return th[body];                 // theme role → maps
    if (NAMED_COLORS.has(body.toLowerCase())) return body;             // CSS name → literal
    throw new Error('flowdot: unknown colour "' + value + '" — use #hex, a theme token (' +
      Object.keys(th.colors || {}).join(', ') + '), a role, or a CSS colour name');
  }
  // The default colour for a component KIND under a theme: a per-kind override (env.kindColors, set by a
  // `colors <kind>:#tok` statement) wins; else the theme's kindColors role; else the neutral line role.
  // Total: any kind (even unlisted) resolves to a themed colour, never undefined.
  function themeKindColor(theme, kind, overrides) {
    const th = theme || Theme;
    if (overrides && overrides[kind] != null) return resolveColor(overrides[kind], th);
    const role = (th.kindColors && th.kindColors[kind]) || 'line';
    return th[role] || th.line;
  }

  // ─────────────────────────────────────────────────────────── Rng (seedable, pure)
  // mulberry32 — a tiny deterministic PRNG. A fixed seed makes an animation reproducible
  // frame-for-frame, which is what turns a diagram into a diffable, re-renderable GIF. Returns a
  // callable `()=>[0,1)` with helpers .int(n), .range(lo,hi), .pick(arr).
  function Rng(seed) {
    let a = (seed >>> 0) || 1;
    const next = () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = n => (next() * n) | 0;                 // integer in [0, n)
    next.range = (lo, hi) => lo + (hi - lo) * next(); // float in [lo, hi)
    next.pick = arr => arr[(next() * arr.length) | 0];
    return next;
  }

  // ─────────────────────────────────────────────────────────── Tween (pure)
  const Tween = {
    clamp01:t => t < 0 ? 0 : t > 1 ? 1 : t,
    ease:t => (t = Tween.clamp01(t)) < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2,
    lerp:(a,b,t) => a + (b-a)*t,
    lerpPt:(p,q,t) => [p[0]+(q[0]-p[0])*t, p[1]+(q[1]-p[1])*t],
    // Position at fraction t (0..1) along a polyline [[x,y],…] — used to animate a pulse along an
    // orthogonal/elbow route (F11) the same way lerpPt animates it along a straight leg.
    polyPt(pts, t){ if(pts.length<2) return pts[0]||[0,0];
      const seg=[]; let total=0;
      for(let i=1;i<pts.length;i++){ const dx=pts[i][0]-pts[i-1][0], dy=pts[i][1]-pts[i-1][1];
        const L=Math.hypot(dx,dy); seg.push(L); total+=L; }
      if(total===0) return pts[0];
      let d=Tween.clamp01(t)*total;
      for(let i=0;i<seg.length;i++){ if(d<=seg[i]||i===seg.length-1) return Tween.lerpPt(pts[i],pts[i+1], seg[i]?d/seg[i]:0); d-=seg[i]; }
      return pts[pts.length-1]; },
    mix(a,b,t){ const A=hex(a), B=hex(b);
      return `rgb(${(A[0]+(B[0]-A[0])*t)|0},${(A[1]+(B[1]-A[1])*t)|0},${(A[2]+(B[2]-A[2])*t)|0})`; }
  };
  // F11 (opt-in): an orthogonal "elbow" path between two points — HVH through the horizontal midpoint
  // when the run is mostly horizontal, else VHV through the vertical midpoint. Right-angle wires stop
  // dense diagrams cutting diagonally across nodes. Returns the polyline points (straight stays default).
  function orthoPts(x1,y1,x2,y2){
    if(Math.abs(x2-x1) >= Math.abs(y2-y1)){ const mx=(x1+x2)/2; return [[x1,y1],[mx,y1],[mx,y2],[x2,y2]]; }
    const my=(y1+y2)/2; return [[x1,y1],[x1,my],[x2,my],[x2,y2]];
  }
  function hex(h){ h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join('');
    return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }

  // ─────────────────────────────────────────────────────────── Draw (stateless ctx helpers)
  const Draw = {
    roundRect(g,x,y,w,h,r){ g.beginPath(); g.moveTo(x+r,y);
      g.arcTo(x+w,y,x+w,y+h,r); g.arcTo(x+w,y+h,x,y+h,r);
      g.arcTo(x,y+h,x,y,r); g.arcTo(x,y,x+w,y,r); g.closePath(); },
    box(g,x,y,w,h,o){ o=o||{}; g.save();
      if(o.glow){ g.shadowColor=o.glow; g.shadowBlur=16; }
      g.fillStyle=o.fill||Theme.panel; Draw.roundRect(g,x,y,w,h,o.r==null?10:o.r); g.fill();
      g.shadowBlur=0; g.strokeStyle=o.stroke||Theme.line; g.lineWidth=o.lw||1.2;
      Draw.roundRect(g,x,y,w,h,o.r==null?10:o.r); g.stroke(); g.restore(); },
    text(g,s,x,y,o){ o=o||{}; g.fillStyle=o.c||Theme.text;
      g.font=`${o.w==='600'?'600 ':''}${o.size||12}px ui-monospace,monospace`;
      g.textAlign=o.align||'left'; g.textBaseline=o.baseline||'alphabetic'; g.fillText(s,x,y); },
    glow(g,x,y,r,color,a){ g.save(); g.globalCompositeOperation='lighter';
      g.shadowColor=color; g.shadowBlur=r*2.6; g.globalAlpha=a==null?1:a; g.fillStyle=color;
      g.beginPath(); g.arc(x,y,r,0,7); g.fill(); g.restore(); },
    // a solid dot with a soft shadow — same footprint as glow() but NORMAL compositing, for light
    // backgrounds where additive 'lighter' washes the colour toward white (an invisible dot).
    dot(g,x,y,r,color,a){ g.save(); g.shadowColor=color; g.shadowBlur=r*1.8; g.globalAlpha=a==null?1:a;
      g.fillStyle=color; g.beginPath(); g.arc(x,y,r,0,7); g.fill(); g.restore(); },
    link(g,x1,y1,x2,y2,o){ o=o||{}; g.save(); g.globalAlpha=o.alpha==null?1:o.alpha;
      g.strokeStyle=o.c||Theme.line; g.lineWidth=o.lw||1.3; if(o.dash) g.setLineDash(o.dash);
      g.beginPath(); g.moveTo(x1,y1); g.bezierCurveTo((x1+x2)/2,y1,(x1+x2)/2,y2,x2,y2); g.stroke(); g.restore(); },
    // Stroke a polyline (F11 orthogonal/elbow routing) with the same options as link(); joins/caps
    // rounded so the right-angle bends read cleanly.
    polyline(g,pts,o){ o=o||{}; if(!pts||pts.length<2) return; g.save(); g.globalAlpha=o.alpha==null?1:o.alpha;
      g.strokeStyle=o.c||Theme.line; g.lineWidth=o.lw||1.3; g.lineJoin='round'; g.lineCap='round'; if(o.dash) g.setLineDash(o.dash);
      g.beginPath(); g.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) g.lineTo(pts[i][0],pts[i][1]); g.stroke(); g.restore(); }
  };

  // ─────────────────────────────────────────────────────────── Component base
  class Component {
    constructor(id, spec){ spec=spec||{};
      this.id=id; this.x=spec.x||0; this.y=spec.y||0; this.w=spec.w||0; this.h=spec.h||0;
      this.inspect=spec.inspect||null;          // string | (now)=>string
      this.hoverable=spec.hoverable!==false;
      this.hovered=false;
      // Per-node "activity energy" (F9): pulse/arrival bumps it to 1, update() decays it each frame.
      // OPT-IN via `decay:` — with no decay rate a kind renders exactly as before (energy is ignored).
      this.energy=0; this.decayRate=+spec.decay||0;
    }
    // Arrival/pulse bump: mark the node active. Every kind gets this now (was Pipeline/Connector only);
    // it sets pulseAt for kinds that read it and raises energy for the F9 glow (rendered only when opted in).
    pulse(now){ this.pulseAt=now; this.energy=1; }
    // Per-frame hook (Diagram's loop calls it on every component while not paused): fade energy to idle.
    update(dt){ if(this.decayRate>0) this.energy=Math.max(0, this.energy - dt*this.decayRate); }
    // Opacity that follows energy when a decay rate is set (idle→dim, active→full); 1 (no change) otherwise.
    energyAlpha(){ return this.decayRate>0 ? 0.45 + 0.55*this.energy : 1; }
    bounds(){ return {x:this.x, y:this.y, w:this.w, h:this.h}; }
    contains(mx,my){ return mx>=this.x && mx<=this.x+this.w && my>=this.y && my<=this.y+this.h; }
    // Named anchor points. Subclasses extend; base offers the box anchors.
    port(name){
      const cx=this.x+this.w/2, cy=this.y+this.h/2;
      switch(name){
        case 'center': return [cx,cy];
        case 'left': case 'in':  return [this.x, cy];
        case 'right': case 'out': return [this.x+this.w, cy];
        case 'top':    return [cx, this.y];
        case 'bottom': return [cx, this.y+this.h];
      }
      return [cx,cy];
    }
    draw(){ /* override */ }
  }

  // ─────────────────────────────────────────────────────────── Box
  class Box extends Component {
    constructor(id, spec){ super(id, spec);
      this.name=spec.name||id; this.sub=spec.sub||null; this.accent=spec.accent||null; }  // null → theme default at draw
    draw(g, env){
      const kc=themeKindColor(env.theme,'box',env.kindColors);
      const active=this.decayRate>0;                              // F9: opt-in energy glow (idle→dim, active→lit)
      if(active){ g.save(); g.globalAlpha=this.energyAlpha(); }
      Draw.box(g,this.x,this.y,this.w,this.h,{fill:env.theme.panel, stroke:this.accent||kc,
        glow:this.hovered?env.theme.hot:(active && this.energy>0.5 ? (this.accent||kc) : null)});
      Draw.text(g,this.name,this.x+this.w/2,this.y+this.h/2+(this.sub?-2:5),{c:this.accent||env.theme.text,size:13,align:'center',w:'600'});
      if(this.sub) Draw.text(g,this.sub,this.x+this.w/2,this.y+this.h/2+14,{c:env.theme.muted,size:10.5,align:'center'});
      if(active) g.restore();
    }
  }

  // ─────────────────────────────────────────────────────────── Core (pinned, double border)
  class Core extends Box {
    constructor(id, spec){ super(id, spec); this.lit=spec.lit!==false;
      // F13: a "lit-but-idle" pinned shard — `idle` renders the lit border at a calm resting intensity
      // (owns-its-data, at rest) between bright-lit and off; `owns` draws a small caption ("owns P3").
      this.idle=!!spec.idle; this.owns=(spec.owns!=null)?spec.owns:null; }
    draw(g, env){ const accent=this.accent||themeKindColor(env.theme,'core',env.kindColors);
      const active=this.decayRate>0;                              // F9: opt-in energy glow
      if(active){ g.save(); g.globalAlpha=this.energyAlpha(); }
      Draw.box(g,this.x,this.y,this.w,this.h,{fill:env.theme.panel2,stroke:env.theme.line,r:9,
        glow:this.hovered?env.theme.hot:(active && this.energy>0.5 && !this.idle ? accent : null)});
      // inner border: bright-lit (ready) · idle-but-lit (owns, at rest) · off (dim grey)
      g.save(); g.strokeStyle=this.lit?accent:env.theme.idle; g.globalAlpha=this.lit?(this.idle?0.6:0.9):0.5; g.lineWidth=1.4;
      Draw.roundRect(g,this.x+3,this.y+3,this.w-6,this.h-6,7); g.stroke(); g.restore();
      const ny=this.owns!=null?this.y+this.h/2-4:this.y+this.h/2+4;
      Draw.text(g,this.name,this.x+this.w/2,ny,{c:this.hovered?env.theme.white:accent,align:'center',w:'600'});
      if(this.owns!=null) Draw.text(g,'owns '+this.owns,this.x+this.w/2,this.y+this.h/2+13,{c:env.theme.muted,size:9.5,align:'center'});
      if(active) g.restore();
    }
  }

  // ─────────────────────────────────────────────────────────── Slot (single last-value cell, F4)
  // One conflation buffer per subscriber: holds the LAST value written, shows whether it is still
  // PENDING (dirty, un-read) and FLASHES "superseded" when a new value overwrites an un-read one —
  // the conflation moment (latest-wins). N slots side by side = a legible per-subscriber fanout,
  // where a shared "fanout box" hid the overwrite-before-read. Driven from .flow via write/dirty/clean
  // on the slot's own id (`write s1 = v` produces, `clean s1` = the subscriber read it).
  class Slot extends Component {
    constructor(id, spec){ super(id, spec);
      this.name=spec.name||id; this.accent=spec.accent||null;   // null → theme default at draw
      this.value=(spec.value!=null)?spec.value:null; this.dirty=false; this.supersededAt=-1; this.writes=0; }
    // A new value arrives. Overwriting an un-read (dirty) value is a SUPERSEDE — flash it.
    set(value, now){ if(this.dirty) this.supersededAt=(now==null?0:now); this.value=value; this.dirty=true; this.writes++; return this; }
    mark(now){ if(this.dirty) this.supersededAt=(now==null?0:now); this.dirty=true; }   // dirty, no new value
    read(){ this.dirty=false; return this.value; }                                       // subscriber drained it (clean)
    draw(g, env){ const th=env.theme, accent=this.accent||themeKindColor(th,'box',env.kindColors);
      const flash=this.supersededAt>=0 && env.now-this.supersededAt<0.5 ? 1-(env.now-this.supersededAt)/0.5 : 0;
      Draw.box(g,this.x,this.y,this.w,this.h,{fill:th.panel,stroke:this.dirty?accent:th.line,
        glow:this.hovered?th.hot:(flash>0?th.bad:(this.dirty?accent:null)),r:7});
      Draw.text(g,this.name,this.x+9,this.y+14,{c:th.muted,size:10,w:'600'});
      Draw.text(g,this.value==null?'—':String(this.value),this.x+this.w/2,this.y+this.h/2+9,
        {c:this.dirty?(this.accent||th.text):th.muted,size:16,align:'center',w:'600'});
      if(this.dirty && flash===0) Draw.glow(g,this.x+this.w-11,this.y+11,3,accent,0.9);   // pending (un-read) dot
      if(flash>0){ g.save(); g.strokeStyle=th.bad; g.globalAlpha=0.9*flash; g.lineWidth=2.2;
        Draw.roundRect(g,this.x-3,this.y-3,this.w+6,this.h+6,9); g.stroke();
        Draw.text(g,'superseded',this.x+this.w/2,this.y+this.h-5,{c:th.bad,size:8.5,align:'center',w:'600'}); g.restore(); }
    }
  }

  // ─────────────────────────────────────────────────────────── Readout (live store meter, F8)
  // A telemetry tile: renders a LIVE number bound to a store key (`count`ed counter, `set` value,
  // ring depth, `superseded`, or a dotted `comp.prop` like a ring's `overruns`). The store isn't in
  // the draw env, so SceneBuilder wires `this.get` at buildFlows time; draw/update poll it and flash
  // when the number changes. Without a behaviour block `get` stays null and it shows its initial value.
  class Readout extends Component {
    constructor(id, spec){ super(id, spec);
      this.watch=spec.watch||spec.name||id;              // store key (or `comp.prop`) to display
      this.label=spec.label||this.watch; this.unit=spec.unit||null; this.accent=spec.accent||null;
      this.value=(spec.value!=null)?spec.value:0; this._bumpAt=-1; this.get=null; }
    read(now){ if(this.get){ const v=this.get();
      if(v!=null && v!==this.value){ this.value=v; if(now!=null) this._bumpAt=now; } } return this.value; }
    update(dt, now){ super.update(dt); this.read(now); }
    draw(g, env){ const th=env.theme, accent=this.accent||themeKindColor(th,'core',env.kindColors);
      this.read(env.now);
      const bump=this._bumpAt>=0 && env.now-this._bumpAt<0.35 ? 1-(env.now-this._bumpAt)/0.35 : 0;
      Draw.box(g,this.x,this.y,this.w,this.h,{fill:th.panel2,stroke:bump>0?accent:th.line,
        glow:this.hovered?th.hot:(bump>0?accent:null),r:7});
      Draw.text(g,this.label,this.x+this.w/2,this.y+15,{c:th.muted,size:9.5,align:'center',w:'600'});
      Draw.text(g,String(this.value)+(this.unit?' '+this.unit:''),this.x+this.w/2,this.y+this.h/2+13,
        {c:accent,size:20,align:'center',w:'700'});
    }
  }

  // ─────────────────────────────────────────────────────────── RingBuffer (SPSC lane)
  // State + logic is testable (push/drain/surge/lapping); draw renders slots + write cursor.
  class RingBuffer extends Component {
    constructor(id, spec){ super(id, spec);
      this.slots=spec.slots||12; this.r=spec.r||16; this.color=spec.color||null;  // null → theme.hot at draw
      this.label=spec.label||null;      // e.g. the provider this lane carries
      // Optional, self-reserving box: a ring drawn with no explicit w/h sizes its box to hold the
      // circle AND its side label (see _labelW / bounds), so auto-placed rings never intersect.
      if(spec.w==null) this.w = 2*this.r + 14 + (this.label ? 8 + this._labelW() : 0);
      if(spec.h==null) this.h = 2*this.r + 16;
      this.fill=0; this.write=0; this.read=0; this.overruns=0; }
    // Estimated label pixel width (no canvas to measure): ~6.2px per char at size 10.5.
    _labelW(){ return this.label ? Math.ceil(String(this.label).length * 6.2) : 0; }
    // The circle is left-anchored in the box (== box centre for a square r/w), leaving room for the
    // side label on the right so both the circle and its label fit inside the reserved box.
    _cx(){ return this.x + this.r + 6; }
    push(){ this.write++; if(this.fill<this.slots) this.fill++; else this.overruns++; return this.fill; }
    drain(n){ n=n==null?1:n; const d=Math.min(n,this.fill); this.fill-=d; this.read+=d; return d; }
    surge(amount){ this.fill+=amount;
      if(this.fill>this.slots){ const skip=Math.floor(this.fill-this.slots); this.overruns+=skip; this.fill=this.slots; }
      if(this.fill<0) this.fill=0; }
    get lapping(){ return this.fill >= this.slots*0.95; }
    // The full drawn extent (circle radius + side label), unioned with the box — this is what the
    // layout must reserve so adjacent/auto-placed rings and their labels never intersect.
    bounds(){ const cx=this._cx(), cy=this.y+this.h/2, lw=this.label ? 8 + this._labelW() : 0;
      const left=Math.min(this.x, cx-this.r), right=Math.max(this.x+this.w, cx+this.r+lw);
      const top=Math.min(this.y, cy-this.r), bottom=Math.max(this.y+this.h, cy+this.r);
      return {x:left, y:top, w:right-left, h:bottom-top}; }
    port(name){ const cy=this.y+this.h/2;
      if(name==='in') return [this.x, cy];
      if(name==='center') return [this._cx(), cy];
      // `out` = the circle's right edge, so a ring sits INLINE in a flow (`a ~> ring ~> b`): a packet
      // enters left, crosses the ring, and leaves the other side (F2). The base `out` was the box-right
      // edge — for a labelled ring that lands past the side label, so the exit looked disconnected.
      if(name==='out') return [this._cx()+this.r, cy];
      return super.port(name); }
    draw(g, env){
      const color=this.color||themeKindColor(env.theme,'ring',env.kindColors), cx=this._cx(), cy=this.y+this.h/2, col=this.lapping?env.theme.bad:color;
      g.save(); g.strokeStyle=this.lapping?'rgba(239,71,111,0.55)':'rgba(130,150,180,0.32)'; g.lineWidth=1.4;
      g.beginPath(); g.arc(cx,cy,this.r,0,7); g.stroke(); g.restore();
      const filled=Math.round((this.fill/this.slots)*this.slots);
      for(let k=0;k<this.slots;k++){ const a=(k/this.slots)*2*Math.PI-Math.PI/2;
        const sx=cx+Math.cos(a)*this.r, sy=cy+Math.sin(a)*this.r, on=k<filled;
        g.fillStyle=on?col:env.theme.dim; g.beginPath(); g.arc(sx,sy,on?3:2.3,0,7); g.fill();
        if(on) Draw.glow(g,sx,sy,2.7,col,0.6); }
      const wa=((this.write%this.slots)/this.slots)*2*Math.PI-Math.PI/2;
      g.save(); g.strokeStyle=env.theme.white; g.lineWidth=1.7;
      g.beginPath(); g.arc(cx+Math.cos(wa)*this.r, cy+Math.sin(wa)*this.r,4,0,7); g.stroke(); g.restore();
      if(this.label) Draw.text(g,this.label,cx+this.r+8,cy+3,{c:color,size:10.5});
    }
  }

  // ─────────────────────────────────────────────────────────── Matrix (grid of cells)
  class Matrix extends Component {
    constructor(id, spec){ super(id, spec);
      this.rows=spec.rows; this.cols=spec.cols; this.cw=spec.cw||76; this.ch=spec.ch||56; this.gap=spec.gap||4;
      this.colColors=spec.colColors||null; this.rowLabels=spec.rowLabels||[]; this.colLabels=spec.colLabels||[];  // null → theme.series at draw
      this.title=spec.title||'Matrix'; this.subtitle=spec.subtitle||''; this.cellNote=spec.cellNote||null;
      this.w=this.cols*(this.cw+this.gap)-this.gap; this.h=this.rows*(this.ch+this.gap)-this.gap;
      this.decayRate=+spec.decay||0;                             // declarative per-frame fade (F1); 0 = latch (prior behaviour)
      this.cells=[]; for(let i=0;i<this.rows;i++){ const r=[];
        for(let j=0;j<this.cols;j++) r.push({value:null, fresh:0, down:false}); this.cells.push(r); }
      this.hi={i:-1, at:-1};
      this.snap=null;                                            // F18: {row:-1|i, at} — a bulk-read burst overlay
    }
    // Per-frame hook (called by Diagram's loop while not paused): a matrix with `decay:` self-fades
    // written cells back to idle, so `write id.i.j` from pure .flow doesn't latch ON forever.
    update(dt){ if(this.decayRate>0) this.decay(dt, this.decayRate); }
    colX(j){ return this.x + j*(this.cw+this.gap); }
    rowY(i){ return this.y + i*(this.ch+this.gap); }
    cell(i,j){ return this.cells[i][j]; }
    write(i,j,o){ o=o||{}; const c=this.cells[i][j]; Object.assign(c,o); if(o.fresh==null) c.fresh=1; }
    setDown(j,down){ for(let i=0;i<this.rows;i++){ this.cells[i][j].down=down; if(down) this.cells[i][j].fresh=0; } }
    decay(dt,rate){ for(let i=0;i<this.rows;i++)for(let j=0;j<this.cols;j++){
      const c=this.cells[i][j]; c.fresh = c.down?0:Math.max(0,c.fresh-dt*rate); } }
    highlightRow(i,now){ this.hi={i, at:now}; }
    // F18: read (visibly pull) many cells at once — a whole row (i≥0) or the WHOLE grid (i null/<0),
    // for a late-join snapshot or a shard's whole-row read. Re-freshens each valued cell (the visible
    // pull) and records a burst overlay; returns how many cells were pulled.
    snapshot(row, now){ this.snap={ row:(row==null?-1:row), at:(now==null?0:now) };
      const rows = row==null ? this.cells.map((_,i)=>i) : [row];
      let n=0; for(const i of rows){ const r=this.cells[i]; if(!r) continue;
        for(let j=0;j<this.cols;j++){ const c=r[j]; if(c.value!=null && !c.down){ c.fresh=1; n++; } } }
      return n; }
    contains(mx,my){ return mx>=this.x-46 && mx<=this.x+this.w && my>=this.y-30 && my<=this.y+this.h; }
    port(name){ // 'cell:i:j' | 'rowRight:i' | 'rowLeft:i' | 'colTop:j'
      const p=name.split(':');
      if(p[0]==='cell'){ const i=+p[1], j=+p[2]; return [this.colX(j)+this.cw/2, this.rowY(i)+this.ch/2]; }
      if(p[0]==='rowRight'){ const i=+p[1]; return [this.x+this.w, this.rowY(i)+this.ch/2]; }
      if(p[0]==='rowLeft'){ const i=+p[1]; return [this.x, this.rowY(i)+this.ch/2]; }
      if(p[0]==='colTop'){ const j=+p[1]; return [this.colX(j)+this.cw/2, this.y-6]; }
      return super.port(name);
    }
    draw(g, env){ const colColors=this.colColors||env.theme.series;
      Draw.text(g,this.title,this.x,this.y-24,{c:this.hovered?env.theme.white:env.theme.text,size:13,w:'600'});
      if(this.subtitle) Draw.text(g,this.subtitle,this.x+42,this.y-24,{c:env.theme.muted,size:10});
      for(let j=0;j<this.cols;j++){ const c=this.cells[0][j].down?env.theme.bad:colColors[j];
        g.fillStyle=c; g.fillRect(this.colX(j),this.y-8,this.cw,3);
        if(this.colLabels[j]) Draw.text(g,this.colLabels[j],this.colX(j)+this.cw/2,this.y-12,{c,size:10.5,align:'center'}); }
      for(let i=0;i<this.rows;i++) if(this.rowLabels[i])
        Draw.text(g,this.rowLabels[i],this.x-8,this.rowY(i)+this.ch/2+3,{c:env.theme.text,size:11,align:'right'});
      for(let i=0;i<this.rows;i++)for(let j=0;j<this.cols;j++){
        const x=this.colX(j), y=this.rowY(i), c=this.cells[i][j], f=c.fresh, col=colColors[j];
        const fill=c.down?env.theme.cellDown:(f>0?Tween.mix(env.theme.cellBg,col,f):env.theme.cellBg);
        Draw.box(g,x,y,this.cw,this.ch,{fill,stroke:env.theme.cellStroke,glow:f>0.4?col:null,r:6});
        if(this.cellNote){ const note=this.cellNote(i,j); if(note) Draw.text(g,note,x+6,y+13,{c:env.theme.muted,size:8.5}); }
        if(c.down) Draw.text(g,'DOWN',x+this.cw/2,y+34,{c:env.theme.bad,size:9,align:'center',w:'600'});
        else if(f>0.05 && c.value!=null){ Draw.text(g,c.value,x+this.cw/2,y+33,{c:env.theme.text,size:10,align:'center'});
          Draw.text(g,((1-f)*30|0)+'µs',x+this.cw/2,y+45,{c:env.theme.muted,size:8.5,align:'center'}); }
      }
      if(this.hi.at>=0 && env.now-this.hi.at<0.5){ const a=1-(env.now-this.hi.at)/0.5, ry=this.rowY(this.hi.i);
        g.save(); g.strokeStyle=env.theme.accent; g.globalAlpha=0.9*a; g.lineWidth=2.2;
        Draw.roundRect(g,this.colX(0)-3,ry-3,this.w+6,this.ch+6,8); g.stroke(); g.restore(); }
      // F18: the snapshot burst — a white ring sweeping the whole grid (row<0) or one row, fading over 0.6s.
      if(this.snap && env.now-this.snap.at<0.6){ const a=1-(env.now-this.snap.at)/0.6;
        g.save(); g.strokeStyle=env.theme.white; g.globalAlpha=0.85*a; g.lineWidth=2.4;
        if(this.snap.row<0) Draw.roundRect(g,this.x-4,this.y-4,this.w+8,this.h+8,10);
        else { const ry=this.rowY(this.snap.row); Draw.roundRect(g,this.colX(0)-4,ry-4,this.w+8,this.ch+8,9); }
        g.stroke(); g.restore(); }
    }
  }

  // ─────────────────────────────────────────────────────────── Pipeline (chain of stage nodes)
  // A chain of stage nodes that light up in sequence on pulse(). Horizontal by default; set
  // `vertical` to stack the steps (and label to the right). `boxed`/`pinned`/`name` wrap it in a
  // container — so the same component renders either a horizontal chain or a vertical step-stack.
  class Pipeline extends Component {
    constructor(id, spec){ super(id, spec);
      this.stages=spec.stages||['a','b'];
      // vertical stacks default to a SMALL stage radius so 3 stages fit a normal box without the
      // circles overlapping (step 24 − 2·8 = 8px gap); horizontal chains keep the larger 15.
      this.nodeR=spec.nodeR!=null?spec.nodeR:(spec.vertical?8:15); this.idle=!!spec.idle;
      this.vertical=!!spec.vertical; this.boxed=!!spec.boxed; this.pinned=!!spec.pinned;
      this.name=spec.name||null; this.accent=spec.accent||null;  // null → theme.accent at draw
      this.pad=spec.pad!=null?spec.pad:(this.vertical?36:118);
      this.step=spec.step!=null?spec.step:(this.vertical?24:70);
      this.pulseAt=-1; }
    nodeX(k){ return this.vertical ? this.x+24 : this.x+this.pad+k*this.step; }
    nodeY(k){ return this.vertical ? this.y+this.pad+k*this.step : this.y+this.h/2+4; }
    // pulse() is inherited from Component (sets pulseAt for the stage-lighting below + energy for F9).
    port(name){
      // stage:k resolves for both layouts (horizontal: x varies; vertical: y varies) so a flow can
      // route THROUGH the stages (F3b `~> pipe.stages`). nodeY(k)==nodeY(0) when horizontal, so this
      // is identical to the old horizontal behaviour.
      const m=/^stage:(\d+)$/.exec(name); if(m) return [this.nodeX(+m[1]), this.nodeY(+m[1])];
      if(this.vertical) return super.port(name);           // boxed step-stack: flow uses box edges for in/out
      if(name==='in'||name==='join') return [this.nodeX(0), this.nodeY(0)];
      if(name==='out') return [this.nodeX(this.stages.length-1), this.nodeY(0)];
      return super.port(name); }
    draw(g, env){ const th=env.theme, accent=this.accent||themeKindColor(th,'pipeline',env.kindColors);
      if(this.boxed){ Draw.box(g,this.x,this.y,this.w,this.h,{fill:this.pinned?th.panel2:th.panel,stroke:accent,glow:this.hovered?th.hot:null,r:9});
        if(this.pinned){ g.save(); g.strokeStyle=accent; g.globalAlpha=0.5; g.lineWidth=1.2; Draw.roundRect(g,this.x+3,this.y+3,this.w-6,this.h-6,7); g.stroke(); g.restore(); }
        if(this.name) Draw.text(g,this.name,this.x+11,this.y+18,{c:this.hovered?th.white:accent,size:12,w:'600'}); }
      const active=this.pulseAt>=0 && env.now-this.pulseAt<0.5;
      for(let k=0;k<this.stages.length;k++){ const nx=this.nodeX(k), ny=this.nodeY(k), lit=active && (env.now-this.pulseAt)*8>k;
        if(k<this.stages.length-1){ const nx2=this.nodeX(k+1), ny2=this.nodeY(k+1);
          g.save(); g.strokeStyle=th.line; g.globalAlpha=0.5; g.beginPath();
          if(this.vertical){ g.moveTo(nx,ny+this.nodeR+1); g.lineTo(nx2,ny2-this.nodeR-1); }
          else { g.moveTo(nx+this.nodeR+1,ny); g.lineTo(nx2-this.nodeR-1,ny); }
          g.stroke(); g.restore(); }
        const col=this.idle?th.idle:(k===0?accent:(k===this.stages.length-1?th.hot:th.text));
        g.save(); if(lit){ g.shadowColor=col; g.shadowBlur=14; } g.fillStyle=th.panel2;
        g.strokeStyle=lit?col:(this.idle?th.idle:th.line); g.lineWidth=lit?2:1.2;
        g.beginPath(); g.arc(nx,ny,this.nodeR,0,7); g.fill(); g.stroke(); g.restore();
        if(this.vertical) Draw.text(g,this.stages[k],nx+this.nodeR+8,ny+3,{c:lit?col:th.muted,size:10});
        else Draw.text(g,this.stages[k],nx,ny+3,{c:lit?col:th.muted,size:9,align:'center'}); }
    }
  }

  // ─────────────────────────────────────────────────────────── Zone (labelled architecture layer)
  class Zone extends Component {
    constructor(id, spec){ super(id, spec);
      this.label=spec.label||''; this.tint=spec.tint||'rgba(120,150,190,0.035)';
      this.accent=spec.accent||null; this.hoverable=false; }  // null → theme.line at draw
    draw(g, env){ const th=env.theme;
      g.save(); g.fillStyle=this.tint; Draw.roundRect(g,this.x,this.y,this.w,this.h,12); g.fill();
      g.globalAlpha=0.55; g.strokeStyle=this.accent||themeKindColor(th,'zone',env.kindColors); g.lineWidth=1.2; g.setLineDash([5,4]);
      Draw.roundRect(g,this.x,this.y,this.w,this.h,12); g.stroke(); g.restore();
      if(this.label) Draw.text(g,this.label,this.x+14,this.y+19,{c:th.muted,size:12,w:'600'}); }
  }

  // ─────────────────────────────────────────────────────────── Channel (a "road" packets travel on)
  // A fat, styled edge with animated lane markings — use it for transport hops so packets read as
  // cars on a road. Thin Connectors stay for in-process edges.
  class Channel extends Component {
    constructor(id, spec){ super(id, spec); this.from=spec.from; this.to=spec.to;
      this.roadW=spec.roadW||spec.width||16; this.color=spec.color||null; this.label=spec.label||null;  // `.flow` authors write width:; roadW is the IR name. null color → theme default at draw
      this.route=spec.route||null;                                     // F11 opt-in: 'ortho'/'elbow' → right-angle road; else the default bezier
      this.hoverable=spec.hoverable!==false; }
    _ortho(){ return this.route==='ortho'||this.route==='elbow'; }
    _pt(ref){ if(typeof ref==='function') return ref();
      if(ref.length===2 && typeof ref[0]==='number') return ref; return ref[0].port(ref[1]); }
    _path(g){ const a=this._pt(this.from), b=this._pt(this.to);
      if(this._ortho()){ const pts=orthoPts(a[0],a[1],b[0],b[1]);
        g.beginPath(); g.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) g.lineTo(pts[i][0],pts[i][1]); return [a,b]; }
      g.beginPath(); g.moveTo(a[0],a[1]); g.bezierCurveTo((a[0]+b[0])/2,a[1],(a[0]+b[0])/2,b[1],b[0],b[1]); return [a,b]; }
    contains(mx,my){ const a=this._pt(this.from), b=this._pt(this.to), r=this.roadW/2+4;
      return mx>=Math.min(a[0],b[0])-r && mx<=Math.max(a[0],b[0])+r && my>=Math.min(a[1],b[1])-r && my<=Math.max(a[1],b[1])+r; }
    draw(g, env){ const th=env.theme, color=this.color||themeKindColor(th,'road',env.kindColors);
      g.save(); g.lineCap='round';
      this._path(g); g.strokeStyle=th.roadBed; g.lineWidth=this.roadW; g.stroke();                         // road bed (asphalt track, themed — light in a light scheme)
      this._path(g); g.strokeStyle=color; g.globalAlpha=this.hovered?0.30:0.16; g.lineWidth=Math.max(1,this.roadW-3); g.stroke(); // surface (guard: a thin road never yields a 0/negative stroke)
      this._path(g); g.strokeStyle=color; g.globalAlpha=0.8; g.lineWidth=1.4;                        // moving lane markings
      g.setLineDash([5,9]); g.lineDashOffset=-(env.now*36)%14; g.stroke(); g.setLineDash([]);
      g.restore();
      if(this.label){ const a=this._pt(this.from), b=this._pt(this.to);
        Draw.text(g,this.label,(a[0]+b[0])/2,Math.min(a[1],b[1])-this.roadW/2-4,{c:th.muted,size:8.5,align:'center'}); } }
  }

  // ─────────────────────────────────────────────────────────── Connector (pulseable edge)
  class Connector {
    constructor(from, to, opts){ this.from=from; this.to=to; this.opts=opts||{}; this.pulseAt=-1; }
    pulse(now){ this.pulseAt=now; }
    _pt(ref){ // [component, portName] | [x,y] | ()=>[x,y]
      if(typeof ref==='function') return ref();
      if(ref.length===2 && typeof ref[0]==='number') return ref;
      return ref[0].port(ref[1]); }
    _ortho(){ const r=this.opts.route; return r==='ortho'||r==='elbow'; }   // F11 opt-in; straight (bezier) stays default
    draw(g, env){ const a=this._pt(this.from), b=this._pt(this.to);
      const dash=this.opts.dash||(this.opts.dashed?[5,4]:null);   // `dashed` flag → a default dash (async/lossy edge)
      const col=this.opts.c||themeKindColor(env.theme,'edge',env.kindColors), alpha=this.opts.alpha==null?0.18:this.opts.alpha;
      const ortho=this._ortho(), pts=ortho?orthoPts(a[0],a[1],b[0],b[1]):null;
      if(ortho) Draw.polyline(g,pts,{c:col,alpha,dash});
      else Draw.link(g,a[0],a[1],b[0],b[1],{c:col,alpha,dash});
      if(this.opts.label){                                        // a documentation label on a chip at the edge midpoint
        const mid=ortho?Tween.polyPt(pts,0.5):[(a[0]+b[0])/2,(a[1]+b[1])/2], mx=mid[0], my=mid[1];
        g.save(); g.font='10px ui-monospace,monospace'; const tw=g.measureText(this.opts.label).width;
        g.globalAlpha=0.9; g.fillStyle=env.theme.panel; Draw.roundRect(g,mx-tw/2-5,my-14,tw+10,16,4); g.fill(); g.globalAlpha=1;
        Draw.text(g,this.opts.label,mx,my-3,{c:env.theme.muted,size:10,align:'center'}); g.restore(); }
      if(this.pulseAt>=0 && env.now-this.pulseAt<0.45){ const t=Tween.ease((env.now-this.pulseAt)/0.45);
        const p=ortho?Tween.polyPt(pts,t):Tween.lerpPt(a,b,t); Draw.glow(g,p[0],p[1],3.4,this.opts.pulseColor||env.theme.accent); } }
  }

  // A documentation callout: a text chip floated above a target component, tied to it by a leader line.
  class Note {
    constructor(ref, text){ this.ref=ref; this.text=text; }
    draw(g, env){ const top=this.ref.port('top'); const nx=top[0], ny=top[1], ty=ny-32;
      g.save(); g.font='10px ui-monospace,monospace'; const tw=g.measureText(this.text).width;
      g.strokeStyle=env.theme.muted; g.globalAlpha=0.55; g.setLineDash([2,3]); g.lineWidth=1;   // leader line
      g.beginPath(); g.moveTo(nx,ny); g.lineTo(nx,ty+9); g.stroke(); g.setLineDash([]); g.globalAlpha=1;
      g.fillStyle=env.theme.panel2; Draw.roundRect(g,nx-tw/2-6,ty-9,tw+12,18,5); g.fill();          // chip
      g.strokeStyle=env.theme.line; g.lineWidth=1; Draw.roundRect(g,nx-tw/2-6,ty-9,tw+12,18,5); g.stroke();
      Draw.text(g,this.text,nx,ty+4,{c:env.theme.text,size:10,align:'center'}); g.restore(); }
  }

  // A free labelled divider / rule (F12): a standalone line for a process boundary or a hot/cold split,
  // not tied to any node (that is what note/zone can't express). `divider "label" x1,y1 -> x2,y2`.
  class Divider {
    constructor(spec){ spec=spec||{};
      this.x1=+spec.x1; this.y1=+spec.y1; this.x2=+spec.x2; this.y2=+spec.y2;
      this.label=spec.label||null; this.color=spec.color||null; this.dashed=spec.dashed!==false; }
    draw(g, env){ const c=this.color||env.theme.muted;
      g.save(); g.strokeStyle=c; g.globalAlpha=0.6; g.lineWidth=1.4; if(this.dashed) g.setLineDash([6,5]);
      g.beginPath(); g.moveTo(this.x1,this.y1); g.lineTo(this.x2,this.y2); g.stroke(); g.setLineDash([]); g.restore();
      if(this.label){ const mx=(this.x1+this.x2)/2, my=(this.y1+this.y2)/2;
        g.save(); g.font='10px ui-monospace,monospace'; const tw=g.measureText(this.label).width;
        g.globalAlpha=0.94; g.fillStyle=env.theme.panel2; Draw.roundRect(g,mx-tw/2-6,my-9,tw+12,18,5); g.fill();
        g.strokeStyle=c; g.globalAlpha=0.5; g.lineWidth=1; Draw.roundRect(g,mx-tw/2-6,my-9,tw+12,18,5); g.stroke(); g.globalAlpha=1;
        Draw.text(g,this.label,mx,my+4,{c:env.theme.text,size:10,align:'center'}); g.restore(); } }
  }

  // A ghost / counterfactual annotation (F16): a DIM, italic, dashed callout ("what a naïve impl would
  // cost" — GC debt, pointer-chase, a blocking queue). It's part of a toggleable layer (Diagram.ghostOn),
  // HIDDEN by default; the scene registers one overlay that draws the ghosts only while the layer is on.
  class Ghost {
    constructor(spec){ spec=spec||{};
      this.text=spec.text||''; this.x=+spec.x; this.y=+spec.y;
      this.x2=(spec.x2!=null)?+spec.x2:null; this.y2=(spec.y2!=null)?+spec.y2:null; this.color=spec.color||null; }
    draw(g, env){ const c=this.color||env.theme.muted;
      g.save(); g.globalAlpha=0.42;                                 // dim — a faded counterfactual under the real diagram
      if(this.x2!=null){ g.strokeStyle=c; g.lineWidth=1.4; g.setLineDash([2,4]);  // an optional ghost wire
        g.beginPath(); g.moveTo(this.x,this.y); g.lineTo(this.x2,this.y2); g.stroke(); g.setLineDash([]); }
      if(this.text){ g.font='italic 10px ui-monospace,monospace'; const tw=g.measureText(this.text).width;
        g.strokeStyle=c; g.lineWidth=1; g.setLineDash([3,3]); Draw.roundRect(g,this.x-tw/2-6,this.y-9,tw+12,18,5); g.stroke(); g.setLineDash([]);
        Draw.text(g,this.text,this.x,this.y+4,{c:c,size:10,align:'center'}); }
      g.restore(); }
  }

  // Relative luminance (WCAG) of a #rrggbb — used to detect a light theme background so the flow dot
  // renders solid instead of additively (which would wash it out to white on a light bg).
  function relLum(hex){ const m=/^#?([0-9a-f]{6})$/i.exec(hex||''); if(!m) return 0;
    const n=parseInt(m[1],16), lin=c=>{c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
    return 0.2126*lin(n>>16&255)+0.7152*lin(n>>8&255)+0.0722*lin(n&255); }

  // ─────────────────────────────────────────────────────────── FlowSystem (packets on routes)
  // A leg: { from, to, dur, style?, onArrive? }.  from/to are port refs (see Connector._pt).
  // A packet keeps ONE identity across its whole route — this is what stops dots teleporting.
  class FlowSystem {
    constructor(){ this.packets=[]; }
    spawn(route, opts){ opts=opts||{};
      this.packets.push({ route, i:0, t:0, done:false, style:opts.style||{color:Theme.hot,r:3.4}, data:opts.data||{} });
      return this.packets[this.packets.length-1]; }
    get size(){ return this.packets.length; }
    update(dt){ for(const p of this.packets){ if(p.done) continue;
        const leg=p.route[p.i]; p.t += dt/leg.dur;
        if(p.t>=1){ p.t=0; if(leg.onArrive) leg.onArrive(p); p.i++; if(p.i>=p.route.length) p.done=true; } }
      this.packets=this.packets.filter(p=>!p.done); }
    _pt(ref){ if(typeof ref==='function') return ref();
      if(ref.length===2 && typeof ref[0]==='number') return ref; return ref[0].port(ref[1]); }
    pos(p){ const leg=p.route[p.i]; return Tween.lerpPt(this._pt(leg.from), this._pt(leg.to), Tween.ease(p.t)); }
    draw(g,env){ const light=env&&env.theme&&relLum(env.theme.bg)>0.5;   // solid dot on a light bg (glow washes out)
      for(const p of this.packets){ const leg=p.route[p.i]; const st=leg.style||p.style;
      const q=this.pos(p); (light?Draw.dot:Draw.glow)(g,q[0],q[1],st.r||3.4,st.color); } }
  }

  // ─────────────────────────────────────────────────────────── FlowRuntime (temporal control)
  // The discrete-event core of an animated diagram, factored out of bespoke per-frame code so the
  // behaviour DSL (see DIAGRAM-LANGUAGE-DESIGN.md) can drive it. One update(dt,now) runs five
  // phases in a FIXED order, which is what makes a refactor onto it behaviour-preserving:
  //   1. sources    — periodic emitters (a rate accumulator + optional guard)          `flow … rate:`
  //   2. onFrame    — host per-frame work (decay, surge, …)                            `js{ … }` escape
  //   3. timers     — scheduled callbacks whose time has come, budget-limited & in time order  `after D:`
  //   4. periodics  — per-entity behaviour at an interval, with an optional guard       `every … per …`
  //   5. afterFrame — host end-of-frame work (metrics roll-up)                          `js{ … }` escape
  // Pure logic (no canvas) → unit-testable.
  class FlowRuntime {
    constructor(){ this.now=0; this._sources=[]; this._timers=[]; this._periodics=[];
      this._onFrame=null; this._afterFrame=null; this._timerBudget=null; this._modes={}; this._events={}; this._modeHooks=[]; }
    // Named events: `after D: ev` schedules emit(ev) at t+D; `on ev(p): …` handlers register here.
    onEvent(name, fn){ (this._events[name] || (this._events[name] = [])).push(fn); return this; }
    emit(name, arg){ const hs=this._events[name]; if(hs) for(const h of hs) h(arg); return this; }
    // Named modes (e.g. `storm`) carry effects; while active, an `op:'rate'` effect multiplies the
    // spawn rate of every source (shrinking its interval). Toggle with setMode; query with modeActive
    // (the `mode(name)` expression built-in reads this). `op:'drainMul'` is parsed + stored for the
    // periodics phase (wired with `every … per …`); it does not affect sources.
    defineMode(name, effects){ this._modes[name]={active:false, effects:effects||[]}; return this; }
    // F14: a mode can drive STATE, not just rate. SceneBuilder registers a hook here (it owns the
    // components); setMode calls it ONLY on an actual on/off transition, so state effects apply once
    // on enter and revert once on exit (no double-apply from a redundant toggle).
    onModeChange(fn){ this._modeHooks.push(fn); return this; }
    setMode(name, on){ const m=this._modes[name]; if(m){ const was=m.active; m.active=(on!==false);
      if(m.active!==was) for(const h of this._modeHooks) h(name, m.active); } return this; }
    modeActive(name){ const m=this._modes[name]; return !!(m && m.active); }
    modeNames(){ return Object.keys(this._modes); }
    _rateFactor(){ let f=1; for(const k in this._modes){ const m=this._modes[k];
      if(m.active) for(const e of m.effects) if(e.op==='rate') f*=e.factor; } return f; }
    // {interval:()=>seconds, guard?:()=>bool, fire:()=>void}
    source(spec){ this._sources.push(Object.assign({acc:0}, spec)); return this; }
    // {items, interval:(item,i)=>seconds, when?:(item,i)=>bool, fire:(item,i)=>void}
    every(spec){ this._periodics.push(Object.assign({last:spec.items.map(()=>0)}, spec)); return this; }
    // schedule fire() after `delay` seconds (relative to the current runtime clock)
    after(delay, fn){ this._timers.push({at:this.now+delay, fn}); return this; }
    // Restart the flow from t=0: clock, source/periodic accumulators, pending one-shots and the state
    // store all return to their initial values (modes/handlers/sources themselves are kept, so the
    // diagram replays deterministically). Wired to the transport "Reset" control. ponytail: drops
    // pending `after` timers rather than rebasing them — they re-arm as the flow re-fires.
    reset(){ this.now=0;
      for(const s of this._sources) s.acc=0;
      for(const p of this._periodics) p.last=p.items.map(()=>0);
      this._timers.length=0;
      if(this.store && this.store.reset) this.store.reset();
      return this; }
    onFrame(fn){ this._onFrame=fn; return this; }
    afterFrame(fn){ this._afterFrame=fn; return this; }
    timerBudget(fn){ this._timerBudget=fn; return this; }         // ()=>maxTimersFiredPerUpdate
    update(dt, now){ this.now=now;
      const rf=this._rateFactor();                                    // active modes speed up sources
      for(const s of this._sources){ s.acc+=dt; const gap=s.interval()/rf;
        if(gap<=0){ if(!s.guard || s.guard()) s.fire(); s.acc=0; continue; }  // 0/neg interval → once per update, never spin
        while(s.acc>gap){ s.acc-=gap; if(!s.guard || s.guard()) s.fire(); } }
      if(this._onFrame) this._onFrame(dt);
      if(this._timers.length){ this._timers.sort((a,b)=>a.at-b.at);   // stable → equal-time = FIFO
        const budget=this._timerBudget?this._timerBudget():Infinity; let n=0;
        while(this._timers.length && this._timers[0].at<=now && n<budget){ this._timers.shift().fn(); n++; } }
      for(const p of this._periodics) p.items.forEach((it,ix)=>{ const iv=p.interval(it,ix);
        if((!p.when || p.when(it,ix)) && now-p.last[ix]>=iv){ p.last[ix]=now; p.fire(it,ix); } });
      if(this._afterFrame) this._afterFrame(dt);
    }
  }

  // ─────────────────────────────────────────────────────────── Diagram (shell)
  class Diagram {
    constructor(canvas, spec){ spec=spec||{};
      this.cv=canvas; this.g=canvas.getContext('2d');
      this.W=spec.width||1380; this.H=spec.height||820;
      this.theme=resolveTheme(spec.theme);                 // string name (registry) | object | undefined
      this.kindColors=spec.kindColors||null;               // per-kind colour override (raw #tokens; see themeKindColor)
      // paint a named non-default theme's background (so `theme light` visibly re-skins);
      // the default/dark theme keeps the transparent clear so existing pages are pixel-identical.
      this._themeBg=(typeof spec.theme==='string' && spec.theme!=='dark') ? this.theme.bg : null;
      this.DPR=Math.min(2, (global.devicePixelRatio||1));
      this.cv.width=this.W*this.DPR; this.cv.height=this.H*this.DPR; this.cv.style.aspectRatio=this.W+' / '+this.H;
      this.components=[]; this.connectors=[]; this.zones=[]; this.roads=[]; this.flow=new FlowSystem(); this.overlays=[];
      this.annotations=[]; this.legend=null;                 // note callouts + an opt-in colour key
      this.title=spec.title||null; this.subtitle=spec.subtitle||null; this.background=spec.background||null;
      this.onUpdate=spec.onUpdate||null;
      this.now=0; this.paused=false; this.speed=1; this._hover=null; this._lastT=0;
      this.ghostOn=false;                                    // F16: counterfactual layer hidden until toggled
      this._insEl=null; this._insDefault=''; this._stopped=false; this._raf=null;
      this._bindMouse();
    }
    add(c){ this.components.push(c); return c; }
    addZone(z){ this.zones.push(z); return z; }
    addRoad(r){ this.roads.push(r); return r; }
    connector(from,to,opts){ const c=new Connector(from,to,opts); this.connectors.push(c); return c; }
    note(ref,text){ const n=new Note(ref,text); this.annotations.push(n); return n; }
    divider(spec){ const d=new Divider(spec); this.annotations.push(d); return d; }
    overlay(fn){ this.overlays.push(fn); return this; }
    inspector(el, defaultHTML){ this._insEl=el; this._insDefault=defaultHTML||''; this._setIns(null); return this; }
    setPaused(b){ this.paused=b; } setSpeed(s){ this.speed=s; }
    setGhost(b){ this.ghostOn=!!b; return this; }           // F16: show/hide the counterfactual overlay
    env(){ return {now:this.now, dt:this._dt||0, theme:this.theme, kindColors:this.kindColors, flow:this.flow, diagram:this}; }

    _bindMouse(){
      // Stored as fields so dispose() can removeEventListener them (no leaked listeners on re-mount).
      this._onMove = e=>{ const rc=this.cv.getBoundingClientRect();
        const mx=(e.clientX-rc.left)*(this.W/rc.width), my=(e.clientY-rc.top)*(this.H/rc.height);
        let hit=null; for(let i=this.components.length-1;i>=0;i--){ const c=this.components[i];
          if(c.hoverable && c.contains(mx,my)){ hit=c; break; } }
        if(!hit) for(let i=this.roads.length-1;i>=0;i--){ const r=this.roads[i];   // roads only in empty gaps
          if(r.hoverable && r.contains(mx,my)){ hit=r; break; } }
        if(this._hover && this._hover!==hit) this._hover.hovered=false;
        this._hover=hit; if(hit) hit.hovered=true; this._setIns(hit); };
      this._onLeave = ()=>{ if(this._hover) this._hover.hovered=false; this._hover=null; this._setIns(null); };
      this.cv.addEventListener('mousemove', this._onMove);
      this.cv.addEventListener('mouseleave', this._onLeave);
    }
    _setIns(c){ if(!this._insEl) return;
      let html=this._insDefault; if(c && c.inspect) html = (typeof c.inspect==='function')?c.inspect(this.now):c.inspect;
      this._insEl.innerHTML='<span>'+html+'</span>'; }

    start(){ this._stopped=false; const loop=t=>{ if(this._stopped) return;   // dispose()/stop() halts the loop
        if(!this._lastT) this._lastT=t;
        const dt=Math.min(0.05,(t-this._lastT)/1000)*this.speed; this._lastT=t; this._dt=dt;
        if(!this.paused){ this.now+=dt; if(this.onUpdate) this.onUpdate(dt,this.now); this.flow.update(dt);
          for(const c of this.components) if(c.update) c.update(dt, this.now); }   // per-component per-frame hook (e.g. matrix decay:)
        this.render(); this._raf=global.requestAnimationFrame(loop); };
      this._raf=global.requestAnimationFrame(loop); return this; }
    // Halt the animation loop (cancel the pending frame). Idempotent; safe to call before start().
    stop(){ this._stopped=true;
      if(this._raf!=null && typeof global.cancelAnimationFrame==='function') global.cancelAnimationFrame(this._raf);
      this._raf=null; return this; }
    // Full teardown: stop the loop AND drop the canvas listeners, so re-mounting leaks nothing.
    dispose(){ this.stop();
      if(this.cv && this.cv.removeEventListener){
        this.cv.removeEventListener('mousemove', this._onMove);
        this.cv.removeEventListener('mouseleave', this._onLeave); }
      return this; }

    render(){ const g=this.g, env=this.env();
      g.setTransform(this.DPR,0,0,this.DPR,0,0);
      if(this._themeBg){ g.fillStyle=this._themeBg; g.fillRect(0,0,this.W,this.H); } else g.clearRect(0,0,this.W,this.H);
      if(this.background) this.background(g,env);
      for(const z of this.zones) z.draw(g,env);
      for(const rd of this.roads) rd.draw(g,env);
      if(this.title){ Draw.text(g,this.title,22,33,{c:this.theme.white,size:19,w:'600'});
        if(this.subtitle) Draw.text(g,this.subtitle,22,49,{c:this.theme.muted,size:10.5}); }
      for(const c of this.connectors) c.draw(g,env);
      for(const c of this.components) c.draw(g,env);
      this.flow.draw(g,env);
      for(const n of this.annotations) n.draw(g,env);              // callouts + legend float on top
      if(this.legend && this.legend.length) this._drawLegend(g,env);
      for(const o of this.overlays) o(g,env);
    }
    _drawLegend(g,env){ const items=this.legend; g.save(); g.font='10px ui-monospace,monospace';
      const rowH=17, pad=8, sw=12;
      const w=Math.max(...items.map(e=>g.measureText(e.label).width))+sw+pad*2+8;
      const h=items.length*rowH+pad*2-2, x=this.W-w-14, y=14;
      g.globalAlpha=0.94; g.fillStyle=env.theme.panel2; Draw.roundRect(g,x,y,w,h,6); g.fill(); g.globalAlpha=1;
      g.strokeStyle=env.theme.line; g.lineWidth=1; Draw.roundRect(g,x,y,w,h,6); g.stroke();
      items.forEach((e,i)=>{ const ry=y+pad+i*rowH;
        g.fillStyle=e.color; Draw.roundRect(g,x+pad,ry+1,sw,sw,3); g.fill();
        Draw.text(g,e.label,x+pad+sw+8,ry+sw-2,{c:env.theme.text,size:10}); });
      g.restore(); }
  }

  // ─────────────────────────────────────────────────────────── StateStore (declarative behaviour)
  // A tiny named state store for the .flow behaviour verbs — pure data, no canvas and no components,
  // so a Tier-1 diagram can model counters / latest-value cells / ring depths / dirty flags without
  // any host JS. The behaviour layer mutates it through apply({verb,...}); expressions read a flat
  // snapshot through env(). Verb → bucket:
  //   count → counters    set → values    write/dirty/clean → cells{value,dirty}    push/drain → rings
  // `write` is latest-wins: overwriting an un-cleaned (still-dirty) cell counts as a supersede,
  // which `superseded` tallies — the latest-value-wins pattern, expressed as data.
  class StateStore {
    constructor(){ this.reset(); }
    reset(){ this.counters={}; this.values={}; this.cells={}; this.rings={}; this.superseded=0; return this; }
    count(name, by){ this.counters[name]=(this.counters[name]||0)+(by==null?1:by); return this.counters[name]; }
    set(name, value){ this.values[name]=value; return value; }
    _cell(name){ return this.cells[name]||(this.cells[name]={value:null,dirty:false}); }
    write(name, value){ const c=this._cell(name); if(c.dirty) this.superseded++;   // overwrote an un-drained value
      c.value=value; c.dirty=true; return c; }
    dirty(name){ this._cell(name).dirty=true; return true; }
    clean(name){ this._cell(name).dirty=false; return false; }
    isDirty(name){ return !!(this.cells[name] && this.cells[name].dirty); }
    push(name, n){ this.rings[name]=(this.rings[name]||0)+(n==null?1:n); return this.rings[name]; }
    drain(name){ const d=this.rings[name]||0; this.rings[name]=0; return d; }
    // A flat read view for expression evaluation (cell values, ring depths, set values, counters).
    env(){ const e={}; for(const k in this.cells) e[k]=this.cells[k].value;
      Object.assign(e, this.rings, this.values, this.counters); return e; }
    // Route a parsed behaviour action to its verb; an unknown verb is a loud error, not a no-op.
    apply(a){ switch(a.verb){
      case 'count': return this.count(a.name, a.by);
      case 'set':   return this.set(a.name, a.value);
      case 'write': return this.write(a.name, a.value);
      case 'push':  return this.push(a.name, a.n);
      case 'drain': return this.drain(a.name);
      case 'dirty': return this.dirty(a.name);
      case 'clean': return this.clean(a.name);
      default: throw new Error('flowdot: unknown state verb "'+a.verb+'"');
    } }
  }

  const API = { Theme, Themes, registerTheme, resolveTheme, resolveColor, themeKindColor, NAMED_COLORS, Rng, Tween, Draw, Component, Box, Core, Slot, Readout, RingBuffer, Matrix, Pipeline, Zone, Channel, Connector, Note, Divider, Ghost, FlowSystem, FlowRuntime, StateStore, Diagram };
  if (typeof module!=='undefined' && module.exports) module.exports = API;
  /* node:coverage disable */                         // browser UMD tail (window.Flowdot) — unreachable under node
  else global.Flowdot = API;
  /* node:coverage enable */
})(typeof window!=='undefined' ? window : globalThis);


/* ─────────── src/scene.js ─────────── */
/*
 * scene.js — a builder that turns a declarative scene (the IR) into Flowdot components.
 *
 * This is step 1+2 of the language plan (see DIAGRAM-LANGUAGE-DESIGN.md): the IR is a plain
 * JSON-shaped object; the surface DSL, once it exists, will simply parse to this shape. The
 * builder is deliberately dumb — it instantiates components by `kind` and passes the spec
 * straight through — so the IR schema *is* the component spec, and the framework stays the one
 * source of rendering truth.
 *
 * IR shape (v0):
 *   {
 *     width, height, theme?,                       // -> DK.Diagram options (structure only)
 *     zones: [ { id, ...ZoneSpec } ],              // -> DK.Zone
 *     nodes: [ { id, kind, ...spec } ],            // -> registered kind factory
 *     edges: [ { id?, kind?:'road', from, to, ...} ]  // 'road' -> DK.Channel, else Connector
 *   }
 * A port ref in from/to is [nodeId, portName] | [x,y] | ()=>[x,y]. String node ids are resolved
 * to the built component; numeric [x,y] and functions pass through unchanged.
 *
 * The builder writes into any diagram-like target (real DK.Diagram in the browser, or a fake
 * recorder in tests) exposing add/addZone/addRoad/connector — so it is unit-testable in node
 * without a canvas.
 *
 * UMD: attaches to `window.SceneBuilder` in the browser and `module.exports` under node.
 */
(function (global) {
  "use strict";
  const isNode = typeof module !== 'undefined' && module.exports;
  const DK = isNode ? require('./flowdot.js') : global.Flowdot;
  // NB: flow.js is loaded AFTER scene.js (bundle + <script> order), so global.Flow is not defined at
  // module-load time in the browser. Resolve it lazily (at buildFlows call time) rather than here.
  const getFlow = () => isNode ? require('./flow.js') : global.Flow;

  // kind → factory(id, spec) → Component. Custom components register themselves so a diagram's
  // bespoke kinds are still driven from the IR.
  const KINDS = {
    box:      (id, s) => new DK.Box(id, s),
    core:     (id, s) => new DK.Core(id, s),
    slot:     (id, s) => new DK.Slot(id, s),
    readout:  (id, s) => new DK.Readout(id, s),
    ring:     (id, s) => new DK.RingBuffer(id, s),
    matrix:   (id, s) => new DK.Matrix(id, s),
    pipeline: (id, s) => new DK.Pipeline(id, s),
    zone:     (id, s) => new DK.Zone(id, s),
  };
  function register(kind, factory) { KINDS[kind] = factory; return API; }

  // Resolve a port ref: [nodeId,'port'] where nodeId is a known component → [component,'port'].
  // Everything else ([x,y], ()=>[x,y], or an already-resolved [component,'port']) passes through.
  function resolver(byId) {
    return ref => (Array.isArray(ref) && typeof ref[0] === 'string' && byId[ref[0]])
      ? [byId[ref[0]], ref[1]] : ref;
  }

  // Per-kind default dimensions (PlantUML-style): a node renders without the author giving a size.
  // These are the fallback w/h for each built-in kind; an explicit `w:`/`h:` (and lane-fill, below)
  // always overrides. `matrix` self-sizes from rows×cols and `zone` is always given an explicit band,
  // so neither carries a default here. Exposed as API.dimDefaults so docs/tests read one source.
  const DIM_DEFAULTS = {
    box:      { w: 140, h: 56 },
    core:     { w: 160, h: 60 },
    slot:     { w: 120, h: 56 },
    readout:  { w: 120, h: 60 },
    pipeline: { w: 150, h: 72 },
    // ring gives only a default height (for rail-centering); its width is label-aware and computed by
    // RingBuffer itself, so a ring's box reserves its full drawn extent (circle + side label).
    ring:     { h: 48 },
  };

  // Auto-layout defaults (GraphViz-lite): the outer margin around the track grid and the gap between
  // adjacent lanes. Everything here only FILLS coordinates the author left blank — an explicit x/w on
  // a lane, y on a rail, or x/y on a node always wins, so mixed (some placed, some auto) diagrams and
  // every existing .flow file are unaffected.
  const LAYOUT_PAD = 24, LAYOUT_GAP = 24;
  // Default slot size used when no `diagram WxH` is declared but lanes/rails exist.
  const AUTO_SLOT_W = 200, AUTO_BAND_H = 120;

  // Fill in any lane x/w and rail y that the author omitted, by evenly distributing tracks across the
  // diagram's width/height. `lane l` / `lane r` become two columns splitting the width; `rail row`
  // becomes a single centred row. Returns fresh lane/rail arrays (pure — never mutates the IR).
  // Also returns effective W/H: when ir.width/ir.height is null but tracks exist, W/H are derived from
  // the track count so nodes distribute correctly even without an explicit `diagram WxH` statement.
  function autofillTracks(ir) {
    const lanes = (ir.lanes || []).map(l => Object.assign({}, l));
    const rails = (ir.rails || []).map(r => Object.assign({}, r));
    const W = ir.width != null ? ir.width
            : lanes.length ? 2*LAYOUT_PAD + lanes.length*AUTO_SLOT_W + (lanes.length-1)*LAYOUT_GAP : null;
    const H = ir.height != null ? ir.height
            : rails.length ? 2*LAYOUT_PAD + rails.length*AUTO_BAND_H : null;
    if (lanes.length && W != null) {                            // columns: split width into N slots
      const slot = (W - 2 * LAYOUT_PAD - (lanes.length - 1) * LAYOUT_GAP) / lanes.length;
      lanes.forEach((L, i) => {
        if (L.w == null) L.w = slot;
        if (L.x == null) L.x = LAYOUT_PAD + i * (slot + LAYOUT_GAP);
      });
    }
    if (rails.length && H != null) {                            // rows: centre each in an even band
      const band = (H - 2 * LAYOUT_PAD) / rails.length;
      rails.forEach((R, i) => { if (R.y == null) R.y = LAYOUT_PAD + (i + 0.5) * band; });
    }
    return { lanes, rails, W, H };
  }

  // Resolve relative placement into concrete x/y/w and fill in default dimensions. A node may carry
  // `lane` (a column: {id,x,w}) and/or `rail` (a row: {id,y}); it is filled to / centred in the lane
  // and centred on the rail, unless it gives an explicit x/y/w (which always wins). Lanes/rails that
  // omit coordinates are auto-distributed first (autofillTracks). A node that sits in a lane with no
  // rail is auto-stacked: several such nodes in one lane spread evenly down it so they never overlap;
  // a lone one centres vertically. The transpose holds for a node on a rail with no lane: such nodes
  // spread evenly ACROSS the rail (a lone one centres horizontally). Any width/height still unset
  // falls back to the kind default (DIM_DEFAULTS) so sizes are optional. `align` ∈ left|center|right,
  // `inset` is the lane margin. Pure — returns a new nodes array.
  function indexById(arr) { const m = {}; (arr || []).forEach(e => { m[e.id] = e; }); return m; }
  // The tail of a self-documenting "unknown lane/rail" message: list the declared ids (or say there are
  // none) plus the fix, so the author (or an editor) sees the valid options without opening the docs.
  function trackOpts(kind, badId, map) {
    const ids = Object.keys(map);
    return (ids.length ? 'declared ' + kind + 's: ' + ids.join(', ') + ' (use one of those, or add `'
      : 'no ' + kind + 's declared (add `') + kind + ' ' + badId + '`)';
  }
  function resolveLayout(ir) {
    const tracks = autofillTracks(ir);
    const lanes = indexById(tracks.lanes), rails = indexById(tracks.rails);
    const H = tracks.H, W = tracks.W;
    // Group the nodes that auto-place: stacks = down a lane (no rail, no y); spreads = across a rail
    // (no lane, no x). The two are transposes of each other; declaration order fixes the position.
    const stacks = {}, spreads = {};
    (ir.nodes || []).forEach(n => {
      if (n.lane != null && n.rail == null && n.y == null)
        (stacks[n.lane] || (stacks[n.lane] = [])).push(n.id);
      if (n.rail != null && n.lane == null && n.x == null)
        (spreads[n.rail] || (spreads[n.rail] = [])).push(n.id);
    });
    return (ir.nodes || []).map(n => {
      const d = DIM_DEFAULTS[n.kind];
      const o = Object.assign({}, n);
      if (n.lane != null) {
        const L = lanes[n.lane];
        if (!L) throw new Error('scene: node "' + n.id + '" references unknown lane "' + n.lane + '" — ' + trackOpts('lane', n.lane, lanes));
        const inset = n.inset != null ? n.inset : 12;
        // Only fill from a track coordinate that actually resolved — a lane with no x/w in a diagram
        // with no width can't be auto-distributed, so leave the node's coord unset (kind default / no
        // NaN) rather than computing from undefined.
        if (o.w == null && L.w != null) o.w = L.w - 2 * inset;  // lane-fill wins over the kind default
        if (o.x == null && L.x != null) {
          const align = n.align || 'center', w = o.w != null ? o.w : 0;
          o.x = (align === 'left' || L.w == null) ? L.x + inset  // left (or no lane width to centre in)
            : align === 'right' ? L.x + L.w - w - inset
              : L.x + (L.w - w) / 2;                           // center
        }
      }
      if (n.rail != null) {
        const R = rails[n.rail];
        if (!R) throw new Error('scene: node "' + n.id + '" references unknown rail "' + n.rail + '" — ' + trackOpts('rail', n.rail, rails));
        const h = o.h != null ? o.h : (d && d.h != null ? d.h : 0);  // rail-centre on effective height
        if (o.y == null && R.y != null) o.y = R.y - h / 2;
        if (o.x == null && n.lane == null && W != null) {       // transpose: auto-spread across the rail
          const g = spreads[n.rail], band = (W - 2 * LAYOUT_PAD) / g.length;
          const w = o.w != null ? o.w : (d && d.w != null ? d.w : 0);
          o.x = LAYOUT_PAD + (g.indexOf(n.id) + 0.5) * band - w / 2;
        }
      } else if (o.y == null && n.lane != null && H != null) {  // auto-stack down the lane (no rail)
        const g = stacks[n.lane], band = (H - 2 * LAYOUT_PAD) / g.length;
        const h = o.h != null ? o.h : (d && d.h != null ? d.h : 0);
        o.y = LAYOUT_PAD + (g.indexOf(n.id) + 0.5) * band - h / 2;
      }
      if (d) {                                                  // fill any dimension the kind defaults
        if (o.w == null && d.w != null) o.w = d.w;
        if (o.h == null && d.h != null) o.h = d.h;
      }
      return o;
    });
  }

  // A zone can INFER its box from the tracks it groups instead of hard-coding x/y/w/h: name the lane(s)
  // it spans (`lane:fe` or `lanes:[fe, be]`) and it takes their horizontal extent; name rail(s)
  // (`rail:`/`rails:`) and it takes their vertical span, else it defaults to a full-height content band
  // (below the title, padded from the bottom). Explicit x/y/w/h still win PER FIELD. Pure.
  const ZONE_TOP = 56;                                            // content top: clears the title/subtitle
  function resolveZones(ir) {
    const tracks = autofillTracks(ir);
    const lanes = indexById(tracks.lanes), rails = indexById(tracks.rails), H = tracks.H;
    const list = (v) => v == null ? null : (Array.isArray(v) ? v : [v]);
    return (ir.zones || []).map(z => {
      const o = Object.assign({}, z);
      const laneIds = list(z.lanes != null ? z.lanes : z.lane);
      const railIds = list(z.rails != null ? z.rails : z.rail);
      if (laneIds) {
        const Ls = laneIds.map(id => { const L = lanes[id];
          if (!L) throw new Error('scene: zone "' + z.id + '" references unknown lane "' + id + '" — ' + trackOpts('lane', id, lanes));
          return L; });
        const placed = Ls.filter(L => L.x != null);
        if (placed.length) {
          const left = Math.min.apply(null, placed.map(L => L.x));
          const right = Math.max.apply(null, placed.map(L => L.x + (L.w != null ? L.w : 0)));
          if (o.x == null) o.x = left;
          if (o.w == null) o.w = right - left;
        }
      }
      if (railIds) {
        const Rs = railIds.map(id => { const R = rails[id];
          if (!R) throw new Error('scene: zone "' + z.id + '" references unknown rail "' + id + '" — ' + trackOpts('rail', id, rails));
          return R; });
        const ys = Rs.filter(R => R.y != null).map(R => R.y);
        if (ys.length) {                                          // span the named rails, padded half a band
          const top = Math.min.apply(null, ys), bot = Math.max.apply(null, ys), V = 40;
          if (o.y == null) o.y = top - V;
          if (o.h == null) o.h = (bot - top) + 2 * V;
        }
      } else if (laneIds && H != null) {                          // lane band, no rails → full content height
        if (o.y == null) o.y = ZONE_TOP;
        if (o.h == null) o.h = H - ZONE_TOP - LAYOUT_PAD;
      }
      return o;
    });
  }

  // A headless, diagram-like build target: records what build()/buildFlows() add (components, zones,
  // roads, connectors + a real FlowSystem) without a canvas. The one recorder every non-canvas caller
  // needs (the CLI, the harness, the golden guard, dry-validation, tests) — build() defaults to it.
  function recorder() {
    return {
      components: [], zones: [], roads: [], connectors: [], annotations: [], legend: null, flow: new DK.FlowSystem(), now: 0,
      overlays: [], W: 0, H: 0, ghostOn: false,
      setGhost(b) { this.ghostOn = !!b; return this; },                  // F16: toggle the counterfactual layer
      add(c) { this.components.push(c); return c; },
      addZone(z) { this.zones.push(z); return z; },
      addRoad(r) { this.roads.push(r); return r; },
      connector(from, to, opts) { const c = new DK.Connector(from, to, opts); this.connectors.push(c); return c; },
      note(ref, text) { const n = { ref, text }; this.annotations.push(n); return n; },
      divider(spec) { const d = new DK.Divider(spec); this.annotations.push(d); return d; },   // F12: free labelled line
      overlay(fn) { this.overlays.push(fn); return this; },              // narration (F10) draws here; captured for tests
    };
  }

  // Auto-declare tracks: a node (or a zone) may reference a `lane:`/`rail:` that was never declared with
  // a `lane`/`rail` line — create it on the fly, ordered by FIRST APPEARANCE among the nodes (then zones).
  // Explicitly declared tracks keep their declared order + coordinates (they stay first); referenced-only
  // ids are appended. So a fully implicit diagram gets first-appearance order, and an author writes a
  // `lane`/`rail` line only to override the order or attach x/w/y — mirroring "coordinates are optional".
  // Mutates ir.lanes/ir.rails in place (idempotent — a re-build creates nothing new) and returns warnings.
  function autoDeclareTracks(ir) {
    const warnings = [];
    ['lane', 'rail'].forEach(kind => {
      const listKey = kind + 's';                                       // 'lanes' | 'rails'
      const seen = new Set((ir[listKey] || []).map(t => t.id));
      const created = [];
      const note = id => { if (id != null && !seen.has(id)) { seen.add(id); created.push(id); } };
      (ir.nodes || []).forEach(n => note(n[kind]));                     // nodes first (declaration order)
      (ir.zones || []).forEach(z => [].concat(                          // then any zone that spans a track
        z[kind] != null ? z[kind] : [], z[listKey] != null ? z[listKey] : []).forEach(note));
      if (!created.length) return;
      ir[listKey] = (ir[listKey] || []).concat(created.map(id => ({ id })));
      // Columns (lanes) track left→right declaration order reliably; ROWS inferred from node-declaration
      // order can mis-place (an author may declare nodes in flow order, not top→bottom). So only rails
      // warn, and only when 2+ are inferred (order matters). Informational — not fatal.
      if (kind === 'rail' && created.length >= 2)
        warnings.push('scene: inferred rail (row) order top→bottom = [' + created.join(', ') +
          '] from first use; add explicit `rail <id>` lines to control it if that order is wrong.');
    });
    return warnings;
  }

  // Build IR into a diagram-like target (a Diagram, or the default headless recorder()).
  // Returns { diagram, byId, edgesById }. Edges carrying an `id` are indexed in edgesById.
  // Resolve every colour attribute on a spec against the ACTIVE theme (Flowdot.resolveColor): a `#token`
  // or `#role` maps per theme, `#hex`/`#css-name` stay literal. Mutates + returns the spec; resolveColor
  // is idempotent (a resolved #hex re-resolves to itself), so a re-build (theme toggle) is safe — and
  // because the toggle re-mounts, build-time resolution is enough to flip dark↔light.
  const COLOR_ATTRS = ['accent', 'color', 'tint', 'pulseColor', 'c', 'fill', 'stroke', 'glow'];
  function resolveColors(spec, theme) {
    if (!spec) return spec;
    for (const k of COLOR_ATTRS) if (typeof spec[k] === 'string') spec[k] = DK.resolveColor(spec[k], theme);
    if (Array.isArray(spec.colColors)) spec.colColors = spec.colColors.map(c => DK.resolveColor(c, theme));
    return spec;
  }

  function build(ir, target) {
    if (!ir) throw new Error('scene.build: missing IR');
    const diagram = target || recorder();
    const theme = (diagram && diagram.theme) || DK.Theme;               // resolve #tokens against it
    if (ir.kindColors && diagram) diagram.kindColors = ir.kindColors;   // per-kind override (raw #tokens; themeKindColor resolves per active theme)
    const byId = {}, edgesById = {};
    const warnings = autoDeclareTracks(ir);                             // create referenced-but-undeclared lanes/rails
    if (warnings.length) ir.warnings = (ir.warnings || []).concat(warnings);

    resolveZones(ir).forEach(z => diagram.addZone(new DK.Zone(z.id, resolveColors(z, theme))));

    resolveLayout(ir).forEach(n => {
      const factory = KINDS[n.kind];
      if (!factory) throw new Error('scene.build: unknown kind "' + n.kind + '" for node "' + n.id + '"');
      const c = factory(n.id, resolveColors(n, theme));
      if (byId[n.id]) throw new Error('scene.build: duplicate node id "' + n.id + '"');
      byId[n.id] = c;
      diagram.add(c);
    });

    const resolve = resolver(byId);
    (ir.edges || []).forEach(e => {
      const from = resolve(e.from), to = resolve(e.to);
      const handle = (e.kind === 'road')
        ? diagram.addRoad(new DK.Channel(e.id, resolveColors(Object.assign({}, e, { from, to }), theme)))
        : diagram.connector(from, to, resolveColors(e.style || {}, theme));
      if (e.id) edgesById[e.id] = handle;
    });

    (ir.notes || []).forEach(n => {                                     // callouts point at a built node
      const c = byId[n.target];
      if (!c) throw new Error('scene.build: note references unknown node "' + n.target + '"');
      diagram.note(c, n.text);
    });
    (ir.dividers || []).forEach(d => diagram.divider(resolveColors(Object.assign({}, d), theme)));  // F12: free labelled line
    if (ir.ghosts && ir.ghosts.length && diagram.overlay) {             // F16: a toggleable counterfactual layer, hidden by default
      const ghosts = ir.ghosts.map(gh => new DK.Ghost(resolveColors(Object.assign({}, gh), theme)));
      diagram.overlay((g, env) => { if (env.diagram && env.diagram.ghostOn) for (const gh of ghosts) gh.draw(g, env); });
    }
    if (ir.legend && ir.legend.length)                                  // resolve each swatch #token per theme
      diagram.legend = ir.legend.map(e => ({ label: e.label, color: DK.resolveColor(e.color, theme) }));

    return { diagram, byId, edgesById };
  }

  // Compile ir.flows (from the .flow `flow` statement) into a FlowRuntime: each flow spawns a packet
  // that travels its route at its rate, auto-pulsing a node on arrival when the node supports it.
  // A flow may end in a `fork` (from `|`/`&`): mode 'pick' chooses one weighted option, mode 'all'
  // fans a packet out to every option, both off the last route node.
  // ctx: { byId, diagram, rng? } where diagram exposes `.flow` (a FlowSystem) and `.now`; rng is an
  // optional ()=>[0,1) used for weighted picks (defaults to Math.random).
  // Auto-derive faint connectors (opt-in via `auto-edges`): every flow route hop — including `|` pick
  // and `&` fan-out branches (off the last route node) — gets a faint static Connector when no explicit
  // `edge`/`road` already joins that node pair. It is the "road" the moving dots ride, so the author
  // drops the duplicated `edge a -> b` lines. Templated hops (`worker{f}`, resolved per-fire) are skipped
  // — they have no single node at build time. An explicit edge wins (its style stays); deduped across flows.
  function deriveEdges(ir, ctx) {
    if (!ir.autoEdges || !ir.flows) return;
    const plain = id => id != null && String(id).indexOf('{') < 0;      // skip runtime-templated ids
    const seen = new Set();
    (ir.edges || []).forEach(e => {                                     // explicit edges/roads win → pre-seed
      if (e.from && e.to && typeof e.from[0] === 'string' && typeof e.to[0] === 'string')
        seen.add(e.from[0] + ' ' + e.to[0]);
    });
    const link = (from, to) => {
      if (!plain(from.node) || !plain(to.node)) return;
      const key = from.node + ' ' + to.node;
      if (seen.has(key)) return;
      seen.add(key);
      const a = ctx.byId[from.node], b = ctx.byId[to.node];
      if (!a || !b) return;                                             // unknown node → leave it to flow build
      ctx.diagram.connector([a, from.port || 'out'], [b, to.port || 'in'], { alpha: 0.2 });
    };
    (ir.flows || []).forEach(f => {
      const r = f.route || [];
      for (let i = 0; i + 1 < r.length; i++) link(r[i], r[i + 1]);      // linear hops
      if (f.fork && r.length) { const last = r[r.length - 1];          // branch: last route node → each option
        (f.fork.options || []).forEach(o => link(last, o)); }
    });
  }

  function buildFlows(ir, ctx) {
    // Safe mode (ctx.safe) — defence in depth for an IR handed in directly (bypassing the parser's
    // gate): the Tier-2 host escapes are refused before any flow is wired.
    if (ctx.safe) {
      const hasCall = as => (as || []).some(a => a.verb === 'call');
      const flowCall = f => (f.route || []).some(r => hasCall(r.actions)) ||
        ((f.fork && f.fork.options) || []).some(o => hasCall(o.actions));
      if (ir.model) throw new Error("scene: 'model' is disabled in safe mode");
      if ((ir.flows || []).some(flowCall) || (ir.events || []).some(e => hasCall(e.actions)) ||
          (ir.periodics || []).some(p => hasCall(p.actions)))
        throw new Error("scene: 'call' is disabled in safe mode");
    }
    deriveEdges(ir, ctx);                                               // opt-in faint connectors under the dots
    const rt = new DK.FlowRuntime();
    const rand = ctx.rng || Math.random;
    (ir.modes || []).forEach(m => rt.defineMode(m.name, m.effects));   // toggleable; rate effects speed sources
    // One state store per diagram: hop `{ actions }` mutate it; expressions read it via env(). Exposed
    // on the runtime (rt.store) so later phases (on/every) and callers/tests can inspect it.
    const store = rt.store = new DK.StateStore();
    // F8: a `readout` node renders a LIVE store value. The store isn't in the draw env, so bind a getter
    // here. Watch a flat store key (counter/value/ring depth via env(), or `superseded`), or a dotted
    // `comp.prop` (e.g. a ring's `overruns`) read straight off the bound component.
    const readLive = key => { const s = String(key), dot = s.indexOf('.');
      if (dot >= 0) { const comp = ctx.byId[s.slice(0, dot)]; return comp ? comp[s.slice(dot + 1)] : 0; }
      if (s === 'superseded') return store.superseded;
      const e = store.env(); return (s in e) ? e[s] : 0; };
    Object.keys(ctx.byId).forEach(id => { const c = ctx.byId[id];
      if (c instanceof DK.Readout) c.get = () => readLive(c.watch); });
    const Flow = getFlow();                                            // resolve now (all scripts loaded)
    // rand()/mode()/dirty()/now() built-ins for exprs. dirty(name) reads the store's per-cell dirty flag
    // (set by `write`/`dirty`, cleared by `clean`/`drain`) so `every … when dirty(slot)` works. now()
    // is the runtime clock in seconds (F17) — time-as-a-value, so `set last = now()` + a periodic guard
    // `when now() - last >= W` expresses a window-boundary / silence watchdog with no host timer.
    const built = { rand, mode: name => rt.modeActive(name), dirty: name => store.isDirty(name), now: () => rt.now };
    // Tier-2 host escape: `model "<path>"` (node require) or `model <GlobalName>` (browser global);
    // ctx.model overrides. Resolved lazily on first `call`, then cached (a diagram may name a model
    // it never calls). NB: not yet gated by a safe mode — that's a later task.
    let _model, _modelDone = false;
    const getModel = () => {
      if (_modelDone) return _model;
      _modelDone = true; _model = ctx.model || null;
      if (!_model && ir.model) _model = isNode
        ? require(require('path').resolve(ir.model))
        : (typeof window !== 'undefined' ? window : global)[ir.model];
      return _model;
    };
    // env for an action expr = store state + built-ins + this fire's pick bindings (penv). A bound
    // RingBuffer's LIVE fill overrides the store value (which zeroes on drain), so a guard like
    // `drop if queue >= cap` / `when queue > 0` reads the true on-canvas queue depth.
    const envOf = penv => {
      const e = Object.assign({}, store.env(), built, penv || {});
      for (const id in ctx.byId) { const c = ctx.byId[id]; if (c instanceof DK.RingBuffer) e[id] = c.fill; }
      return e;
    };
    // A node/port ref may be a template (`worker{f}`, `grid.cell:{i}`) resolved against this fire's
    // pick bindings; plain refs pass through untouched.
    const tpl = (s, penv) => (s != null && String(s).indexOf('{') >= 0) ? Flow.interpolate(String(s), penv) : s;
    const isTpl = s => String(s).indexOf('{') >= 0;
    const nodeOf = (fl, id) => {
      const c = ctx.byId[id];
      if (!c) throw new Error('scene: flow "' + fl.id + '" references unknown node "' + id + '"');
      return c;
    };
    // Store→component binding: when a verb's target names a built-in ring/matrix, drive that component
    // too, so declarative state shows ON-CANVAS (the store stays the read model for expressions). Targets:
    //   push/drain <ringId>              → RingBuffer.push()/drain() (queue depth / doorbell)
    //   write/dirty/clean <matrixId.i.j> → that Matrix cell's value + freshness (latest-value, staleness)
    // An unbound name (no matching component) touches only the store — unchanged behaviour.
    const driveComponent = (verb, name, value) => {
      if (name == null) return;
      const s = String(name), dot = s.indexOf('.');
      const c = ctx.byId[dot >= 0 ? s.slice(0, dot) : s];
      if (!c) return;
      if (c instanceof DK.RingBuffer) {
        if (verb === 'push') c.push();
        else if (verb === 'drain') c.drain();                          // one item off the queue per drain
      } else if (c instanceof DK.Matrix && dot >= 0) {
        const seg = s.slice(dot + 1).split('.'), i = +seg[0], j = +seg[1];
        if (!(i >= 0 && j >= 0 && i < c.rows && j < c.cols)) return;   // out-of-range cell → ignore (store still set)
        if (verb === 'write') c.write(i, j, { value: value, fresh: 1 });
        else if (verb === 'dirty') c.write(i, j, { fresh: 1 });
        else if (verb === 'clean') { const cell = c.cell(i, j); if (cell) cell.fresh = 0; }
      } else if (c instanceof DK.Slot && dot < 0) {                    // F4: a single last-value slot, keyed by its own id
        if (verb === 'write') c.set(value, ctx.diagram.now);           // produce a value (overwrite-while-dirty → supersede flash)
        else if (verb === 'dirty') c.mark(ctx.diagram.now);
        else if (verb === 'clean') c.read();                           // subscriber read it
      }
    };
    // Component-method verbs (F5): call a real method on the bound component (no store side-effect).
    //   highlight <matrixId>.row:i   → Matrix.highlightRow(i)   (the shard reading a whole row)
    //   down/up   <matrixId>.col:j   → Matrix.setDown(j, …)      (a feed going DOWN / back UP)
    //   surge     <ringId> [= n]     → RingBuffer.surge(n)       (a lane lapping under load; default 3)
    const driveMethod = (verb, name, amount) => {
      if (name == null) return;
      const s = String(name), dot = s.indexOf('.');
      const c = ctx.byId[dot >= 0 ? s.slice(0, dot) : s];
      if (!c) return;
      if (verb === 'surge') { if (c instanceof DK.RingBuffer) c.surge(amount != null ? amount : 3); return; }
      if (verb === 'snapshot') {                                       // F18: bulk read — whole grid (no dot) or one row (`.row:i`)
        if (c instanceof DK.Matrix) {
          if (dot < 0) c.snapshot(null, ctx.diagram.now);
          else { const seg = s.slice(dot + 1).split(':'); if (seg[0] === 'row') { const i = +seg[1]; if (i >= 0 && i < c.rows) c.snapshot(i, ctx.diagram.now); } }
        }
        return;
      }
      if (!(c instanceof DK.Matrix) || dot < 0) return;
      const seg = s.slice(dot + 1).split(':'), kind = seg[0], idx = +seg[1];   // 'row:i' | 'col:j'
      if (!(idx >= 0)) return;
      if (verb === 'highlight' && kind === 'row' && idx < c.rows) c.highlightRow(idx, ctx.diagram.now);
      else if ((verb === 'down' || verb === 'up') && kind === 'col' && idx < c.cols) c.setDown(idx, verb === 'down');
    };
    // F14: a mode can drive STATE (not just rate). On toggle, apply a mode's state effects on enter and
    // revert them on exit — reusing the F5 method verbs (down⇄up, surge⇄negate) + a matrix decay multiplier.
    const applyModeEffect = (e, on) => {
      if (e.op === 'method') {
        if (e.verb === 'surge') { const c = ctx.byId[e.target]; const amt = e.amount != null ? e.amount : 3;
          if (c && c.surge) c.surge(on ? amt : -amt); return; }             // enter floods; exit drains the same
        driveMethod(on ? e.verb : (e.verb === 'down' ? 'up' : 'down'), e.target);   // down⇄up on enter/exit
      } else if (e.op === 'decayMul') { const c = ctx.byId[e.target];
        if (c && c.decayRate) c.decayRate = on ? c.decayRate * e.factor : c.decayRate / e.factor; }
    };
    const modeState = {};                                                  // name → its state effects (method/decayMul)
    (ir.modes || []).forEach(m => { const st = (m.effects || []).filter(e => e.op === 'method' || e.op === 'decayMul');
      if (st.length) modeState[m.name] = st; });
    if (Object.keys(modeState).length)
      rt.onModeChange((name, on) => { const st = modeState[name]; if (st) for (const e of st) applyModeEffect(e, on); });
    // Execute an action list. leg/style are the owning flow's (or handler's) builders — passed so a
    // `spawn` rebuilds legs in the right context. `p` (optional) is the current packet, for `drop`.
    const runActions = (actions, penv, leg, style, p) => { if (!actions) return;
      for (const a of actions) {
        if (a.verb === 'drop') {                                       // conditional terminate: stop this list
          if (Flow.evalExpr(a.cond, envOf(penv))) { if (p) p.done = true; return; }
          continue;
        }
        if (a.verb === 'spawn') {                                       // secondary packet along an inline route
          const legs = []; for (let i = 1; i < a.route.length; i++) legs.push(leg(a.route[i - 1], a.route[i], penv));
          if (legs.length) {
            const st = style();                                         // F7: a `#colour` on the spawn overrides the packet colour (else the flow's)
            if (a.color) st.style = Object.assign({}, st.style, { color: DK.resolveColor(a.color, flowTheme) || st.style.color });
            ctx.diagram.flow.spawn(legs, st);
          }
        } else if (a.verb === 'after') {                               // schedule a named event at t+D
          rt.after(a.delay, () => rt.emit(a.event, penv));
        } else if (a.verb === 'call') {                                // Tier-2 host escape into the model
          const model = getModel();
          if (!model) throw new Error('scene: `call ' + a.fn + '` needs a model — add `model "…"` (or pass ctx.model)');
          const fn = model[a.fn];
          if (typeof fn !== 'function') throw new Error('scene: model has no function "' + a.fn + '"');
          const ret = fn.apply(model, a.args.map(x => Flow.evalExpr(x, envOf(penv))));
          if (a.assign != null) store.set(a.assign, ret);
        } else if (a.verb === 'highlight' || a.verb === 'down' || a.verb === 'up' || a.verb === 'surge' || a.verb === 'snapshot') {
          driveMethod(a.verb, tpl(a.name, penv), a.expr != null ? Flow.evalExpr(a.expr, envOf(penv)) : undefined);  // F5/F18: call the component method
        } else {                                                       // count/set/write/push/drain/dirty/clean
          const name = tpl(a.name, penv);                               // F6: interpolate `{i}` in the target against per-fire picks (write grid.{i}.0)
          const value = a.expr != null ? Flow.evalExpr(a.expr, envOf(penv)) : undefined;
          store.apply(a.expr != null ? { verb: a.verb, name, value } : Object.assign({}, a, { name }));
          driveComponent(a.verb, name, value);                          // reflect on the bound ring/matrix, if any
        }
      }
    };
    // Fan-in / join barriers: `join <node> : <inputA> <inputB> …`. A barrier node fires (pulses + runs
    // its arrival actions) only after every named input has arrived; each arrival is deduped by input id,
    // and the barrier resets once complete so a later round waits again. A packet arriving at a barrier
    // from a non-barrier input still travels; it just parks silently until the last input completes the set.
    const joins = {};                                                   // node id → { inputs:Set, arrived:Set }
    (ir.joins || []).forEach(j => {
      if (!ctx.byId[j.node]) throw new Error('scene: join references unknown node "' + j.node + '"');
      j.inputs.forEach(id => { if (!ctx.byId[id]) throw new Error('scene: join "' + j.node + '" references unknown input "' + id + '"'); });
      joins[j.node] = { inputs: new Set(j.inputs), arrived: new Set() };
    });
    // Record an arrival at a barrier from `fromId`; returns true iff this arrival completed the set (then resets).
    const barrierArrive = (b, fromId) => {
      if (b.inputs.has(fromId)) b.arrived.add(fromId);
      if (b.arrived.size < b.inputs.size) return false;
      b.arrived.clear(); return true;
    };
    // leg/style builders. fl supplies the error id + colour/r; usable by a flow OR an `on` handler.
    // fl.color is a `#token`/`#hex` → resolve against the active theme (maps per theme), else theme.hot.
    const flowTheme = (ctx.diagram && ctx.diagram.theme) || DK.Theme;
    const styleFor = fl => () => ({ style: { color: DK.resolveColor(fl.color, flowTheme) || flowTheme.hot, r: fl.r || 3.4 } });
    const legFor = fl => { const style = styleFor(fl);
      const leg = (a, b, penv) => {                             // a→b hop; pulses b + runs its actions on arrival
        const to = nodeOf(fl, tpl(b.node, penv)), toId = tpl(b.node, penv), fromId = tpl(a.node, penv);
        const barrier = joins[toId];                            // is the destination a fan-in barrier?
        return { from: [nodeOf(fl, fromId), tpl(a.port, penv) || 'out'], to: [to, tpl(b.port, penv) || 'in'],
          dur: b.dur || 0.6, onArrive: p => {
            if (barrier && !barrierArrive(barrier, fromId)) return;     // parked: waiting on the other inputs
            if (to.pulse) to.pulse(ctx.diagram.now); runActions(b.actions, penv, leg, style, p);
          } };
      }; return leg; };
    // `on <event>(params): actions` → a runtime event handler (fired by `after … : event` / emit).
    (ir.events || []).forEach(ev => {
      const fl = { id: 'on ' + ev.name }, leg = legFor(fl), style = styleFor(fl);
      rt.onEvent(ev.name, arg => runActions(ev.actions, arg || {}, leg, style, null));
    });
    // `every R per v in L [when C]: actions` → a per-entity periodic. Each list element binds `v`;
    // fires at rate R when the optional guard C holds. Runs its actions with v in the env.
    (ir.periodics || []).forEach(pd => {
      const fl = { id: 'every ' + pd.var }, leg = legFor(fl), style = styleFor(fl);
      const penvFor = item => ({ [pd.var]: item });
      rt.every({
        items: pd.list,
        interval: () => pd.rate,
        when: pd.when == null ? undefined : item => !!Flow.evalExpr(pd.when, envOf(penvFor(item))),
        fire: item => runActions(pd.actions, penvFor(item), leg, style, null),
      });
    });
    (ir.flows || []).forEach(fl => {
      const route = fl.route || [], fork = fl.fork;
      const branchable = fork && fork.options && fork.options.length;
      if (route.length < (branchable ? 1 : 2)) return;           // need a prefix, or ≥2 for a plain route
      route.forEach(r => { if (!isTpl(r.node)) nodeOf(fl, r.node); });   // validate static nodes up front
      if (branchable) fork.options.forEach(o => { if (!isTpl(o.node)) nodeOf(fl, o.node); });  // templates: at fire time
      const style = styleFor(fl);
      const leg = legFor(fl);
      // F15: a `#colour` on a hop or a branch option recolours THAT leg (the packet's fate drives its
      // colour) — set on the leg's own style, which FlowSystem.draw prefers over the packet style. So a
      // demux (`| ~d emitted #gold when q>0 | ~d suppressed #rose when q<0`) shows each outcome's colour,
      // and the option's destination node already flashes on arrival.
      const colorLeg = (bl, hop) => { if (hop && hop.color) { const c = DK.resolveColor(hop.color, flowTheme);
        if (c) bl.style = Object.assign({}, style().style, { color: c }); } return bl; };
      // F3b: a hop `pipe.stages` expands into sub-legs across the target pipeline's stage:0…k ports,
      // so the packet visibly WALKS the stages (decode→canonicalise→offer) instead of the stages
      // blinking decoupled. Stage count lives on the built component (build-time), so expand here:
      // split the hop's dur evenly, and run its arrival actions on the last stage.
      const expandStages = penv => {
        const out = [];
        for (const h of route) {
          if (h.port === 'stages') {
            const comp = nodeOf(fl, tpl(h.node, penv));
            const S = (comp && comp.stages && comp.stages.length) || 1;
            const each = (h.dur || 0.6) / S;
            for (let k = 0; k < S; k++)
              out.push({ node: h.node, port: 'stage:' + k, dur: each, actions: k === S - 1 ? h.actions : undefined });
          } else out.push(h);
        }
        return out;
      };
      const guarded = branchable && fork.options.some(o => o.guard != null);
      const pick = penv => {
        const opts = fork.options;
        if (guarded) {                                          // content-based: first true guard wins
          for (const o of opts) if (o.guard != null && Flow.evalExpr(o.guard, envOf(penv))) return o;
          return opts.find(o => o.guard == null) || opts[opts.length - 1];   // else = first unguarded (or last)
        }
        const total = opts.reduce((s, o) => s + (o.weight || 1), 0);   // weighted choose-one
        let x = rand() * total;
        for (const o of opts) { x -= (o.weight || 1); if (x < 0) return o; }
        return opts[opts.length - 1];
      };
      const bindPick = () => {                                   // per-fire: a random element per pick var
        const penv = {};
        (fl.pick || []).forEach(p => { penv[p.var] = p.list[Math.floor(rand() * p.list.length)]; });
        return penv;
      };
      rt.source({
        interval: () => 1 / (fl.rate || 1),          // rate is packets-per-second → seconds-between = 1/rate

        guard: () => ctx.diagram.flow.size < (fl.max || 200),
        fire: () => {
          const penv = bindPick();
          const eroute = expandStages(penv);                    // F3b: expand any `pipe.stages` hop into per-stage sub-legs
          const src = eroute[0] ? nodeOf(fl, tpl(eroute[0].node, penv)) : null;  // F3a: pulse the SOURCE on departure,
          if (src && src.pulse) src.pulse(ctx.diagram.now);                     // so adapters / source pipelines animate (not just the arrival node)
          if (eroute[0] && eroute[0].actions) runActions(eroute[0].actions, penv, leg, style, null);   // origin: actions at packet birth
          const prefix = [];
          for (let i = 1; i < eroute.length; i++) prefix.push(colorLeg(leg(eroute[i - 1], eroute[i], penv), eroute[i]));
          const from = eroute[eroute.length - 1];               // the branch-from node
          if (!branchable) { if (prefix.length) ctx.diagram.flow.spawn(prefix, style()); return; }
          if (fork.mode === 'pick') {
            const o = pick(penv);
            ctx.diagram.flow.spawn(prefix.concat([colorLeg(leg(from, o, penv), o)]), style());
          } else {                                               // 'all' → fan out at the branch node
            const fan = () => fork.options.forEach(o => ctx.diagram.flow.spawn([colorLeg(leg(from, o, penv), o)], style()));
            if (!prefix.length) { fan(); return; }
            const last = prefix[prefix.length - 1], prev = last.onArrive;   // split once the packet arrives
            last.onArrive = p => { if (prev) prev(p); fan(); };
            ctx.diagram.flow.spawn(prefix, style());
          }
        },
      });
    });
    // F10: a narration timeline — a scripted, looping sequence of (dwell, node(s), caption) steps that
    // spotlights the step's node(s) and shows its caption, driven purely by the runtime clock (no JS,
    // no timers). Rendered as a Diagram overlay so it's deterministic from `now` and self-contained.
    const narr = ir.narration;
    if (narr && narr.steps && narr.steps.length && ctx.diagram && ctx.diagram.overlay) {
      narr.steps.forEach(s => s.nodes.forEach(id => {
        if (!ctx.byId[id]) throw new Error('scene: narrate references unknown node "' + id + '"'); }));
      const steps = narr.steps, total = steps.reduce((a, s) => a + s.dur, 0);
      const stepAt = now => { let t = total > 0 ? now % total : 0, acc = 0;
        for (const s of steps) { if (t < acc + s.dur) return s; acc += s.dur; } return steps[steps.length - 1]; };
      ctx.diagram.overlay((g, env) => {
        const step = stepAt(env.now);
        const pulse = 0.55 + 0.35 * Math.sin(env.now * 4);              // a gentle spotlight breath
        for (const id of step.nodes) { const c = ctx.byId[id]; if (!c) continue;
          const b = c.bounds ? c.bounds() : { x: c.x, y: c.y, w: c.w, h: c.h };
          g.save(); g.strokeStyle = env.theme.accent; g.globalAlpha = pulse; g.lineWidth = 2.6;
          DK.Draw.roundRect(g, b.x - 6, b.y - 6, b.w + 12, b.h + 12, 11); g.stroke(); g.restore(); }
        if (step.caption) { const W = ctx.diagram.W, H = ctx.diagram.H;
          g.save(); g.font = '13px ui-monospace,monospace'; const tw = g.measureText(step.caption).width;
          const bw = tw + 30, bx = (W - bw) / 2, by = H - 46;
          g.globalAlpha = 0.94; g.fillStyle = env.theme.panel2; DK.Draw.roundRect(g, bx, by, bw, 32, 8); g.fill();
          g.globalAlpha = 1; g.strokeStyle = env.theme.line; g.lineWidth = 1; DK.Draw.roundRect(g, bx, by, bw, 32, 8); g.stroke();
          DK.Draw.text(g, step.caption, W / 2, by + 20, { c: env.theme.text, size: 13, align: 'center' }); g.restore(); }
      });
    }
    return rt;
  }

  const API = { build, recorder, register, KINDS, resolveLayout, resolveZones, autoDeclareTracks, deriveEdges, buildFlows, dimDefaults: DIM_DEFAULTS,
    layoutDefaults: { pad: LAYOUT_PAD, gap: LAYOUT_GAP, autoSlotW: AUTO_SLOT_W, autoBandH: AUTO_BAND_H } };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  /* node:coverage disable */                         // browser UMD tail (window.SceneBuilder) — unreachable under node
  else global.SceneBuilder = API;
  /* node:coverage enable */
})(typeof window !== 'undefined' ? window : globalThis);


/* ─────────── src/flow.js ─────────── */
/*
 * flow.js — a tiny parser for the .flow structure language → the SceneBuilder IR.
 *
 * This is step 5 of the language plan (DIAGRAM-LANGUAGE-DESIGN.md): surface syntax as sugar over
 * the proven IR. It is deliberately line-oriented and dependency-free (a hand-written scanner, no
 * grammar tool) so a .flow file still renders from file:// with no build step, matching the rest of
 * book/animation. It parses the STRUCTURE sub-language (topology); the behaviour block and the
 * concise `each …` / `pipe … : a | b` comprehension sugar from §5 are deferred — this is the
 * Mermaid-like half, and it emits exactly the { title, width, height, zones, nodes, edges } shape
 * that SceneBuilder.build() consumes.
 *
 * Grammar (one statement per line; `#` starts a comment; blank lines ignored):
 *   diagram "Title" 1200x600 [theme]
 *   zone  <id> "Label" x:.. y:.. w:.. h:..    # or infer the box: `lane:<id>`/`lanes:[..]` (+ `rail:`/`rails:[..]`)
 *   node  <id> [<kind>] [flag ...] [key:value ...]  # kind defaults to 'box' when omitted or when the next token is a kv/colour
 *   edge  <from> -> <to> [key:value ...]        # a Connector; keys become its style
 *   road  <from> ~> <to> [key:value ...]        # a Channel (fat animated edge)
 * where <from>/<to> is `id`, `id.port`, or `x,y`; an id with no port defaults to .out (from) / .in (to).
 * Colours carry a `#` sigil: `#hex` or a `#name` theme token (resolved against the theme at build; see
 * flowdot.js resolveColor). Values coerce: 12 → number, `#…` → colour token, a|b|c → array, "x" → string,
 * a bare token (no `:`) on node/zone → a boolean flag (e.g. `boxed`, `vertical`, `pinned`).
 *
 * UMD: attaches to `window.Flow` in the browser and `module.exports` under node.
 */
(function (global) {
  "use strict";

  // Format version. The `.flow` spec is semver'd: a MINOR bump is additive / backward-compatible, a
  // MAJOR bump is breaking. A source may declare `flowdot <version>`; this build accepts major SPEC_MAJOR.
  const SPEC_VERSION = '1.0', SPEC_MAJOR = 1;

  // Split a line into whitespace-separated tokens, but keep a "quoted section" or a "[bracket list]"
  // whole — so `name:"a b"` and `stages:[a, b, "c d"]` are each one token (spaces inside are kept).
  // A hand scanner, not a regex: a single regex mis-pairs quotes when a line has several quoted
  // tokens (it can span from one token's closing quote to the next token's opening quote).
  function tokenize(line) {
    const out = []; let buf = '', q = false, depth = 0;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { q = !q; buf += ch; continue; }
      if (!q && (ch === '[' || ch === '{' || ch === '(')) { depth++; buf += ch; continue; }  // keep [lists], {blocks}, (params) whole
      if (!q && (ch === ']' || ch === '}' || ch === ')')) { if (depth) depth--; buf += ch; continue; }
      if (!q && depth === 0 && /\s/.test(ch)) { if (buf) { out.push(buf); buf = ''; } continue; }
      buf += ch;
    }
    if (buf) out.push(buf);
    return out;
  }
  const isQuoted = s => s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"';
  const unquote = s => isQuoted(s) ? s.slice(1, -1) : s;

  // Split a bracket-list body on commas/whitespace, but not inside quotes: `a, b, "c d"` → 3 items.
  function splitList(s) {
    const out = []; let buf = '', q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"') { q = !q; buf += ch; continue; }
      if (!q && (ch === ',' || /\s/.test(ch))) { if (buf) { out.push(buf); buf = ''; } continue; }
      buf += ch;
    }
    if (buf) out.push(buf);
    return out;
  }

  // Coerce a value token to number / array / string.
  //   [a, b, "c d"] → array (comma/space separated, quote-aware); each element coerces.
  //   "…"           → ALWAYS a literal string (quotes never make an array).
  //   12/-3.5 → number · else the raw string (`#colour-token`, bareword, id.port, …).
  function coerce(tok) {
    const quoted = tok[0] === '"';
    // Template attribute: `(i,j)=>{expr}` (or `(i,j)=>expr`) → a function evaluated per call with the
    // params bound (e.g. a Matrix cellNote). No spaces around `=>`. The body binds ONLY its params.
    if (tok[0] === '(') {
      const lm = /^\(([^)]*)\)=>([\s\S]+)$/.exec(tok);
      if (lm) {
        const params = lm[1].split(',').map(s => s.trim()).filter(Boolean);
        let body = lm[2].trim();
        if (body[0] === '{' && body[body.length - 1] === '}') body = body.slice(1, -1);
        return (...args) => { const env = {}; params.forEach((p, i) => { env[p] = args[i]; }); return evalExpr(body, env); };
      }
    }
    if (!quoted && tok[0] === '[' && tok[tok.length - 1] === ']')  // bracket list
      return splitList(tok.slice(1, -1)).map(x => coerce(x));
    const s = unquote(tok);
    if (quoted) return s;                                          // a quoted literal is always a string
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);              // number
    return s;                                                     // #colour-token, bareword, etc. (colours resolve at build)
  }

  // Parse an `x,y` coordinate token (used by divider/rule and ghost). `kw` names the statement for errors.
  function xyCoord(tok, ln, kw) {
    const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(tok || '');
    if (!m) throw new Error('flow: line ' + ln + ': ' + kw + ' needs coordinates `x,y` (got "' + (tok == null ? '' : tok) + '")');
    return [Number(m[1]), Number(m[2])];
  }

  // Colours carry a `#` sigil (a #hex like #5cb4ff or a #name like #sky), or are an rgb()/hsl() function.
  // The parser only enforces the SIGIL — a bareword like `red` (missing #) is the loud error. What a
  // #name actually means is resolved against the active theme at BUILD time (scene → Flowdot.resolveColor):
  // #hex/#css-name stay literal, #token/#role map per theme. The parser can't do that (theme tokens live
  // in the renderer and custom themes register at runtime), so it defers — an unknown #token errors at build.
  const COLOR_KEYS = new Set(['accent', 'color', 'colColors', 'tint', 'c', 'pulseColor', 'stroke', 'fill', 'glow']);
  const isColor = v => typeof v === 'string' && (v[0] === '#' || /^(rgb|rgba|hsl|hsla)\(/i.test(v));
  function validateColor(key, val, ln) {
    for (const v of (Array.isArray(val) ? val : [val])) if (!isColor(v))
      throw new Error('flow: line ' + ln + ': "' + key + '" needs a colour with a "#" sigil — a #hex ' +
        '(#5cb4ff) or a #name (#sky), or rgb()/hsl(); got "' + v + '"');
  }

  // Per-kind attribute schema — the top agent-safety guardrail: a misspelled/unknown key on a known
  // built-in kind throws a located error listing the valid keys, instead of being silently kept.
  // Custom (registered) kinds are unknown to the parser, so they are NOT validated (pass through).
  const NODE_COMMON = ['id', 'kind', 'x', 'y', 'w', 'h', 'inspect', 'hoverable', 'lane', 'rail', 'align', 'inset', 'decay'];
  const KIND_KEYS = {
    box:      NODE_COMMON.concat(['name', 'sub', 'accent']),
    core:     NODE_COMMON.concat(['name', 'sub', 'accent', 'lit', 'idle', 'owns']),
    slot:     NODE_COMMON.concat(['name', 'accent', 'value']),
    readout:  NODE_COMMON.concat(['watch', 'name', 'label', 'unit', 'accent', 'value']),
    ring:     NODE_COMMON.concat(['slots', 'r', 'color', 'label']),
    matrix:   NODE_COMMON.concat(['rows', 'cols', 'cw', 'ch', 'gap', 'colColors', 'rowLabels', 'colLabels', 'title', 'subtitle', 'cellNote']),
    pipeline: NODE_COMMON.concat(['stages', 'nodeR', 'idle', 'vertical', 'boxed', 'pinned', 'name', 'accent', 'pad', 'step']),
    zone:     ['id', 'kind', 'x', 'y', 'w', 'h', 'label', 'tint', 'accent', 'inspect', 'hoverable', 'lane', 'lanes', 'rail', 'rails'],
  };
  // Accepted style keys on an `edge` (a Connector). A key outside this set throws instead of being
  // silently kept-and-ignored. Colour is a bare `#token` (→ `c`); `dashed` is a bare flag.
  const EDGE_KEYS = new Set(['label', 'alpha', 'dash', 'dashed', 'c', 'pulseColor', 'lw', 'route']);
  function validateKeys(obj, kind, ln) {
    const allowed = KIND_KEYS[kind];
    if (!allowed) return;                                          // custom/unknown kind → not our schema
    const set = new Set(allowed);
    for (const k of Object.keys(obj)) if (!set.has(k))
      throw new Error('flow: line ' + ln + ': "' + kind + '" has no attribute "' + k +
        '" (valid: ' + allowed.filter(x => x !== 'id' && x !== 'kind').join(', ') + ')');
  }

  // Which attribute a BARE `#token` colour sets, per kind: box/core/pipeline/zone paint via `accent`,
  // ring/road/flow via `color`, edge via `c`. So `node q core #sky` == `accent:#sky`, `road a ~> b #emerald`
  // == `color:#emerald`. matrix has no single colour (its columns use `colColors`), so a bare colour on it
  // lands on `color` and trips its schema — use `colColors:[…]` there.
  const KIND_COLOR_KEY = { box: 'accent', core: 'accent', slot: 'accent', readout: 'accent', pipeline: 'accent', zone: 'accent', ring: 'color' };
  const colorKeyFor = kind => KIND_COLOR_KEY[kind] || 'color';
  // Kinds whose single default colour a `colors <kind>:#tok` statement can override (they paint through
  // themeKindColor). matrix (per-column `colColors` ramp) and flow (packet colour = its route/road) use
  // other colour models, so they are not overridable this way.
  const OVERRIDE_KINDS = new Set(['box', 'core', 'ring', 'pipeline', 'zone', 'road', 'edge']);

  // Fold "flag" and "key:value" tokens into an object. A bare `#token`/rgb() (no key) is the element's
  // colour — assigned to `colorKey` (the kind's colour attribute); its MEANING resolves at build.
  function applyKV(obj, toks, ln, colorKey) {
    for (const t of toks) {
      const c = t.indexOf(':');
      if (c > 0 && t[0] !== '"') { const key = t.slice(0, c), v = coerce(t.slice(c + 1));
        if (ln != null && COLOR_KEYS.has(key)) validateColor(key, v, ln);   // catch a typo'd colour name
        obj[key] = v; }
      else if (colorKey && isColor(t)) obj[colorKey] = coerce(t);  // bare colour → the kind's colour attr
      else obj[unquote(t)] = true;                                 // other bare token → boolean flag
    }
    return obj;
  }

  // ── comprehension layer: `set`, `rails = …`, `each … in …:`, and `{expr}` interpolation ──
  // A preprocessor that expands loops/lists into the plain statements parse() already understands,
  // so the two layers stay independent. This is the conciseness sugar from §5 of the design doc.

  const coerceScalar = s => /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : s;

  // Evaluate a small expression. Grammar (loosest → tightest binding):
  //   or  := and ('||' and)*                       boolean
  //   and := eq  ('&&' eq)*
  //   eq  := cmp (('=='|'!=') cmp)*                 equality (strict)
  //   cmp := add (('<'|'<='|'>'|'>=') add)*         comparison
  //   add := mul (('+'|'-') mul)*
  //   mul := prim (('*'|'/'|'%') prim)*
  //   prim:= number | '(' or ')' | '!' prim | '-' prim | name ('[' or ']')? | builtin
  //   builtin := 'rand' '(' ')' | 'mode' '(' name ')' | 'dirty' '(' name ')' | 'now' '(' ')'
  // Built-ins resolve against optional callbacks on `env`: `env.rand()` (a seeded ()=>[0,1) so
  // animations stay reproducible) and `env.mode(name)` (is a named mode active?). Calling one where
  // its callback is absent (e.g. a structural `{expr}` interpolation) throws a clear error. Numbers,
  // names, name[idx] and the arithmetic ops are unchanged, so existing interpolation is unaffected.
  function evalExpr(src, env) {
    const toks = src.match(/\d+\.?\d*|[A-Za-z_]\w*|==|!=|<=|>=|&&|\|\||[-+*/%()\[\]<>!]/g) || [];
    let p = 0; const peek = () => toks[p], eat = () => toks[p++];
    const bad = () => { throw new Error('flow: bad expression "' + src.trim() + '" (unexpected "' + (toks[p] != null ? toks[p] : 'end') + '")'); };
    const expect = t => { if (eat() !== t) bad(); };
    function prim() {
      const t = eat();
      if (t === '(') { const v = or(); expect(')'); return v; }
      if (t === '!') return !prim();
      if (t === '-') return -prim();                             // unary minus
      if (/^\d/.test(t)) return Number(t);
      if (t === 'rand' && peek() === '(') { eat(); expect(')');
        if (typeof env.rand !== 'function') throw new Error('flow: rand() is not available in this context');
        return env.rand(); }
      if (t === 'mode' && peek() === '(') { eat(); const name = eat(); expect(')');
        if (typeof env.mode !== 'function') throw new Error('flow: mode() is not available in this context');
        return env.mode(name); }
      if (t === 'dirty' && peek() === '(') { eat(); const name = eat(); expect(')');
        if (typeof env.dirty !== 'function') throw new Error('flow: dirty() is not available in this context');
        return env.dirty(name); }
      if (t === 'now' && peek() === '(') { eat(); expect(')');       // F17: the runtime clock (seconds) — time-as-a-value, for window/silence guards
        if (typeof env.now !== 'function') throw new Error('flow: now() is not available in this context');
        return env.now(); }
      let v = env[t];                                            // identifier
      if (peek() === '[') { eat(); const i = or(); expect(']'); v = v[i]; }  // name[idx]
      return v;
    }
    function mul() { let v = prim(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = eat(); const r = prim(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
    function add() { let v = mul(); while (peek() === '+' || peek() === '-') { const o = eat(); const r = mul(); v = o === '+' ? v + r : v - r; } return v; }
    function cmp() { let v = add(); while (peek() === '<' || peek() === '<=' || peek() === '>' || peek() === '>=') { const o = eat(); const r = add(); v = o === '<' ? v < r : o === '<=' ? v <= r : o === '>' ? v > r : v >= r; } return v; }
    function eq() { let v = cmp(); while (peek() === '==' || peek() === '!=') { const o = eat(); const r = cmp(); v = o === '==' ? v === r : v !== r; } return v; }
    function and() { let v = eq(); while (peek() === '&&') { eat(); const r = eq(); v = v && r; } return v; }
    function or() { let v = and(); while (peek() === '||') { eat(); const r = and(); v = v || r; } return v; }
    const v = or();
    if (p !== toks.length)                                       // stray/unsupported token → don't silently drop it
      throw new Error('flow: bad expression "' + src.trim() + '" (unexpected "' + toks[p] + '")');
    return v;
  }
  // `a..b` → [a..b] inclusive; a list name → its elements.
  function evalItems(spec, env) {
    const rg = /^(-?\d+)\.\.(-?\d+)$/.exec(spec);
    if (rg) { const out = []; for (let i = +rg[1]; i <= +rg[2]; i++) out.push(i); return out; }
    if (Array.isArray(env[spec])) return env[spec];
    throw new Error('flow: cannot iterate "' + spec + '"');
  }
  // The closed set of behaviour verbs. A flow hop's `{ … }` on-arrival block begins with one of
  // these, which is how interpolate() tells an action block apart from a `{expr}` (both use braces):
  // a brace whose first word is a verb is left literal for the flow parser; anything else is a value
  // expression and is evaluated (so a real interpolation typo still throws loudly).
  const ACTION_VERBS = /^(count|set|write|push|drain|dirty|clean|pulse|spawn|drop|after|call|highlight|down|up|surge|snapshot)\b/;
  // `protect` (optional) is a list of names bound per-fire at run time (flow `pick` vars): a brace
  // referencing one is left literal here and resolved later, not at expand time.
  const interpolate = (text, env, protect) => text.replace(/\{([^}]+)\}/g, (m, e, offset, full) => {
    const expr = e.trim();
    if (full.slice(0, offset).trimEnd().endsWith('=>')) return m;            // lambda body → bind at render time
    if (ACTION_VERBS.test(expr)) return m;                                   // action block, not an expression
    if (protect && protect.length && new RegExp('\\b(' + protect.join('|') + ')\\b').test(expr)) return m;
    return String(evalExpr(expr, env));
  });

  // Extract the pick-clause variable names from a `flow … pick v in L[, w in M] : route` line, so the
  // preprocessor leaves `{v}` literal (pick vars bind per-fire at run time, not at expand time).
  function pickVarNames(text) {
    const m = /\bpick\s+([\s\S]+?)\s:\s/.exec(text);
    if (!m) return null;
    const out = [], re = /([A-Za-z_]\w*)\s+in\b/g; let mm;
    while ((mm = re.exec(m[1]))) out.push(mm[1]);
    return out.length ? out : null;
  }

  // Shared route helpers: used by both parseLinearRoute (spawn) and the `flow` route parser.
  const durOf = tok => { const m = /^~(\d*\.?\d+)$/.exec(tok || ''); return m ? Number(m[1]) : null; };
  const rn = tok => { const d = tok.indexOf('.'); return d < 0 ? { node: tok } : { node: tok.slice(0, d), port: tok.slice(d + 1) }; };

  // Parse a hop's `{ verb …; verb … }` block body into [Action]. Closed verb set; anything else is a
  // loud, located error. set/write carry an expr string (evaluated at run time against the store).
  // A linear route `a ~0.5 b ~0.6 c` → [{node:'a'},{node:'b',dur:0.5},{node:'c',dur:0.6}]. Used by
  // the `spawn` action (a secondary packet); no branches. Node refs may be `id.port` or `{tpl}`.
  function parseLinearRoute(str, ln) {
    const toks = str.trim().split(/\s+/);
    if (!toks.length || durOf(toks[0]) != null) throw new Error('flow: line ' + ln + ': spawn route must start with a node');
    const hops = [rn(toks[0])];
    for (let k = 1; k < toks.length;) {
      const dur = durOf(toks[k]); if (dur == null) throw new Error('flow: line ' + ln + ': spawn expected "~dur" before "' + toks[k] + '"');
      if (toks[k + 1] == null) throw new Error('flow: line ' + ln + ': spawn "~dur" without a node');
      hops.push(Object.assign(rn(toks[k + 1]), { dur })); k += 2;
    }
    if (hops.length < 2) throw new Error('flow: line ' + ln + ': spawn route needs at least one hop');
    return hops;
  }

  function parseActions(body, ln, safe) {
    return body.split(';').map(s => s.trim()).filter(Boolean).map(part => {
      let m;
      if ((m = /^count\s+([A-Za-z_]\w*)$/.exec(part))) return { verb: 'count', name: m[1] };
      // target may carry a `{expr}` interpolation (F6) — e.g. `write grid.{i}.0` — resolved per-fire against the pick bindings.
      if ((m = /^(set|write)\s+([A-Za-z_][\w.{}]*)\s*=\s*(.+)$/.exec(part))) return { verb: m[1], name: m[2], expr: m[3].trim() };
      if ((m = /^(push|drain|dirty|clean)\s+([A-Za-z_][\w.{}]*)$/.exec(part))) return { verb: m[1], name: m[2] };
      // component-method verbs (F5): highlight <m>.row:i · down/up <m>.col:j · surge <ring> [= amount].
      // target may carry `:` (row:/col:) and a `{pick}` interpolation.
      if ((m = /^(highlight|down|up)\s+([A-Za-z_][\w.:{}]*)$/.exec(part))) return { verb: m[1], name: m[2] };
      if ((m = /^surge\s+([A-Za-z_][\w.{}]*)(?:\s*=\s*(.+))?$/.exec(part))) return { verb: 'surge', name: m[1], expr: m[2] ? m[2].trim() : undefined };
      // F18: `snapshot <matrix>` reads (visibly pulls) the WHOLE grid at once; `snapshot <matrix>.row:i` one row.
      if ((m = /^snapshot\s+([A-Za-z_][\w.:{}]*)$/.exec(part))) return { verb: 'snapshot', name: m[1] };
      if ((m = /^after\s+(\d*\.?\d+)\s*:\s*([A-Za-z_]\w*)$/.exec(part))) return { verb: 'after', delay: Number(m[1]), event: m[2] };
      if ((m = /^spawn\s+(.+)$/.exec(part))) {                       // `spawn <route> [#colour]` (F7: colour the spawned packet)
        let route = m[1].trim(), color = null, cm;
        if ((cm = /\s(#\S+)$/.exec(route))) { color = cm[1]; route = route.slice(0, cm.index); }
        return color ? { verb: 'spawn', route: parseLinearRoute(route, ln), color } : { verb: 'spawn', route: parseLinearRoute(route, ln) };
      }
      if ((m = /^drop(?:\s+if\s+(.+))?$/.exec(part))) return { verb: 'drop', cond: m[1] ? m[1].trim() : '1' };
      if ((m = /^call\s+(?:([A-Za-z_]\w*)\s*=\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)$/.exec(part))) {  // Tier-2 host escape
        if (safe) throw new Error('flow: line ' + ln + ": 'call' is disabled in safe mode");
        return { verb: 'call', assign: m[1] || null, fn: m[2], args: m[3].trim() ? m[3].split(',').map(s => s.trim()) : [] };
      }
      throw new Error('flow: line ' + ln + ': bad action "' + part + '"');
    });
  }

  // Expand source text into flat { text, ln } statements, resolving set/each/interpolation.
  function expand(text) {
    const rows = text.split(/\r?\n/)
      .map(l => l.replace(/\t/g, '  '))
      .map((l, i) => ({ indent: l.match(/^ */)[0].length, text: l.trim(), ln: i + 1 }))
      .filter(r => r.text && r.text[0] !== '#');
    const out = [], vars = {};
    (function run(rows, env) {
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k]; let m;
        // `set NAME = …`, or a bare `NAME = …` list (but not an edge/road, which use -> / ~>)
        if ((m = /^set\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(r.text)) ||
            (!/[-~]>/.test(r.text) && (m = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(r.text)))) {
          vars[m[1]] = interpolate(m[2].trim(), Object.assign({}, vars, env)).split(/\s+/).map(coerceScalar);
          continue;
        }
        if ((m = /^each\s+([A-Za-z_]\w*)\s+in\s+(.+?)\s*:$/.exec(r.text))) {
          const items = evalItems(m[2].trim(), Object.assign({}, vars, env));
          const body = []; let j = k + 1;
          while (j < rows.length && rows[j].indent > r.indent) body.push(rows[j++]);
          items.forEach(val => run(body, Object.assign({}, env, { [m[1]]: val })));
          k = j - 1; continue;
        }
        let protect = null;                                                     // defer runtime-bound vars
        if (/^flow\b/.test(r.text)) protect = pickVarNames(r.text);             //   flow `pick` vars
        else if (/^every\b/.test(r.text)) { const pm = /\bper\s+([A-Za-z_]\w*)\s+in\b/.exec(r.text); if (pm) protect = [pm[1]]; }  // every `per` var
        out.push({ text: interpolate(r.text, Object.assign({}, vars, env), protect), ln: r.ln });
      }
    })(rows, {});
    return out;
  }

  // Parse an endpoint ref: `x,y` → [num,num]; `id.port` → [id,port]; `id` → [id, defPort].
  function ref(tok, defPort) {
    if (/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(tok)) { const p = tok.split(','); return [+p[0], +p[1]]; }
    const d = tok.indexOf('.');
    return d < 0 ? [tok, defPort] : [tok.slice(0, d), tok.slice(d + 1)];
  }

  // ── module include: `import "<path.flow>"` ──────────────────────────────────────────────────────
  // A preprocessor that INLINES an imported source's text in place of the import line (before expand /
  // parse), so a shared node/theme library merges into the diagram. Resolution:
  //   • opts.resolveImport(path, base) → text   — caller-supplied (the browser: preload / fetch first)
  //   • else, under node: fs.readFileSync(path.resolve(base, path)) relative to the importing file
  // Cycles throw ("import cycle"); a missing file / null resolver throws ("cannot import"). Gated by
  // safe mode (an import while safe → "disabled in safe mode"). `seen` is the current include chain.
  const IS_NODE = typeof module !== 'undefined' && module.exports;
  function resolveImportText(p, base, opts) {
    if (opts.resolveImport) {
      const t = opts.resolveImport(p, base);
      if (t == null) throw new Error('flow: cannot import "' + p + '" (resolver returned nothing)');
      return { key: (base || '') + ' ' + p, text: String(t), base: base };
    }
    if (IS_NODE) {
      const path = require('path'), fs = require('fs');
      const abs = path.resolve(base || '.', p);
      let text; try { text = fs.readFileSync(abs, 'utf8'); }
      catch (e) { throw new Error('flow: cannot import "' + p + '" (' + (e.code || 'read error') + ')'); }
      return { key: abs, text: text, base: path.dirname(abs) };
    }
    throw new Error('flow: cannot import "' + p + '" — provide opts.resolveImport (no sync file read in the browser)');
  }
  function inlineImports(text, opts, base, seen) {
    seen = seen || new Set();
    return text.split(/\r?\n/).map(line => {
      const m = /^\s*import\s+"([^"]+)"\s*$/.exec(line.split('#')[0].trimEnd());
      if (!m) return line;
      if (opts.safe) throw new Error("flow: 'import' is disabled in safe mode");
      const r = resolveImportText(m[1], base, opts);
      if (seen.has(r.key)) throw new Error('flow: import cycle at "' + m[1] + '"');
      const next = new Set(seen); next.add(r.key);
      return inlineImports(r.text, opts, r.base, next);              // recurse into the imported source
    }).join('\n');
  }

  // parse(text, opts?) — opts.safe (default false) disables the Tier-2 / include escapes: a `model`,
  // `call`, or `import` in the source throws "disabled in safe mode". opts.resolveImport / opts.base
  // control `import` resolution (see inlineImports). boot()/embeds pass safe:true so untrusted `.flow`
  // (e.g. a live-edited or user-submitted source) can never read/execute host code.
  function parse(text, opts) {
    opts = opts || {};
    const safe = !!opts.safe;
    text = inlineImports(text, opts, opts.base, null);               // merge `import`s (throws if safe)
    const ir = { zones: [], nodes: [], edges: [] };
    expand(text).forEach(({ text: line, ln }) => {
      // Tokenize first, THEN drop a trailing comment — a comment starts at a STANDALONE `#` token
      // (`… # note` → the space-separated `#`). A glued `#…` token (`#5ef2a0`, `#sky`, `#steelblue`)
      // is a bare colour and survives; write comments with a space after the hash.
      const toks = tokenize(line);
      const ci = toks.findIndex(tk => tk === '#');
      const t = ci < 0 ? toks : toks.slice(0, ci);
      if (!t.length) return;
      const kw = t[0];
      switch (kw) {
        case 'flowdot': {    // format version pragma: `flowdot 1` / `flowdot 1.2` → ir.version (major must be supported)
          const v = t[1], vm = /^(\d+)(?:\.(\d+))?$/.exec(v || '');
          if (!vm) throw new Error('flow: line ' + ln + ': flowdot version must be a number, got "' + (v || '') + '"');
          if (+vm[1] !== SPEC_MAJOR) throw new Error('flow: line ' + ln + ': unsupported flowdot version ' + v +
            ' (this build supports flowdot ' + SPEC_MAJOR + '.x)');
          ir.version = v;
          break;
        }
        case 'diagram': {
          let i = 1;
          if (t[i] && t[i][0] === '"') { ir.title = unquote(t[i]); i++; }
          const dim = /^(\d+)x(\d+)$/.exec(t[i] || '');
          if (dim) { ir.width = +dim[1]; ir.height = +dim[2]; i++; }
          if (t[i]) ir.theme = t[i];
          break;
        }
        case 'behavior': {   // behaviour section header; may carry `seed:N` inline (`behavior seed:42`)
          const rest = applyKV({}, t.slice(1));
          if (rest.seed != null) ir.seed = typeof rest.seed === 'number' ? rest.seed : Number(rest.seed);
          ir.behavior = true;
          break;
        }
        case 'mode': {       // `mode <name>: <effect>; …` — spawn xN | tier>=k drain xM | down/up <m>.col:j | surge <ring> [= n] | decay <m> x<f>
          // Parsed off the raw line (mini-grammar with `;`/`>=`/`x` sigils the ws-tokenizer would
          // fragment). Modes carry no #hex, so any `#` starts a comment → strip it.
          const src = line.split('#')[0];
          const m = /^mode\s+([A-Za-z_]\w*)\s*:\s*(.*)$/.exec(src.trim());
          if (!m) throw new Error('flow: line ' + ln + ': mode must be `mode <name>: <effects>`');
          const effects = [];
          m[2].split(';').map(s => s.trim()).filter(Boolean).forEach(part => {
            let e;
            if ((e = /^spawn\s+x(\d*\.?\d+)$/.exec(part))) effects.push({ op: 'rate', factor: Number(e[1]) });
            else if ((e = /^tier\s*>=\s*(\d+)\s+drain\s+x(\d*\.?\d+)$/.exec(part))) effects.push({ op: 'drainMul', tierFrom: Number(e[1]), factor: Number(e[2]) });
            // F14: a mode can drive STATE, not just rate — the F5 method verbs applied on enter and
            // reverted on exit (down⇄up, surge⇄drain), plus a decay-rate multiplier on a matrix.
            else if ((e = /^(down|up)\s+([A-Za-z_][\w.:]*)$/.exec(part))) effects.push({ op: 'method', verb: e[1], target: e[2] });
            else if ((e = /^surge\s+([A-Za-z_][\w.]*)(?:\s*=\s*(\d*\.?\d+))?$/.exec(part))) effects.push({ op: 'method', verb: 'surge', target: e[1], amount: e[2] != null ? Number(e[2]) : undefined });
            else if ((e = /^decay\s+([A-Za-z_][\w.]*)\s+x(\d*\.?\d+)$/.exec(part))) effects.push({ op: 'decayMul', target: e[1], factor: Number(e[2]) });
            else throw new Error('flow: line ' + ln + ': unknown mode effect "' + part + '"');
          });
          (ir.modes || (ir.modes = [])).push({ name: m[1], effects });
          break;
        }
        case 'every': {      // `every <rate>[s] per <v> in <list> [when <cond>]: <actions>` → ir.periodics
          const src = line.replace(/\s+#\s.*$/, '');   // strip a trailing `# comment` (space after #) but KEEP a glued `#token` (F7 colour on a spawn)
          const m = /^every\s+(\S+)\s+per\s+([A-Za-z_]\w*)\s+in\s+(\[[^\]]*\]|\S+?)(?:\s+when\s+(.+?))?\s*:\s*(.*)$/.exec(src.trim());
          if (!m || !m[5].trim()) throw new Error('flow: line ' + ln + ': every must be `every <rate> per <var> in <list> [when <cond>]: <actions>`');
          const rate = Number(String(m[1]).replace(/s$/, ''));
          if (!Number.isFinite(rate)) throw new Error('flow: line ' + ln + ': every rate must be a number, got "' + m[1] + '"');
          let list;
          if (m[3][0] === '[') list = coerce(m[3]);
          else { const rg = /^(-?\d+)\.\.(-?\d+)$/.exec(m[3]); if (!rg) throw new Error('flow: line ' + ln + ': every list must be a [bracket list] or a range');
            list = []; for (let i = +rg[1]; i <= +rg[2]; i++) list.push(i); }
          const pd = { var: m[2], list, rate, actions: parseActions(m[5], ln, safe) };
          if (m[4]) pd.when = m[4].trim();
          (ir.periodics || (ir.periodics = [])).push(pd);
          break;
        }
        case 'on': {         // `on <event>[(params)]: <actions>` → a named event handler (ir.events)
          const src = line.split('#')[0];                              // handlers carry no #hex → any # is a comment
          const m = /^on\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/.exec(src.trim());
          if (!m || !m[3].trim()) throw new Error('flow: line ' + ln + ': on must be `on <event>[(params)]: <actions>`');
          const params = m[2] ? m[2].split(',').map(s => s.trim()).filter(Boolean) : [];
          (ir.events || (ir.events = [])).push({ name: m[1], params, actions: parseActions(m[3], ln, safe) });
          break;
        }
        case 'model': {      // Tier-2: `model "<path>"` (node require) or `model <GlobalName>` (browser)
          if (safe) throw new Error('flow: line ' + ln + ": 'model' is disabled in safe mode");
          ir.model = t[1] && t[1][0] === '"' ? unquote(t[1]) : t[1];
          break;
        }
        case 'controls': {   // opt-in transport bar (play/pause + reset + speed); boot() auto-renders it
          ir.controls = true;
          break;
        }
        case 'theme-toggle': {   // opt-in dark↔light toggle button; boot() auto-renders it (re-mounts on flip)
          ir.themeToggle = true;
          break;
        }
        case 'auto-edges': {     // opt-in: derive a faint connector per flow-route hop (scene.buildFlows)
          ir.autoEdges = true;
          break;
        }
        case 'colors': {         // per-kind colour override: `colors road:#emerald core:#sky` — a
          // diagram-wide default per kind, layered over the theme (inline #token wins; theme is the floor)
          const kc = ir.kindColors || (ir.kindColors = {});
          for (const tok of t.slice(1)) {
            const c = tok.indexOf(':');
            if (c <= 0) throw new Error('flow: line ' + ln + ': colors expects "<kind>:#colour" pairs, got "' + tok + '"');
            const kind = tok.slice(0, c), val = coerce(tok.slice(c + 1));
            if (!OVERRIDE_KINDS.has(kind)) throw new Error('flow: line ' + ln + ': colors has no kind "' + kind +
              '" (valid: ' + [...OVERRIDE_KINDS].join(', ') + ')');
            validateColor(kind, val, ln);
            kc[kind] = val;
          }
          break;
        }
        case 'seed': {       // `seed 42` or `seed 0x51F0` → ir.seed (a number seeding the runtime RNG)
          const raw = t[1];
          const n = /^0x[0-9a-fA-F]+$/.test(raw || '') ? parseInt(raw, 16) : Number(raw);
          if (!Number.isFinite(n)) throw new Error('flow: line ' + ln + ': seed must be a number, got "' + raw + '"');
          ir.seed = n;
          break;
        }
        case 'zone': {
          const z = { id: t[1] }; let i = 2;
          if (t[i] && t[i][0] === '"') { z.label = unquote(t[i]); i++; }
          applyKV(z, t.slice(i), ln, 'accent'); validateKeys(z, 'zone', ln); ir.zones.push(z);
          break;
        }
        case 'note': {   // a documentation callout: note "text" -> <nodeId>  (chip + leader line)
          const ai = t.indexOf('->');
          if (ai !== 2 || !t[1] || t[1][0] !== '"' || t[ai + 1] == null)
            throw new Error('flow: line ' + ln + ': note must be `note "text" -> <nodeId>`');
          (ir.notes || (ir.notes = [])).push({ text: unquote(t[1]), target: t[ai + 1] });
          break;
        }
        case 'divider':
        case 'rule': {   // F12: a free labelled line — `divider "label" x1,y1 -> x2,y2 [#colour] [solid]`.
          //             The label is optional; `solid` drops the default dashes. Not tied to any node.
          const ai = t.indexOf('->');
          if (ai < 1) throw new Error('flow: line ' + ln + ': ' + kw + ' must be `' + kw + ' ["label"] x1,y1 -> x2,y2 [#colour] [solid]`');
          const [x1, y1] = xyCoord(t[ai - 1], ln, kw), [x2, y2] = xyCoord(t[ai + 1], ln, kw);
          const d = { x1, y1, x2, y2 };
          if (t[1] && t[1][0] === '"') d.label = unquote(t[1]);       // optional leading label
          for (const tk of t.slice(ai + 2)) {                          // trailing #colour / solid|dashed
            if (isColor(tk)) d.color = coerce(tk);
            else if (tk === 'solid') d.dashed = false;
            else if (tk === 'dashed') d.dashed = true;
            else throw new Error('flow: line ' + ln + ': ' + kw + ' — unexpected "' + tk + '" (want #colour or solid/dashed)');
          }
          (ir.dividers || (ir.dividers = [])).push(d);
          break;
        }
        case 'ghost': { // F16: a counterfactual callout — `ghost "caption" x,y [-> x2,y2] [#colour]`.
          //            Ghosts form a toggleable layer (hidden by default); accumulate into ir.ghosts.
          if (!t[1] || t[1][0] !== '"')
            throw new Error('flow: line ' + ln + ': ghost must be `ghost "caption" x,y [-> x2,y2] [#colour]`');
          const ai = t.indexOf('->');
          const [x, y] = xyCoord(t[2], ln, 'ghost');
          const gh = { text: unquote(t[1]), x, y };
          if (ai >= 0) { const [x2, y2] = xyCoord(t[ai + 1], ln, 'ghost'); gh.x2 = x2; gh.y2 = y2; }
          for (const tk of (ai >= 0 ? t.slice(ai + 2) : t.slice(3))) {   // trailing #colour only
            if (isColor(tk)) gh.color = coerce(tk);
            else throw new Error('flow: line ' + ln + ': ghost — unexpected "' + tk + '" (want a #colour)');
          }
          (ir.ghosts || (ir.ghosts = [])).push(gh);
          break;
        }
        case 'legend': { // an opt-in colour key: legend "label" #colour  (one row per line)
          if (!t[1] || t[1][0] !== '"' || !isColor(t[2] || ''))
            throw new Error('flow: line ' + ln + ': legend must be `legend "label" #colour`');
          (ir.legend || (ir.legend = [])).push({ label: unquote(t[1]), color: coerce(t[2]) });
          break;
        }
        case 'narrate': {  // F10: a guided-story step — `narrate <dwell> <node…> : "<caption>"`. Steps
          //                 accumulate in order and cycle on the clock, spotlighting the node(s) + caption.
          const ci = t.indexOf(':');
          if (ci < 0 || t[ci + 1] == null || t[ci + 1][0] !== '"')
            throw new Error('flow: line ' + ln + ': narrate must be `narrate <dwell> <node…> : "<caption>"`');
          const dur = Number(t[1]);
          if (!(dur > 0)) throw new Error('flow: line ' + ln + ': narrate needs a positive dwell time (seconds), got "' + (t[1] == null ? '' : t[1]) + '"');
          const nodes = t.slice(2, ci);
          if (!nodes.length) throw new Error('flow: line ' + ln + ': a narrate step needs at least one node to spotlight');
          (ir.narration || (ir.narration = { steps: [] })).steps.push({ dur, nodes, caption: unquote(t[ci + 1]) });
          break;
        }
        case 'join': {   // fan-in barrier: `join <nodeId> : <inputA> <inputB> …` — the node fires
          //                 (pulses + runs its arrival actions) only once every named input has arrived.
          const ci = t.indexOf(':');
          const inputs = ci >= 0 ? t.slice(ci + 1) : [];
          if (!t[1] || ci !== 2 || inputs.length < 2)
            throw new Error('flow: line ' + ln + ': join must be `join <nodeId> : <inputA> <inputB> …` (≥2 inputs)');
          (ir.joins || (ir.joins = [])).push({ node: t[1], inputs });
          break;
        }
        case 'lane': {   // layout column: lane <id> x:.. w:..  (used by node lane:<id>)
          const L = { id: t[1] };
          applyKV(L, t.slice(2));
          (ir.lanes || (ir.lanes = [])).push(L);
          break;
        }
        case 'rail': {   // layout row: rail <id> <y>  or  rail <id> y:..  (used by node rail:<id>)
          const R = { id: t[1] }; let i = 2;
          if (t[i] != null && /^-?\d+(?:\.\d+)?$/.test(t[i])) { R.y = Number(t[i]); i++; }
          applyKV(R, t.slice(i));
          (ir.rails || (ir.rails = [])).push(R);
          break;
        }
        case 'node': {
          const hasKind = t[2] != null && !t[2].startsWith('#') && !t[2].includes(':');
          const kind = hasKind ? t[2] : 'box';
          const n = { id: t[1], kind };
          applyKV(n, hasKind ? t.slice(3) : t.slice(2), ln, colorKeyFor(kind)); validateKeys(n, n.kind, ln); ir.nodes.push(n);
          break;
        }
        case 'edge':
        case 'road': {
          const arrow = kw === 'road' ? '~>' : '->', ai = t.indexOf(arrow);
          if (ai < 0) throw new Error('flow: line ' + ln + ': ' + kw + ' needs "' + arrow + '"');
          const e = { from: ref(t[ai - 1], 'out'), to: ref(t[ai + 1], 'in') };
          const rest = applyKV({}, t.slice(ai + 2), ln, kw === 'road' ? 'color' : 'c');
          if (rest.id) { e.id = rest.id; delete rest.id; }
          if (kw === 'road') { e.kind = 'road';
            if (rest.width != null && (typeof rest.width !== 'number' || rest.width <= 0))
              throw new Error('flow: line ' + ln + ': road width must be a positive number, got "' + rest.width + '"');
            Object.assign(e, rest); }
          else {                                        // edge: validate style keys (no more silent-swallow)
            for (const k of Object.keys(rest)) if (!EDGE_KEYS.has(k))
              throw new Error('flow: line ' + ln + ': "edge" has no attribute "' + k + '" (valid: ' + [...EDGE_KEYS].join(', ') + ')');
            e.style = rest; }
          ir.edges.push(e);
          break;
        }
        case 'flow': {   // behaviour: flow <id> rate:.. [color:.. r:.. max:..] : <route>
          //   linear:   ... : a ~0.6 b ~0.5 c
          //   pick:     ... : a ~0.6 hub ~0.5 emit @0.82 | ~0.5 drop @0.18   (weighted choose-one)
          //   fan-out:  ... : a ~0.6 hub ~0.5 c0 & ~0.5 c1 & ~0.5 c2         (a packet to every branch)
          // A branch group (| or &, homogeneous) follows the linear prefix; each option is a single
          // `~dur node [@weight]` hop off the last prefix node. `@weight` defaults to 1.
          const f = { id: t[1] };
          const ci = t.indexOf(':');
          const header = ci >= 0 ? t.slice(2, ci) : t.slice(2);
          // A `pick <v> in <list>[, <w> in <list>]` clause may sit between the kv header and the ':'.
          // Each list is a [bracket list] (coerced to an array). The vars bind a random element per fire.
          const pickIdx = header.indexOf('pick');
          if (pickIdx >= 0) {
            applyKV(f, header.slice(0, pickIdx), ln, 'color');
            const picks = []; let pk = pickIdx + 1;
            while (pk < header.length) {
              const v = (header[pk++] || '').replace(/,$/, '');
              if (header[pk++] !== 'in') throw new Error('flow: line ' + ln + ': pick expects "<var> in <list>"');
              const listTok = (header[pk++] || '').replace(/,$/, '');
              const list = coerce(listTok);
              if (!Array.isArray(list)) throw new Error('flow: line ' + ln + ': pick list must be a [bracket list], got "' + listTok + '"');
              picks.push({ var: v, list });
            }
            f.pick = picks;
          } else applyKV(f, header, ln, 'color');
          if (f.rate != null && (typeof f.rate !== 'number' || f.rate <= 0))
            throw new Error('flow: line ' + ln + ': flow rate must be a positive number (packets per second), got "' + f.rate + '"');
          const rt = ci >= 0 ? t.slice(ci + 1) : [];
          if (rt.length) {
            // a route node is `id` or `id.port` (port may contain ':', e.g. grid.colTop:0)
            const wOf = tok => { const m = /^@(\d*\.?\d+)$/.exec(tok || ''); return m ? Number(m[1]) : null; };
            const colOf = tok => (typeof tok === 'string' && tok.length > 1 && tok[0] === '#') ? tok : null;   // F15: a `#colour` on a hop/branch → per-outcome packet colour
            const actOf = tok => (tok && tok[0] === '{' && tok[tok.length - 1] === '}') ? tok.slice(1, -1) : null;
            const bad = msg => { throw new Error('flow: line ' + ln + ': ' + msg); };
            const clean = h => { const o = { node: h.node }; if (h.port != null) o.port = h.port; if (h.dur != null) o.dur = h.dur; if (h.color != null) o.color = h.color; if (h.actions != null) o.actions = h.actions; return o; };

            const hasPick = rt.includes('|'), hasAll = rt.includes('&');
            if (hasPick && hasAll) bad('a flow branch cannot mix "|" and "&"');
            const sep = hasPick ? '|' : hasAll ? '&' : null;
            const segs = [[]]; for (const x of rt) x === sep ? segs.push([]) : segs[segs.length - 1].push(x);

            // seg0 is the linear chain: a leading node then `~dur node [@weight] [{actions}]` hops.
            // An `{ … }` token (on-arrival actions) may trail any node; `@weight` (branch) comes first.
            const s0 = segs[0];
            let k = 0;
            if (!s0.length || durOf(s0[0]) != null) bad('flow route must start with a node');
            const takeActions = node => { const a = actOf(s0[k]); if (a != null) { node.actions = parseActions(a, ln, safe); k++; } };
            const first = rn(s0[k++]); takeActions(first);
            const hops = [first];
            while (k < s0.length) {
              const dur = durOf(s0[k]); if (dur == null) bad('expected "~dur" before "' + s0[k] + '"'); k++;
              if (s0[k] == null || durOf(s0[k]) != null || wOf(s0[k]) != null || colOf(s0[k]) != null || actOf(s0[k]) != null) bad('"~dur" without a node');
              const hop = Object.assign(rn(s0[k++]), { dur });
              for (;;) {                                        // optional @weight / #colour / when — any order, before {actions}
                const w = wOf(s0[k]); if (w != null) { hop.weight = w; k++; continue; }
                const cc = colOf(s0[k]); if (cc != null) { hop.color = cc; k++; continue; }
                if (s0[k] === 'when') { k++; const gt = []; while (k < s0.length && actOf(s0[k]) == null && wOf(s0[k]) == null && colOf(s0[k]) == null) gt.push(s0[k++]); if (!gt.length) bad('when needs a condition'); hop.guard = gt.join(' '); continue; }
                break;
              }
              takeActions(hop);
              hops.push(hop);
            }

            if (!sep) {
              if (hops.some(h => h.guard != null)) bad('when is only valid on a "|" branch option');
              f.route = hops.map(clean);                       // plain linear route
            } else {
              if (hops.length < 2) bad('a flow branch needs a node to branch from');
              const opt = h => { const o = Object.assign(clean(h), { weight: h.weight != null ? h.weight : 1 }); if (h.guard != null) o.guard = h.guard; return o; };
              const options = [opt(hops.pop())];               // seg0's tail hop is the first option
              for (let s = 1; s < segs.length; s++) {
                const seg = segs[s], dur = durOf(seg[0]);
                if (dur == null || seg[1] == null) bad('branch option must be "~dur node [@weight]"');
                const h = Object.assign(rn(seg[1]), { dur });   // ~dur node [@weight] [#colour] [when <cond>] [{actions}]
                let j = 2;
                for (;;) {                                      // optional @weight / #colour / when — any order, before {actions}
                  const w = wOf(seg[j]); if (w != null) { h.weight = w; j++; continue; }
                  const cc = colOf(seg[j]); if (cc != null) { h.color = cc; j++; continue; }
                  if (seg[j] === 'when') { j++; const gt = []; while (j < seg.length && actOf(seg[j]) == null && wOf(seg[j]) == null && colOf(seg[j]) == null) gt.push(seg[j++]); if (!gt.length) bad('when needs a condition'); h.guard = gt.join(' '); continue; }
                  break;
                }
                const a = actOf(seg[j]); if (a != null) { h.actions = parseActions(a, ln, safe); j++; }
                if (seg.length > j) bad('a branch option must be "~dur node [@weight] [#colour] [when <cond>] [{actions}]"');
                options.push(opt(h));
              }
              f.route = hops.map(clean);                       // the linear prefix (branch node last)
              f.fork = { mode: sep === '|' ? 'pick' : 'all', options };
              if (f.fork.mode === 'all' && options.some(o => o.guard != null)) bad('when guards are only for a "|" pick, not "&" fan-out');
            }
          }
          (ir.flows || (ir.flows = [])).push(f);
          break;
        }
        default:
          throw new Error('flow: line ' + ln + ': unknown statement "' + kw + '"');
      }
    });
    return ir;
  }

  const API = { parse, tokenize, coerce, expand, interpolate, evalExpr, KIND_KEYS, NODE_COMMON, SPEC_VERSION, SPEC_MAJOR };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  /* node:coverage disable */                         // browser UMD tail (window.Flow) — unreachable under node
  else global.Flow = API;
  /* node:coverage enable */
})(typeof window !== 'undefined' ? window : globalThis);


/* ─────────── src/mount.js ─────────── */
/*
 * mount.js — the "batteries-included" entry: turn .flow text (or an IR) into a running diagram in
 * one call, and optionally with NO JavaScript at all.
 *
 * This is the top application layer over the three lower modules (Flowdot renderer, SceneBuilder,
 * Flow parser). It collapses the boilerplate every declarative page repeats —
 *     parse → new Diagram → build → buildFlows → onUpdate → start
 * into `Flowdot.mount(canvas, dgmText)`, and adds an opt-in auto-boot so a page can be *just* a
 * `.flow` source plus the script include:
 *
 *     <script type="text/flow" data-flowdot data-seed="0x51F0"> …diagram source… </script>
 *
 * On load, `boot()` finds every `<script type="text/flow" data-flowdot>`, inserts a <canvas> after it,
 * and mounts the source into it. `data-seed` seeds the PRNG (reproducible weighted `pick`s);
 * `data-source="#sel"` mirrors the raw text into that element (a zero-JS "view the source" panel).
 * The marker is required so a page with its own bespoke mount is never double-mounted.
 *
 * UMD: extends `window.Flowdot` (adds `.mount` / `.boot`) in the browser; `module.exports` in node.
 */
(function (global) {
  "use strict";
  const isNode = typeof module !== 'undefined' && module.exports;
  const DK    = isNode ? require('./flowdot.js') : global.Flowdot;
  const Scene = isNode ? require('./scene.js')   : global.SceneBuilder;
  const Flow   = isNode ? require('./flow.js')      : global.Flow;

  const isDiagramLike = t => t && typeof t.add === 'function' && typeof t.connector === 'function';
  const toSeed = s => typeof s === 'number' ? s : Number(s);          // "0x51F0" / "123" → number
  const resolveEl = t => typeof t === 'string'                        // selector | element | null
    ? (typeof document !== 'undefined' ? document.querySelector(t) : null) : t;

  // mount(target, source, opts?) → { ir, diagram, rt, byId, edgesById }
  //   target : a Diagram-like object (used as-is), a <canvas> element, or a selector string.
  //   source : .flow text, or an already-parsed IR object.
  //   opts   : { seed?, rng?, diagram?:extraDiagramOpts, autoStart?:true, showSource? }.
  //            showSource (selector | element) mirrors the raw .flow text into that element — the
  //            "view the source" panel every demo used to wire by hand — so no page chrome is needed.
  function mount(target, source, opts) {
    opts = opts || {};
    const safe = !!opts.safe;                                          // disable Tier-2 model/call/import
    const ir = (typeof source === 'string')
      ? Flow.parse(source, { safe, base: opts.base, resolveImport: opts.resolveImport }) : source;
    if (!ir) throw new Error('Flowdot.mount: missing source (.flow text or an IR object)');
    if (opts.showSource && typeof source === 'string') {
      const el = resolveEl(opts.showSource);
      if (el) el.textContent = source;
    }
    // Theme precedence: opts.diagram.theme (the toggle override) > `diagram … <theme>` (ir.theme) >
    // the browser's prefers-color-scheme. `themeName` is the one actually used, surfaced on the result
    // so the toggle can label its initial state correctly.
    const themeName = (opts.diagram && opts.diagram.theme != null) ? opts.diagram.theme
      : (ir.theme != null ? ir.theme : prefersColorScheme(opts));
    const diagram = isDiagramLike(target) ? target
      : new DK.Diagram(typeof target === 'string' ? document.querySelector(target) : target,
          Object.assign({ width: ir.width, height: ir.height, theme: themeName }, opts.diagram));

    const built = Scene.build(ir, diagram);
    if (ir.warnings && typeof console !== 'undefined' && console.warn)   // e.g. ambiguous auto-declared rail order
      ir.warnings.forEach(w => console.warn(w));
    // Seed precedence: an explicit opts.rng wins; then opts.seed (e.g. the <script data-seed>) as an
    // override; then the source's own `seed N` (ir.seed) as its declared default.
    const seed = opts.seed != null ? opts.seed : ir.seed;
    const rng = opts.rng || (seed != null ? DK.Rng(toSeed(seed)) : undefined);
    const rt = Scene.buildFlows(ir, { byId: built.byId, diagram, rng, safe });

    const prev = diagram.onUpdate;                                    // chain, don't clobber
    diagram.onUpdate = (dt, now) => { rt.update(dt, now); if (prev) prev(dt, now); };

    applyA11y(diagram, ir);                                           // role/aria-label/title + text fallback
    // Honour prefers-reduced-motion: paint one static frame, don't spin the animation loop.
    if (prefersReducedMotion(opts)) { if (typeof diagram.render === 'function') diagram.render(); }
    else if (opts.autoStart !== false && typeof diagram.start === 'function') diagram.start();

    // Teardown: stop the loop + drop listeners, unchain our onUpdate, and neutralize the runtime so
    // NOTHING fires on a further tick — the prerequisite for live-editing (re-mount into the same
    // canvas without leaking timers/RAF/listeners). Idempotent.
    const dispose = () => {
      if (typeof diagram.dispose === 'function') diagram.dispose();
      else if (typeof diagram.stop === 'function') diagram.stop();
      diagram.onUpdate = prev;
      rt._sources.length = 0; rt._timers.length = 0; rt._periodics.length = 0;
      rt._events = {}; rt._onFrame = null; rt._afterFrame = null;
      if (diagram.flow && Array.isArray(diagram.flow.packets)) diagram.flow.packets.length = 0;
    };
    return { ir, diagram, rt, theme: themeName, byId: built.byId, edgesById: built.edgesById, dispose };
  }

  // boot(root?, mountFn?) → [results] — mount every opted-in <script type="text/flow" data-flowdot>.
  // Pure enough to test: pass a fake `root` (needs querySelectorAll + createElement) and mountFn.
  function boot(root, mountFn) {
    const doc = root || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.querySelectorAll) return [];
    const run = mountFn || mount, out = [];
    doc.querySelectorAll('script[type="text/flow"][data-flowdot]').forEach(el => {
      if (el.__fvMounted) return; el.__fvMounted = true;             // never double-mount
      const canvas = doc.createElement('canvas');
      if (el.className) canvas.className = el.className;
      if (el.parentNode) el.parentNode.insertBefore(canvas, el.nextSibling);
      const opts = {};
      if (el.dataset && el.dataset.seed != null && el.dataset.seed !== '') opts.seed = el.dataset.seed;
      if (el.dataset && el.dataset.source) opts.showSource = el.dataset.source;   // mirror text into it
      opts.safe = !(el.dataset && el.dataset.unsafe != null);           // embed = untrusted → safe by default (opt out: data-unsafe)
      const res = run(canvas, (el.textContent || '').trim(), opts);
      canvas.__flowdot = res;                                         // handle for debugging / tests
      res.exportPNG = exportPNG(canvas, doc, res.ir && res.ir.title); // imperative: save the frame as PNG

      // Shared re-mount plumbing. The theme toggle and live edit both re-mount the source into the SAME
      // canvas, so they share `remountOpts` (a toggled theme survives a later edit) and the `current`
      // handle. `remount(text)` disposes the old diagram and re-renders the auto control bars (each
      // renderer drops its prior bar, so no stacking). Re-mount skips showSource so it never clobbers
      // what the user is typing.
      const controlsOn = r => (el.dataset && el.dataset.controls != null) || (r.ir && r.ir.controls);
      const editable = !!(el.dataset && el.dataset.editable != null && el.dataset.source && doc.querySelector);
      const panel = editable ? doc.querySelector(el.dataset.source) : null;
      const remountOpts = Object.assign({}, opts); delete remountOpts.showSource;
      const wantToggle = !!((el.dataset && el.dataset.themeToggle != null) || (res.ir && res.ir.themeToggle));
      let current = res, themeName = res.theme || (res.ir && res.ir.theme) || 'dark';
      const currentSource = () => ((panel && panel.value != null ? panel.value : (el.textContent || '')) + '').trim();
      function renderBars(r) {
        renderModeControls(doc, canvas, r);                           // zero-JS toggle per declared mode
        if (controlsOn(r)) renderTransportControls(doc, canvas, r);   // zero-JS play/pause + reset + speed
        if (wantToggle) renderThemeToggle(doc, canvas, themeName, flipTheme);   // zero-JS dark↔light
        if (ghostOn(r)) renderGhostToggle(doc, canvas, r.diagram);    // F16: zero-JS counterfactual layer toggle
      }
      const ghostOn = r => (el.dataset && el.dataset.ghostToggle != null) || (r && r.ir && r.ir.ghosts && r.ir.ghosts.length);
      function remount(text) {
        if (current && typeof current.dispose === 'function') current.dispose();
        current = run(canvas, text, remountOpts);
        current.exportPNG = exportPNG(canvas, doc, current.ir && current.ir.title);
        canvas.__flowdot = current;
        renderBars(current);
        return current;
      }
      // Flip dark↔light and re-mount (the theme is fixed at Diagram construction, so a live swap IS a
      // re-mount). The override lives in remountOpts.diagram.theme so a subsequent edit keeps it.
      function flipTheme() {
        themeName = themeName === 'light' ? 'dark' : 'light';
        remountOpts.diagram = Object.assign({}, remountOpts.diagram, { theme: themeName });
        remount(currentSource());
      }
      // Zero-JS inspector: a sibling [data-flow-inspector] element captures its innerHTML as the
      // default text and is wired to diagram.inspector() so hover-inspect works without page JS.
      const insEl = el.parentNode && el.parentNode.querySelector
        ? el.parentNode.querySelector('[data-flow-inspector]') : null;
      const insDefault = insEl ? (insEl.innerHTML || '') : '';
      function wireInspector(r) {
        if (insEl && r && r.diagram && typeof r.diagram.inspector === 'function')
          r.diagram.inspector(insEl, insDefault);
      }
      const _renderBars = renderBars;
      renderBars = r => { _renderBars(r); wireInspector(r); };
      renderBars(res);                                                // initial control bars
      if (el.dataset && el.dataset.export != null) renderExportControl(doc, canvas, res.exportPNG);  // opt-in button (once)

      // Opt-in live editing: `data-editable` makes the data-source panel editable; a debounced edit
      // dry-validates then re-mounts the new source into the SAME canvas (keeping the last good diagram
      // on a bad edit).
      if (editable) {
        const delay = el.dataset.debounce != null ? +el.dataset.debounce : 250;
        liveEdit(panel, text => {
          const t = (text || '').trim();
          try { validateSource(t, remountOpts.safe); }
          catch (e) {
            if (current && typeof current.dispose === 'function') current.dispose();  // clear stale diagram
            current = null; canvas.__flowdot = null;
            const g = canvas.getContext && canvas.getContext('2d');
            if (g) g.clearRect(0, 0, canvas.width, canvas.height);
            showError(doc, panel, e.message); return;
          }
          try { remount(t); showError(doc, panel, null); }          // valid again → clear the error frame
          catch (e) { showError(doc, panel, e.message); }           // belt-and-braces (validated above)
        }, delay);
        // Context-aware Ctrl/Cmd+Space completion, on by default for editable panels (opt out with
        // data-autocomplete="off"). Library-level, so example pages get it with zero authored JS.
        if (!(el.dataset.autocomplete === 'off') && opts.autocomplete !== false)
          attachAutocomplete(panel, doc, Object.keys((Scene && Scene.KINDS) || {}));
      }
      out.push(res);
    });
    wirePickers(doc);                                                 // zero-JS playground dropdown, if present
    return out;
  }

  // Auto-render a toggle <button> per mode declared in the source, right after the canvas — so a
  // zero-JS page gets working mode toggles (e.g. `storm`) from the library alone. No-op when the
  // diagram declares no modes, or when the DOM/host can't create the elements (e.g. the node tests
  // with a bare recorder). The library provides the JS; the example page stays free of authored JS.
  function renderModeControls(doc, canvas, res) {
    if (canvas.__fvModes && canvas.__fvModes.remove) canvas.__fvModes.remove();   // drop a prior bar (re-mount)
    canvas.__fvModes = null;
    const rt = res && res.rt;
    if (!rt || typeof rt.modeNames !== 'function' || !rt.modeNames().length) return;
    if (!doc || !doc.createElement || !canvas.parentNode || !canvas.parentNode.insertBefore) return;
    const bar = doc.createElement('div'); bar.className = 'flow-modes';
    rt.modeNames().forEach(name => {
      const b = doc.createElement('button');
      b.type = 'button'; b.textContent = name; b.className = 'flow-mode';
      b.onclick = () => { const on = !rt.modeActive(name); rt.setMode(name, on);
        if (b.classList) b.classList.toggle('on', on); };
      if (bar.appendChild) bar.appendChild(b);
    });
    canvas.parentNode.insertBefore(bar, canvas.nextSibling);
    canvas.__fvModes = bar;
  }

  // Auto-render a transport bar (play/pause · reset · speed) after the canvas — same mechanism as
  // renderModeControls, opt-in via `data-controls` on the <script> or a `controls` line in the source.
  // Wired to Diagram.setPaused/setSpeed + FlowRuntime.reset; the page stays free of authored JS. No-op
  // without a real DOM or a non-diagram target (the node recorder).
  function renderTransportControls(doc, canvas, res) {
    if (canvas.__fvTransport && canvas.__fvTransport.remove) canvas.__fvTransport.remove();  // drop a prior bar (re-mount)
    canvas.__fvTransport = null;
    const diagram = res && res.diagram, rt = res && res.rt;
    if (!diagram || typeof diagram.setPaused !== 'function' || typeof diagram.setSpeed !== 'function') return;
    if (!doc || !doc.createElement || !canvas.parentNode || !canvas.parentNode.insertBefore) return;
    const bar = doc.createElement('div'); bar.className = 'flow-transport';
    const mk = (label, cls) => { const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; b.className = cls; return b; };
    const add = b => { if (bar.appendChild) bar.appendChild(b); };

    const pp = mk(diagram.paused ? 'Play' : 'Pause', 'flow-playpause');
    pp.onclick = () => { const paused = !diagram.paused; diagram.setPaused(paused);
      pp.textContent = paused ? 'Play' : 'Pause'; if (pp.classList) pp.classList.toggle('paused', paused); };
    add(pp);

    const rs = mk('Reset', 'flow-reset');
    rs.onclick = () => {
      if (rt && typeof rt.reset === 'function') rt.reset();
      diagram.now = 0; diagram._lastT = 0;
      if (diagram.flow && Array.isArray(diagram.flow.packets)) diagram.flow.packets.length = 0;
      diagram.setPaused(false); pp.textContent = 'Pause'; if (pp.classList) pp.classList.remove('paused');
      if (typeof diagram.render === 'function') diagram.render();
    };
    add(rs);

    const sbtns = [0.5, 1, 2].map(s => {
      const b = mk(s + '×', 'flow-speed');
      if (s === (diagram.speed || 1) && b.classList) b.classList.add('on');
      b.onclick = () => { diagram.setSpeed(s); sbtns.forEach(x => x.classList && x.classList.toggle('on', x === b)); };
      add(b); return b;
    });

    canvas.parentNode.insertBefore(bar, canvas.nextSibling);
    canvas.__fvTransport = bar;
  }

  // Auto-render a dark↔light theme toggle after the canvas — same mechanism as the mode/transport bars,
  // opt-in via `data-theme-toggle` on the <script> or a `theme-toggle` line in the source. The button
  // shows the ACTIVE theme; clicking calls back (boot re-mounts the source with the flipped theme). The
  // page stays free of authored JS. No-op without a real DOM (the node recorder passes a fake).
  function renderThemeToggle(doc, canvas, themeName, onToggle) {
    if (canvas.__fvTheme && canvas.__fvTheme.remove) canvas.__fvTheme.remove();   // drop a prior bar (re-mount)
    canvas.__fvTheme = null;
    if (!doc || !doc.createElement || !canvas.parentNode || !canvas.parentNode.insertBefore) return;
    const bar = doc.createElement('div'); bar.className = 'flow-theme';
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'flow-themebtn';
    b.textContent = 'Theme: ' + themeName;                             // reflects the ACTIVE theme
    b.onclick = () => onToggle();
    if (bar.appendChild) bar.appendChild(b);
    canvas.parentNode.insertBefore(bar, canvas.nextSibling);
    canvas.__fvTheme = bar;
    return bar;
  }

  // Auto-render a "Ghost" toggle after the canvas — same mechanism as the theme/mode bars, opt-in via
  // `data-ghost-toggle` on the <script> or any `ghost` line in the source. Unlike the theme toggle it
  // needs NO re-mount: it just flips diagram.ghostOn, so the next frame shows/hides the counterfactual
  // overlay. The page stays free of authored JS. No-op without a real DOM or a non-diagram target.
  function renderGhostToggle(doc, canvas, diagram) {
    if (canvas.__fvGhost && canvas.__fvGhost.remove) canvas.__fvGhost.remove();   // drop a prior bar (re-mount)
    canvas.__fvGhost = null;
    if (!diagram || typeof diagram.setGhost !== 'function') return;
    if (!doc || !doc.createElement || !canvas.parentNode || !canvas.parentNode.insertBefore) return;
    const bar = doc.createElement('div'); bar.className = 'flow-ghost';
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'flow-ghostbtn';
    const label = () => 'Ghost: ' + (diagram.ghostOn ? 'on' : 'off');
    b.textContent = label();
    b.onclick = () => { diagram.setGhost(!diagram.ghostOn);
      b.textContent = label(); if (b.classList) b.classList.toggle('on', diagram.ghostOn); };
    if (bar.appendChild) bar.appendChild(b);
    canvas.parentNode.insertBefore(bar, canvas.nextSibling);
    canvas.__fvGhost = bar;
    return bar;
  }

  // prefers-reduced-motion: an explicit opts.reduceMotion wins; else read the media query if present.
  function prefersReducedMotion(opts) {
    if (opts.reduceMotion != null) return !!opts.reduceMotion;
    return (typeof global !== 'undefined' && global.matchMedia)
      ? !!global.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  }

  // prefers-color-scheme: the INITIAL theme when the source names none — 'dark' unless the browser
  // asks for light (so themeless pages/tests without matchMedia stay dark, as before). An explicit
  // `diagram … <theme>` (ir.theme) or an opts.diagram.theme override (the toggle) still wins upstream.
  function prefersColorScheme(opts) {
    if (opts && opts.colorScheme != null) return opts.colorScheme;    // explicit override (tests / hosts)
    return (typeof global !== 'undefined' && global.matchMedia
      && global.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }

  // Accessibility: label the canvas (role/aria-label/title from the diagram title) and give it a native
  // text fallback — a <ul> of nodes/edges as canvas child content, read by screen readers / shown when
  // the canvas can't render. No-op for a headless recorder (no `.cv` element).
  function applyA11y(diagram, ir) {
    const cv = diagram && diagram.cv;
    if (!cv || !cv.setAttribute) return;
    const label = ir.title || 'Flowdot diagram';
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', label); cv.title = label;
    const doc = cv.ownerDocument;
    if (!doc || !doc.createElement || !cv.appendChild) return;
    const end = r => Array.isArray(r) ? String(r[0]) : String(r);
    const ul = doc.createElement('ul');
    (ir.nodes || []).forEach(n => { const li = doc.createElement('li'); li.textContent = (n.name || n.id) + ' — ' + n.kind; ul.appendChild(li); });
    (ir.edges || []).forEach(e => { const li = doc.createElement('li'); li.textContent = end(e.from) + ' → ' + end(e.to); ul.appendChild(li); });
    while (cv.firstChild) cv.removeChild(cv.firstChild);             // replace any prior fallback (re-mount)
    cv.appendChild(ul);
  }

  // Save the current canvas frame as a PNG — native `canvas.toBlob` + a download link, zero-dep.
  // Returns a no-arg trigger; a no-op in a headless env (no toBlob / no createElement).
  function exportPNG(canvas, doc, name) {
    const file = String(name || 'diagram').replace(/[^\w.-]+/g, '-') + '.png';
    return () => {
      if (!canvas || !canvas.toBlob || !doc || !doc.createElement) return;
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : null;
        const a = doc.createElement('a'); a.href = url || ''; a.download = file;
        if (a.click) a.click();
        if (url && URL.revokeObjectURL) URL.revokeObjectURL(url);
      });
    };
  }
  // Insert an opt-in "PNG" button after the canvas (mirrors renderModeControls' placement).
  function renderExportControl(doc, canvas, trigger) {
    if (!doc || !doc.createElement || !canvas.parentNode || !canvas.parentNode.insertBefore) return;
    const b = doc.createElement('button');
    b.type = 'button'; b.textContent = 'PNG'; b.className = 'flow-export';
    b.onclick = trigger;
    canvas.parentNode.insertBefore(b, canvas.nextSibling);
  }

  // Dry-validate a source WITHOUT touching the canvas: parse + build + compile flows into a throwaway
  // recorder. Throws the same located error a real mount would — so an editable panel can catch it
  // and keep the last good diagram instead of tearing it down. Returns nothing; it's the throw we want.
  function validateSource(text, safe) {
    const ir = Flow.parse(text, { safe: !!safe });                 // parse errors (+ safe-mode gate)
    const built = Scene.build(ir);                                 // default recorder; build errors (kind/dup/lane/rail)
    Scene.buildFlows(ir, { byId: built.byId, diagram: built.diagram });   // flow errors (unknown route node)
  }

  // Show / clear a located error near the source panel (a `.flow-error` element inserted after it, on
  // demand) and apply a red outline to the source panel itself as an immediate visual signal.
  // No-op without a DOM.
  function showError(doc, panel, msg) {
    if (!panel) return;
    if (panel.style) panel.style.outline = msg ? '2px solid #e64747' : '';  // instant red frame
    let box = panel.__fvError;
    if (msg) {
      if (!box && doc && doc.createElement && panel.parentNode && panel.parentNode.insertBefore) {
        box = doc.createElement('div'); box.className = 'flow-error';
        panel.parentNode.insertBefore(box, panel.nextSibling); panel.__fvError = box;
      }
      if (box) { box.textContent = msg; if (box.style) box.style.display = ''; }
    } else if (box) { box.textContent = ''; if (box.style) box.style.display = 'none'; }
  }

  // Debounced live-edit wiring: make `panel` editable and, after `delay` ms quiet since the last
  // `input`, call `remount(text)`. Rapid keystrokes collapse to ONE remount. Returns a disposer that
  // removes the listener + cancels a pending timer. Pure enough to unit-test with a fake panel.
  function liveEdit(panel, remount, delay) {
    if (!panel || !panel.addEventListener) return () => {};
    if ('readOnly' in panel) panel.readOnly = false;              // the source textarea becomes editable
    delay = delay == null ? 250 : delay;
    let timer = null;
    const onInput = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null;
        remount(panel.value != null ? panel.value : (panel.textContent || '')); }, delay);
    };
    panel.addEventListener('input', onInput);
    return () => { if (timer) clearTimeout(timer);
      if (panel.removeEventListener) panel.removeEventListener('input', onInput); };
  }

  // Playground picker (zero page-JS): a `<select data-flow-picker="#panel">` is auto-populated with an
  // option per `<script type="text/flow" data-tpl="Name">` template on the page; choosing one loads that
  // template's source into the editable `#panel` and dispatches `input`, so the existing live-edit path
  // re-mounts it. The editor itself is a normal `data-flowdot data-editable` block whose panel is #panel.
  function wirePickers(doc) {
    if (!doc || !doc.querySelectorAll || !doc.querySelector || !doc.createElement) return;
    doc.querySelectorAll('select[data-flow-picker]').forEach(sel => {
      const panel = doc.querySelector(sel.dataset.flowPicker);
      const tpls = Array.prototype.slice.call(doc.querySelectorAll('script[type="text/flow"][data-tpl]'));
      if (!panel || !tpls.length) return;
      if (sel.appendChild && (!sel.options || !sel.options.length)) {           // populate options from templates
        tpls.forEach((t, i) => { const o = doc.createElement('option');
          o.value = String(i); o.textContent = (t.dataset && t.dataset.tpl) || ('example ' + i); sel.appendChild(o); });
      }
      const load = () => { const t = tpls[+(sel.value || 0)]; if (!t) return;
        const text = (t.textContent || '').trim();
        if ('value' in panel) panel.value = text;
        if (panel.dispatchEvent) panel.dispatchEvent(typeof Event === 'function' ? new Event('input') : { type: 'input' });
      };
      if (sel.addEventListener) sel.addEventListener('change', load);
      load();                                                                    // load the initial selection
    });
  }

  // ── Context-aware autocomplete for the editable panel ──────────────────────────────────────────
  // Statement keywords offered at the start of a line.
  const KEYWORDS = ['diagram', 'flow', 'seed', 'theme', 'set', 'import', 'model', 'colors',
    'lane', 'rail', 'zone', 'node', 'edge', 'road', 'flow', 'mode', 'every', 'on', 'call', 'note', 'legend', 'join'];

  // Best-effort scan of the declared `lane`/`rail` ids in a (possibly mid-edit) source. Tolerant of
  // parse errors — a regex, not the parser — and understands the pipe form `lane a|b|c`.
  function declaredTracks(text, kw) {
    const ids = [], re = new RegExp('^\\s*' + kw + '\\s+(\\S+)', 'gm');
    let m;
    while ((m = re.exec(text))) m[1].split('|').forEach(id => { if (id && ids.indexOf(id) < 0) ids.push(id); });
    return ids;
  }

  // PURE completion: given the full text + caret offset (+ the known kinds), return { items, from, to }
  // — the words to offer and the [from,to) span the chosen word replaces. Three contexts: after
  // `lane:`/`rail:` → declared track ids; the kind slot of a `node <id> ` line → kinds; the start of a
  // line → statement keywords. No DOM — unit-testable on its own.
  function suggest(text, caret, kinds) {
    text = text || ''; caret = caret == null ? text.length : caret;
    const before = text.slice(0, caret);
    const head = before.slice(before.lastIndexOf('\n') + 1);         // current line up to the caret
    const pick = (pool, partial) => {
      const p = partial.toLowerCase();
      return { items: pool.filter(w => w.toLowerCase().indexOf(p) === 0 && w !== partial), from: caret - partial.length, to: caret };
    };
    let m;
    if ((m = /\b(lane|rail):([\w-]*)$/.exec(head))) return pick(declaredTracks(text, m[1]), m[2]);
    if ((m = /^\s*node\s+[\w-]+\s+([\w-]*)$/.exec(head))) return pick(kinds || [], m[1]);
    if ((m = /^\s*([\w-]*)$/.exec(head))) return pick(KEYWORDS, m[1]);
    return { items: [], from: caret, to: caret };
  }

  // Wire Ctrl/Cmd+Space completion onto an editable panel: a small popup of context suggestions with
  // arrow-key navigation, Enter/Tab to accept (dispatches `input` so the existing live-edit remounts),
  // Escape/blur to dismiss. Defensive — a no-op without a real DOM. Returns a disposer.
  function attachAutocomplete(panel, doc, kinds) {
    if (!panel || !panel.addEventListener || !doc || !doc.createElement) return () => {};
    let box = null, items = [], sel = 0, span = null;
    const getText = () => (panel.value != null ? panel.value : (panel.textContent || ''));
    const caret = () => (panel.selectionStart != null ? panel.selectionStart : getText().length);
    const close = () => { items = []; if (box && box.style) box.style.display = 'none'; };
    const ensureBox = () => {
      if (box) return box;
      box = doc.createElement('div'); box.className = 'flow-suggest';
      if (box.style) box.style.cssText = 'position:absolute;z-index:50;background:#0f1724;color:#e8f0fb;'
        + 'border:1px solid #23324a;border-radius:6px;max-height:170px;overflow:auto;'
        + 'font:12px ui-monospace,monospace;box-shadow:0 4px 14px rgba(0,0,0,.4)';
      if (panel.parentNode && panel.parentNode.insertBefore) panel.parentNode.insertBefore(box, panel.nextSibling);
      return box;
    };
    const render = () => {
      const b = ensureBox();
      if (b.replaceChildren) b.replaceChildren(); else if ('innerHTML' in b) b.innerHTML = '';
      items.forEach((w, i) => {
        const it = doc.createElement('div');
        it.className = 'flow-suggest-item' + (i === sel ? ' sel' : '');
        if (it.style) it.style.cssText = 'padding:3px 10px;cursor:pointer;white-space:nowrap'
          + (i === sel ? ';background:#1d2b44' : '');
        it.textContent = w;
        if (it.addEventListener) it.addEventListener('mousedown', ev => { if (ev.preventDefault) ev.preventDefault(); accept(i); });
        if (b.appendChild) b.appendChild(it);
      });
      if (b.style) b.style.display = items.length ? '' : 'none';
    };
    const open = () => {
      const r = suggest(getText(), caret(), kinds); items = r.items; span = r; sel = 0;
      if (!items.length) { close(); return; }
      render(); place();
    };
    const accept = i => {
      if (!items.length) return;
      const w = items[i == null ? sel : i], t = getText(), pos = span.from + w.length;
      if ('value' in panel) panel.value = t.slice(0, span.from) + w + t.slice(span.to);
      if (panel.setSelectionRange) panel.setSelectionRange(pos, pos);
      close();
      if (panel.dispatchEvent) panel.dispatchEvent(typeof Event === 'function' ? new Event('input') : { type: 'input' });
    };
    /* node:coverage disable */                                      // pixel positioning — browser layout only
    const place = () => {
      if (!box || !box.style || !panel.getBoundingClientRect) return;
      try {
        const rect = panel.getBoundingClientRect(), t = getText().slice(0, caret()), lines = t.split('\n');
        const cs = (typeof getComputedStyle === 'function') ? getComputedStyle(panel) : null;
        const lh = (cs && parseFloat(cs.lineHeight)) || 16, ch = 7;
        const pT = (cs && parseFloat(cs.paddingTop)) || 8, pL = (cs && parseFloat(cs.paddingLeft)) || 8;
        const sY = typeof scrollY === 'number' ? scrollY : 0, sX = typeof scrollX === 'number' ? scrollX : 0;
        box.style.top = Math.round(rect.top + sY + pT + lines.length * lh - (panel.scrollTop || 0)) + 'px';
        box.style.left = Math.round(rect.left + sX + pL + lines[lines.length - 1].length * ch) + 'px';
      } catch (e) { /* leave unpositioned */ }
    };
    /* node:coverage enable */
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && (e.key === ' ' || e.code === 'Space' || e.keyCode === 32)) {
        if (e.preventDefault) e.preventDefault(); open(); return;
      }
      if (!items.length) return;
      const k = e.key;
      if (k === 'ArrowDown') { sel = (sel + 1) % items.length; render(); if (e.preventDefault) e.preventDefault(); }
      else if (k === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; render(); if (e.preventDefault) e.preventDefault(); }
      else if (k === 'Enter' || k === 'Tab') { accept(); if (e.preventDefault) e.preventDefault(); }
      else if (k === 'Escape') { close(); if (e.preventDefault) e.preventDefault(); }
    };
    panel.addEventListener('keydown', onKey);
    panel.addEventListener('blur', close);
    return () => { if (panel.removeEventListener) { panel.removeEventListener('keydown', onKey); panel.removeEventListener('blur', close); } };
  }

  const API = { mount, boot, liveEdit, wirePickers, suggest, attachAutocomplete, exportPNG, applyA11y, prefersReducedMotion, prefersColorScheme, renderTransportControls, renderThemeToggle };
  if (isNode) module.exports = API;
  /* node:coverage disable */                         // browser UMD tail: attach + auto-boot on DOMContentLoaded — unreachable under node
  else {
    if (global.Flowdot) { global.Flowdot.mount = mount; global.Flowdot.boot = boot; }
    // auto-boot opted-in sources once the DOM is ready (no-op if there are none)
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
      else boot();
    }
  }
  /* node:coverage enable */
})(typeof window !== 'undefined' ? window : globalThis);
