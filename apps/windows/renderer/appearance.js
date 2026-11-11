"use strict";
// Artwork and both ambient canvases share the image's crop and fade. Motion only
// runs while the window can be seen and the saved accessibility choice allows it.
(()=>{
  const root=document.documentElement,main=document.querySelector("main");
  const {SCENES,getScene,sceneTransform}=window.JunctionScenes;
  const ambient=document.createElement("div");ambient.id="ambient";ambient.setAttribute("aria-hidden","true");
  const sceneFrame=document.createElement("div");sceneFrame.className="scene-frame";
  const art=document.createElement("div");art.className="art";const wash=document.createElement("div");wash.className="wash";
  const effects=document.createElement("canvas");effects.className="scene-effects";
  const canvas=document.createElement("canvas");canvas.className="petals";
  sceneFrame.append(art,effects,canvas);ambient.append(sceneFrame,wash);main.prepend(ambient);
  const reducedQuery=window.matchMedia("(prefers-reduced-motion: reduce)");
  let settings={mode:"system",palette:"junction",artwork:"none",backgroundIntensity:55,petals:true,petalIntensity:35,motion:"system"};
  let scene=getScene("none"),transform=null;
  root.dataset.artwork="none";

  // ── Scene animation ──────────────────────────────────────────────
  const FRAME_MS=1000/24; // calm motion does not need 60 fps; keep the GPU for inference
  let petals=[],frame=0,last=0,focused=document.hasFocus();
  const motionAllowed=()=>settings.motion==="full"||(settings.motion==="system"&&!reducedQuery.matches);
  const shouldRun=()=>settings.artwork!=="none"&&settings.petals&&settings.petalIntensity>0&&motionAllowed()&&document.visibilityState==="visible"&&focused;
  function seed(width,height,spread=true){
    const count=Math.round(2+settings.petalIntensity/100*7);
    petals=Array.from({length:count},()=>spawn(width,height,spread));
  }
  function spawn(width,height,spread){
    return {x:width*(0.55+Math.random()*0.45),y:spread?Math.random()*height:-20-Math.random()*height*0.3,size:6+Math.random()*5,speed:15+Math.random()*17,drift:-(6+Math.random()*12),phase:Math.random()*Math.PI*2,spin:(Math.random()-.5)*0.6,angle:Math.random()*Math.PI,alpha:.28+Math.random()*.32};
  }
  function resize(){
    const ratio=Math.min(2,window.devicePixelRatio||1),{width,height}=sceneFrame.getBoundingClientRect();
    for(const layer of [effects,canvas]){layer.width=Math.round(width*ratio);layer.height=Math.round(height*ratio);layer.getContext("2d").setTransform(width?layer.width/width:ratio,0,0,height?layer.height/height:ratio,0,0);}
    transform=sceneTransform(scene,width,height);
  }
  function sourceContext(layer){
    const context=layer.getContext("2d");context.save();context.translate(transform.left,transform.top);context.scale(transform.scale,transform.scale);return context;
  }
  function streamPoint(stream,progress){
    const position=Math.max(0,Math.min(.99999,progress))*(stream.points.length-1),index=Math.floor(position),mix=position-index;
    const a=stream.points[index],b=stream.points[index+1];
    return [(a[0]+(b[0]-a[0])*mix)*scene.width,(a[1]+(b[1]-a[1])*mix)*scene.height];
  }
  function drawEffects(now){
    if(settings.backgroundIntensity===0)return;
    const context=sourceContext(effects),strength=settings.petalIntensity/100;
    for(const light of scene.lights){
      const x=light.x*scene.width,y=light.y*scene.height,radius=light.radius*scene.width;
      const alpha=(.14+.09*Math.sin(now/2100+light.phase))*strength;
      const glow=context.createRadialGradient(x,y,0,x,y,radius);
      glow.addColorStop(0,`rgba(${light.color},${alpha})`);glow.addColorStop(.3,`rgba(${light.color},${alpha*.5})`);glow.addColorStop(1,`rgba(${light.color},0)`);
      context.fillStyle=glow;context.fillRect(x-radius,y-radius,radius*2,radius*2);
    }
    context.lineCap="round";
    for(const stream of scene.waterfalls){
      const count=Math.round(1+strength*3);
      for(let index=0;index<count;index++){
        const progress=(now/4800+index/count+stream.phase)%1;
        const head=streamPoint(stream,progress),tail=streamPoint(stream,Math.max(0,progress-.065));
        const highlight=context.createLinearGradient(...tail,...head);
        highlight.addColorStop(0,"rgba(149,217,255,0)");highlight.addColorStop(1,`rgba(167,228,255,${.34*strength})`);
        context.strokeStyle=highlight;context.lineWidth=stream.width*(.6+.15*Math.sin(now/1300+index));
        context.beginPath();context.moveTo(...tail);context.lineTo(...head);context.stroke();
      }
    }
    for(const reflection of scene.reflections){
      const x=reflection.x*scene.width,y=reflection.y*scene.height;
      const shimmer=.5+.5*Math.sin(now/1700+reflection.phase);
      context.strokeStyle=`rgba(${reflection.color},${(.08+.12*shimmer)*strength})`;context.lineWidth=1.8;
      context.beginPath();context.moveTo(x,y);context.lineTo(x+Math.sin(now/1300+reflection.phase)*1.7,y+reflection.length*scene.height);context.stroke();
    }
    for(const zone of scene.rain){
      context.save();context.beginPath();context.rect(zone.x*scene.width,zone.y*scene.height,zone.width*scene.width,zone.height*scene.height);context.clip();
      const count=Math.max(1,Math.round(zone.count*strength));
      for(let index=0;index<count;index++){
        const progress=(now/1900+index*.381966)%1,x=(zone.x+((index*.618034+.13)%1)*zone.width)*scene.width,y=(zone.y+progress*zone.height)*scene.height;
        context.strokeStyle=`rgba(172,202,229,${Math.sin(progress*Math.PI)*.17*strength})`;context.lineWidth=1;
        context.beginPath();context.moveTo(x,y);context.lineTo(x-2,y+8+(index*7%10));context.stroke();
      }
      context.restore();
    }
    context.restore();
  }
  function draw(now){
    frame=0;if(!shouldRun()){clear();return;}
    frame=requestAnimationFrame(draw);
    if(now-last<FRAME_MS)return;
    const dt=Math.min(0.1,(now-(last||now))/1000);last=now;
    clear();if(!transform)return;
    drawEffects(now);
    const context=sourceContext(canvas),width=scene.width,height=scene.height;
    const light=window.matchMedia("(prefers-color-scheme: light)").matches;
    for(const petal of petals){
      petal.y+=petal.speed*dt;petal.x+=(petal.drift+Math.sin(now/1600+petal.phase)*6)*dt;petal.angle+=petal.spin*dt;
      if(petal.y>height+20||petal.x<-20)Object.assign(petal,spawn(width,height,false));
      context.save();context.translate(petal.x,petal.y);context.rotate(petal.angle);
      context.fillStyle=light?`rgba(201,122,143,${petal.alpha*.7})`:`rgba(236,188,203,${petal.alpha})`;
      context.beginPath();context.ellipse(0,0,petal.size,petal.size*.55,0,0,Math.PI*2);context.fill();context.restore();
    }
    context.restore();
  }
  function clear(){for(const layer of [effects,canvas]){const context=layer.getContext("2d");context.save();context.setTransform(1,0,0,1,0,0);context.clearRect(0,0,layer.width,layer.height);context.restore();}}
  function syncAnimation(){if(shouldRun()){if(!frame){resize();if(!petals.length)seed(scene.width,scene.height);last=0;frame=requestAnimationFrame(draw);}}else{if(frame)cancelAnimationFrame(frame);frame=0;clear();}}
  document.addEventListener("visibilitychange",syncAnimation);
  window.addEventListener("focus",()=>{focused=true;syncAnimation();});
  window.addEventListener("blur",()=>{focused=false;syncAnimation();});
  new ResizeObserver(()=>{resize();if(frame)seed(scene.width,scene.height);}).observe(sceneFrame);
  reducedQuery.addEventListener("change",()=>{root.dataset.motion=motionAllowed()?"full":"reduced";syncAnimation();});

  function apply(value){
    settings={...settings,...value};
    root.dataset.palette=settings.palette;root.dataset.artwork=settings.artwork;
    root.dataset.pastel=String(["lavender","peach","mint","sky","butter"].includes(settings.palette));
    root.dataset.motion=motionAllowed()?"full":"reduced";
    root.style.setProperty("--art-intensity",String(settings.backgroundIntensity/100));
    scene=getScene(settings.artwork);
    sceneFrame.style.aspectRatio=scene.asset?`${scene.width}/${scene.height}`:"941/1672";
    art.style.backgroundImage=scene.asset?`url("${scene.asset}")`:"none";
    petals=[];resize();seed(scene.width,scene.height);syncAnimation();
  }

  // ── Settings panel ────────────────────────────────────────────────
  const panel=document.createElement("article");panel.id="appearance-settings";
  panel.innerHTML='<div><h2>Appearance</h2><p>Choose a colour palette and wallpaper independently. Scenes stay at the edges, with gentle optional animation.</p><div class="appearance-grid"></div></div>';
  const grid=panel.querySelector(".appearance-grid");
  const field=(label,control)=>{const wrapper=document.createElement("label");wrapper.textContent=label;wrapper.append(control);grid.append(wrapper);return control;};
  const select=(options)=>{const node=document.createElement("select");for(const [value,text] of options){const option=document.createElement("option");option.value=value;option.textContent=text;node.append(option);}return node;};
  const range=()=>{const node=document.createElement("input");node.type="range";node.min="0";node.max="100";node.step="5";return node;};
  const mode=field("Light / dark",select([["system","Match Windows"],["light","Light"],["dark","Dark"]]));
  const palette=field("Colour palette",select([["junction","Junction blue (default)"],["sakura","Sakura (muted rose)"],["moss","Moss (soft green)"],["lavender","Lavender"],["peach","Peach"],["mint","Mint"],["sky","Sky"],["butter","Buttercream"]]));
  const artwork=field("Wallpaper",select(Object.entries(SCENES).map(([id,scene])=>[id,scene.label])));
  const intensity=field("Wallpaper intensity",range());
  const petalToggle=document.createElement("input");petalToggle.type="checkbox";const petalLabel=document.createElement("label");petalLabel.className="inline";petalLabel.append(petalToggle," Scene animation");grid.append(petalLabel);
  const petalAmount=field("Animation intensity",range());
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
