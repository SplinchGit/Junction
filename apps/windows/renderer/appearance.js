"use strict";
// Appearance: palette and artwork attributes on <html>, an artwork layer, and a separate
// petal canvas that only runs while it can be seen and motion is allowed.
(()=>{
  const root=document.documentElement,main=document.querySelector("main");
  const ambient=document.createElement("div");ambient.id="ambient";ambient.setAttribute("aria-hidden","true");
  const art=document.createElement("div");art.className="art";const wash=document.createElement("div");wash.className="wash";const canvas=document.createElement("canvas");
  ambient.append(art,wash,canvas);main.prepend(ambient);
  const reducedQuery=window.matchMedia("(prefers-reduced-motion: reduce)");
  let settings={mode:"system",palette:"junction",artwork:"none",backgroundIntensity:55,petals:true,petalIntensity:35,motion:"system"};

  // ── Petals ────────────────────────────────────────────────────────
  const FRAME_MS=1000/24; // calm motion does not need 60 fps; keep the GPU for inference
  let petals=[],frame=0,last=0,focused=document.hasFocus();
  const motionAllowed=()=>settings.motion==="full"||(settings.motion==="system"&&!reducedQuery.matches);
  const shouldRun=()=>settings.artwork!=="none"&&settings.petals&&settings.petalIntensity>0&&motionAllowed()&&document.visibilityState==="visible"&&focused;
  function seed(width,height,spread=true){
    const count=Math.round(2+settings.petalIntensity/100*10);
    petals=Array.from({length:count},()=>spawn(width,height,spread));
  }
  function spawn(width,height,spread){
    // Petals leave from the tree's side of the window and drift slowly down and left.
    return {x:width*(0.55+Math.random()*0.5),y:spread?Math.random()*height:-20-Math.random()*height*0.3,size:4+Math.random()*4,speed:9+Math.random()*10,drift:-(4+Math.random()*8),phase:Math.random()*Math.PI*2,spin:(Math.random()-.5)*0.6,angle:Math.random()*Math.PI,alpha:.28+Math.random()*.32};
  }
  function resize(){const ratio=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(canvas.clientWidth*ratio);canvas.height=Math.round(canvas.clientHeight*ratio);canvas.getContext("2d").setTransform(ratio,0,0,ratio,0,0);}
  function draw(now){
    frame=0;if(!shouldRun()){clear();return;}
    frame=requestAnimationFrame(draw);
    if(now-last<FRAME_MS)return;
    const dt=Math.min(0.1,(now-(last||now))/1000);last=now;
    const context=canvas.getContext("2d"),width=canvas.clientWidth,height=canvas.clientHeight;
    context.clearRect(0,0,width,height);
    const light=window.matchMedia("(prefers-color-scheme: light)").matches;
    for(const petal of petals){
      petal.y+=petal.speed*dt;petal.x+=(petal.drift+Math.sin(now/1600+petal.phase)*6)*dt;petal.angle+=petal.spin*dt;
      if(petal.y>height+20||petal.x<-20)Object.assign(petal,spawn(width,height,false));
      context.save();context.translate(petal.x,petal.y);context.rotate(petal.angle);
      context.fillStyle=light?`rgba(201,122,143,${petal.alpha*.7})`:`rgba(236,188,203,${petal.alpha})`;
      context.beginPath();context.ellipse(0,0,petal.size,petal.size*.55,0,0,Math.PI*2);context.fill();context.restore();
    }
  }
  function clear(){const context=canvas.getContext("2d");context.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);}
  function syncAnimation(){if(shouldRun()){if(!frame){resize();if(!petals.length)seed(canvas.clientWidth,canvas.clientHeight);last=0;frame=requestAnimationFrame(draw);}}else{if(frame)cancelAnimationFrame(frame);frame=0;clear();}}
  document.addEventListener("visibilitychange",syncAnimation);
  window.addEventListener("focus",()=>{focused=true;syncAnimation();});
  window.addEventListener("blur",()=>{focused=false;syncAnimation();});
  window.addEventListener("resize",()=>{if(frame){resize();seed(canvas.clientWidth,canvas.clientHeight);}});
  reducedQuery.addEventListener("change",syncAnimation);

  function apply(value){
    settings={...settings,...value};
    root.dataset.palette=settings.palette;root.dataset.artwork=settings.artwork;
    root.dataset.motion=motionAllowed()?"full":"reduced";
    root.style.setProperty("--art-intensity",String(settings.backgroundIntensity/100));
    petals=[];syncAnimation();
  }

  // ── Settings panel ────────────────────────────────────────────────
  const panel=document.createElement("article");panel.id="appearance-settings";
  panel.innerHTML='<div><h2>Appearance</h2><p>Light or dark, a colour palette, and optional artwork. Artwork stays at the edges; chat and input surfaces remain solid.</p><div class="appearance-grid"></div></div>';
  const grid=panel.querySelector(".appearance-grid");
  const field=(label,control)=>{const wrapper=document.createElement("label");wrapper.textContent=label;wrapper.append(control);grid.append(wrapper);return control;};
  const select=(options)=>{const node=document.createElement("select");for(const [value,text] of options){const option=document.createElement("option");option.value=value;option.textContent=text;node.append(option);}return node;};
  const range=()=>{const node=document.createElement("input");node.type="range";node.min="0";node.max="100";node.step="5";return node;};
  const mode=field("Light / dark",select([["system","Match Windows"],["light","Light"],["dark","Dark"]]));
  const palette=field("Colour palette",select([["junction","Junction blue (default)"],["sakura","Sakura (muted rose)"],["moss","Moss (soft green)"]]));
  const artwork=field("Artwork",select([["none","None"],["sakura-mountain","Sakura Mountain"]]));
  const intensity=field("Artwork intensity",range());
  const petalToggle=document.createElement("input");petalToggle.type="checkbox";const petalLabel=document.createElement("label");petalLabel.className="inline";petalLabel.append(petalToggle," Falling petals (with artwork)");grid.append(petalLabel);
  const petalAmount=field("Petal amount",range());
  const motion=field("Motion",select([["system","Follow Windows (reduced motion respected)"],["reduced","Reduced: no animation"],["full","Full"]]));
  function show(){mode.value=settings.mode;palette.value=settings.palette;artwork.value=settings.artwork;intensity.value=String(settings.backgroundIntensity);petalToggle.checked=settings.petals;petalAmount.value=String(settings.petalIntensity);motion.value=settings.motion;const art=settings.artwork!=="none";intensity.disabled=!art;petalToggle.disabled=!art;petalAmount.disabled=!art||!settings.petals;}
  async function save(patch){try{apply(await window.junction.setAppearance(patch));show();}catch(error){const node=document.getElementById("error");if(node){node.textContent=error.message;node.classList.add("show");}}}
  mode.onchange=()=>save({mode:mode.value});palette.onchange=()=>save({palette:palette.value});artwork.onchange=()=>save({artwork:artwork.value});
  intensity.onchange=()=>save({backgroundIntensity:Number(intensity.value)});intensity.oninput=()=>root.style.setProperty("--art-intensity",String(Number(intensity.value)/100));
  petalToggle.onchange=()=>save({petals:petalToggle.checked});petalAmount.onchange=()=>save({petalIntensity:Number(petalAmount.value)});motion.onchange=()=>save({motion:motion.value});
  document.querySelector(".settings")?.prepend(panel);

  window.junction.appearance().then(value=>{apply(value);show();}).catch(()=>show());
  window.JunctionAppearance={apply,settings:()=>({...settings}),running:()=>Boolean(frame)};
})();
