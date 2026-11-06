import * as THREE from './vendor/three.module.min.js';
import { boardData as data } from './board-data.js';

const clamp = (v, a=0, b=1) => Math.min(b, Math.max(a, v));
const WORLD_WIDTH = 18;
const scale = WORLD_WIDTH / data.width;
const world = p => new THREE.Vector3((p[0]-data.width/2)*scale, (data.height/2-p[1])*scale, 0);
const origin = world(data.epicenter);
const descriptions = {
  wave: ['Epicenter', 'One impulse. Every route unfolds.'],
  cascade: ['Route cascade', 'Eight branches. A syncopated chain reaction.'],
  bloom: ['Spiral bloom', 'A compressed paper constellation opens outward.']
};

const vertexShader = /* glsl */`
  attribute vec3 aPivot;
  attribute vec3 aAxis;
  attribute vec3 aCenter;
  attribute vec4 aTiming;
  attribute vec3 aPaper;
  uniform float uTime;
  uniform float uVariant;
  uniform vec3 uOrigin;
  varying vec2 vUv;
  varying float vOpacity;
  varying float vShade;
  varying float vProgress;
  varying vec3 vPaper;
  vec3 rotateAxis(vec3 p, vec3 a, float t) {
    return p*cos(t) + cross(a,p)*sin(t) + a*dot(a,p)*(1.0-cos(t));
  }
  void main() {
    float p = clamp((uTime-aTiming.x)/aTiming.y,0.0,1.0);
    float e = 1.0-pow(1.0-p,3.0);
    float a = aTiming.z*(1.0-e) - sin(p*3.14159265)*0.10;
    vec3 point = position;
    point = aCenter + (point-aCenter)*mix(0.055,1.0,smoothstep(0.0,0.30,p));
    point = aPivot + rotateAxis(point-aPivot,aAxis,a);
    if (uVariant > 1.5) {
      vec3 delta = point-uOrigin;
      float spiral = (1.0-e)*0.62;
      point.xy = uOrigin.xy + mat2(cos(spiral),-sin(spiral),sin(spiral),cos(spiral))*delta.xy*mix(0.16,1.0,e);
      point.z += sin(p*3.14159265)*(0.8+aTiming.w*0.3);
    } else {
      point.z += sin(p*3.14159265)*(uVariant > 0.5 ? 0.46 : 0.22);
    }
    vec3 n = rotateAxis(vec3(0.0,0.0,1.0),aAxis,a);
    vShade = mix(0.66+0.28*abs(dot(n,normalize(vec3(-0.3,0.5,1.0)))),1.0,smoothstep(0.68,1.0,p));
    vOpacity = smoothstep(0.0,0.10,p);
    vProgress = p;
    vUv = uv;
    vPaper = aPaper;
    gl_Position = projectionMatrix*modelViewMatrix*vec4(point,1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform sampler2D uAtlas;
  uniform float uAlpha;
  uniform float uLabels;
  varying vec2 vUv;
  varying float vOpacity;
  varying float vShade;
  varying float vProgress;
  varying vec3 vPaper;
  void main() {
    vec4 ink = texture2D(uAtlas,vUv);
    float alpha = ink.a*vOpacity*uAlpha;
    if (alpha < 0.012) discard;
    vec3 face = ink.rgb*vShade;
    if (!gl_FrontFacing && uLabels < 0.5) face = mix(vPaper,vec3(1.0),0.68)*vShade;
    gl_FragColor = vec4(face,alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class OrigamiBoard extends EventTarget {
  constructor(container, options={}) {
    super();
    this.container=container;
    this.variant=options.variant || 'wave';
    this.duration=clamp(Number(options.duration)||7,5,10);
    this.sound=false;
    this.time=0;
    this.playing=false;
    this.raf=0;
    this.destroyed=false;
    this.pan=new THREE.Vector2();
    this.panEnabled=options.pan!==false;
    this.zoom=1;
    this.maxZoom=12;
    this.zoomEnabled=options.zoom!==false;
    this.pointers=new Map();
    this.scene=new THREE.Scene();
    this.group=new THREE.Group();
    this.scene.add(this.group);
    this.camera=new THREE.PerspectiveCamera(32,1,0.1,120);
    this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    this.renderer.setClearColor(0x000000,0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-label','AI and Design subway map unfolding outward in a wave of hinged origami tiles');
    this.renderer.domElement.setAttribute('role','img');
    this.renderer.domElement.tabIndex=0;
    this.renderer.domElement.setAttribute('aria-description','After the unfolding finishes, scroll or pinch to zoom and drag to pan. Arrow keys move the board; plus and minus zoom; Home or a double-click resets the view.');
    this.renderer.domElement.style.cssText='display:block;width:100%;height:100%;background:transparent';
    container.appendChild(this.renderer.domElement);
    this.bindPanning();
    this.observer=new ResizeObserver(()=>this.resize());
    this.observer.observe(container);
    this.ready=this.load();
  }

  async load() {
    const loader=new THREE.TextureLoader();
    const [atlas,labels]=await Promise.all([
      loader.loadAsync(new URL('./board.png',import.meta.url).href),
      loader.loadAsync(new URL('./labels.png',import.meta.url).href)
    ]);
    if(this.destroyed) {atlas.dispose();labels.dispose();return this;}
    this.textures=[atlas,labels];
    for(const t of this.textures){t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());}
    this.materials=[atlas,labels].map((texture,i)=>new THREE.ShaderMaterial({
      uniforms:{uAtlas:{value:texture},uTime:{value:0},uVariant:{value:0},uOrigin:{value:origin},uAlpha:{value:1},uLabels:{value:i}},
      vertexShader,fragmentShader,side:THREE.DoubleSide,transparent:true,depthWrite:true,depthTest:true
    }));
    this.finalMaterial=new THREE.MeshBasicMaterial({map:atlas,transparent:true,side:THREE.FrontSide,depthWrite:false});
    this.final=new THREE.Mesh(new THREE.PlaneGeometry(WORLD_WIDTH,data.height*scale),this.finalMaterial);
    this.final.visible=false;
    this.group.add(this.final);
    this.build();
    this.resize();
    this.seek(window.matchMedia('(prefers-reduced-motion: reduce)').matches?this.duration:0);
    this.dispatchEvent(new Event('ready'));
    return this;
  }

  pieces() {
    const labels=[];
    for(const [x0,y0,x1,y1] of data.labelCells){
      labels.push({kind:'label',points:[[x0,y0],[x1,y0],[x1,y1]]});
      labels.push({kind:'label',points:[[x0,y0],[x1,y1],[x0,y1]]});
    }
    return [data.pieces,labels];
  }

  timing(center, kind, index) {
    const dx=center.x-origin.x,dy=center.y-origin.y;
    const radius=Math.hypot(dx,dy)/10.9;
    const angle=(Math.atan2(dy,dx)+Math.PI*2)%(Math.PI*2);
    const branch=Math.floor(angle/(Math.PI/4));
    const jitter=(Math.sin(index*21.71)*0.5+0.5);
    const kindDelay=kind==='card'?0.12:kind==='label'?0.16:0;
    let start=0.025+Math.pow(radius,0.82)*0.66+kindDelay;
    let length=kind==='tile'?0.125:0.105;
    if(this.variant==='cascade'){
      const beats=[0,.055,.02,.085,.01,.065,.035,.075];
      start=0.02+Math.round(radius*12)/12*0.58+beats[branch]+kindDelay+jitter*.014;
      length=kind==='tile'?.09:.095;
    }
    if(this.variant==='bloom'){
      start=0.02+radius*.56+angle/(Math.PI*2)*.09+kindDelay+jitter*.025;
      length=kind==='tile'?.17:.135;
    }
    if(radius<.07)start=0;
    start=Math.min(start,.83);
    return [start*this.duration,length*this.duration,(this.variant==='cascade'?2.96:2.72)*(kind==='label'?.7:1),jitter];
  }

  build() {
    if(this.meshes){for(const mesh of this.meshes){this.group.remove(mesh);mesh.geometry.dispose();}}
    this.soundEvents=[];
    this.meshes=this.pieces().map((pieces,layer)=>{
      const arrays={position:[],uv:[],aPivot:[],aAxis:[],aCenter:[],aTiming:[],aPaper:[]};
      pieces.forEach((piece,index)=>{
        const pts=piece.points.map(world);
        const center=pts.reduce((v,p)=>v.add(p),new THREE.Vector3()).multiplyScalar(1/pts.length);
        let hinge=0,best=Infinity;
        for(let i=0;i<pts.length;i++){
          const mid=pts[i].clone().add(pts[(i+1)%pts.length]).multiplyScalar(.5);
          const dist=mid.distanceToSquared(origin);
          if(dist<best){hinge=i;best=dist;}
        }
        const pivot=pts[hinge].clone();
        const axis=pts[(hinge+1)%pts.length].clone().sub(pivot).normalize();
        const away=center.clone().sub(pivot);
        if(new THREE.Vector3().crossVectors(axis,away).z<0)axis.negate();
        const timing=this.timing(center,piece.kind,index);
        if(piece.kind==='tile')this.soundEvents.push({time:timing[0]+timing[1]*.63,tone:index%8});
        for(let i=1;i<pts.length-1;i++){
          let ids=[0,i,i+1];
          if(new THREE.Vector3().crossVectors(pts[i].clone().sub(pts[0]),pts[i+1].clone().sub(pts[0])).z<0)ids=[0,i+1,i];
          for(const id of ids){
            arrays.position.push(pts[id].x,pts[id].y,layer?.004:0);
            arrays.uv.push(piece.points[id][0]/data.width,1-piece.points[id][1]/data.height);
            arrays.aPivot.push(...pivot.toArray());
            arrays.aAxis.push(...axis.toArray());
            arrays.aCenter.push(...center.toArray());
            arrays.aTiming.push(...timing);
            arrays.aPaper.push(...(piece.color||[.85,.82,.9]));
          }
        }
      });
      const geometry=new THREE.BufferGeometry();
      for(const [name,values]of Object.entries(arrays))geometry.setAttribute(name,new THREE.Float32BufferAttribute(values,name==='uv'?2:name==='aTiming'?4:3));
      const mesh=new THREE.Mesh(geometry,this.materials[layer]);
      mesh.frustumCulled=false;
      this.group.add(mesh);
      return mesh;
    });
    this.soundEvents.sort((a,b)=>a.time-b.time);
  }

  resize() {
    const {width,height}=this.container.getBoundingClientRect();
    if(width<1||height<1)return;
    this.renderer.setSize(width,height,false);
    this.camera.aspect=width/height;
    const v=Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2));
    this.camera.position.z=Math.max((WORLD_WIDTH*1.04)/(2*v*this.camera.aspect),(data.height*scale*1.10)/(2*v));
    this.camera.updateProjectionMatrix();
    this.render();
  }

  get canExplore() {return !this.destroyed&&!this.playing&&this.time>=this.duration;}
  get canPan() {return this.panEnabled&&this.canExplore;}
  get canZoom() {return this.zoomEnabled&&this.canExplore;}

  bindPanning() {
    const canvas=this.renderer.domElement;
    this.panListeners=new AbortController();
    const options={signal:this.panListeners.signal};
    canvas.addEventListener('pointerdown',event=>{
      if(!(this.canPan||this.canZoom)||event.button!==0||this.pointers.size>=2)return;
      if(event.pointerType!=='touch'&&!event.isPrimary)return;
      event.preventDefault();
      canvas.focus({preventScroll:true});
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      canvas.setPointerCapture(event.pointerId);
      this.render();
    },options);
    canvas.addEventListener('pointermove',event=>{
      if(!this.pointers.has(event.pointerId))return;
      if(!(this.canPan||this.canZoom)){this.endDrag();return;}
      event.preventDefault();
      const previous=[...this.pointers.values()].map(p=>({...p}));
      this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      const current=[...this.pointers.values()];
      if(current.length===2){
        const midpoint=points=>({x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2});
        const before=midpoint(previous),after=midpoint(current);
        const distance=points=>Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
        const oldDistance=distance(previous);
        if(this.canZoom&&oldDistance>4)this.zoomAt(this.zoom*distance(current)/oldDistance,before.x,before.y,false);
        this.panBy(after.x-before.x,after.y-before.y,false);
      }else this.panBy(current[0].x-previous[0].x,current[0].y-previous[0].y,false);
      this.render();
    },options);
    for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{
      if(this.pointers.has(event.pointerId)){this.endDrag(event.pointerId);this.render();}
    },options);
    canvas.addEventListener('wheel',event=>{
      if(!this.canZoom)return;
      event.preventDefault();
      const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1);
      const factor=Math.exp(-clamp(pixels,-240,240)*(event.ctrlKey?.01:.002));
      this.zoomAt(this.zoom*factor,event.clientX,event.clientY);
    },{...options,passive:false});
    canvas.addEventListener('dblclick',()=>{if(this.canExplore)this.resetView();},options);
    canvas.addEventListener('keydown',event=>{
      if(!this.canExplore||event.altKey||event.ctrlKey||event.metaKey)return;
      const step=event.shiftKey?64:24;
      const directions={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
      if(event.key==='Home'){event.preventDefault();this.resetView();}
      else if(this.canZoom&&['+','=','-','_'].includes(event.key)){
        event.preventDefault();this.zoomAt(this.zoom*(['+','='].includes(event.key)?1.25:.8));
      }else if(this.canPan&&directions[event.key]){event.preventDefault();this.panBy(...directions[event.key]);}
    },options);
  }

  endDrag(pointerId) {
    const ids=pointerId===undefined?[...this.pointers.keys()]:[pointerId];
    for(const id of ids){
      this.pointers.delete(id);
      if(this.renderer.domElement.hasPointerCapture(id))this.renderer.domElement.releasePointerCapture(id);
    }
  }

  panBy(dx,dy,render=true) {
    if(!this.canPan)return;
    const {height}=this.container.getBoundingClientRect();
    if(height<1)return;
    const worldPerPixel=2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*this.camera.position.z/height;
    this.pan.x+=dx*worldPerPixel;
    this.pan.y-=dy*worldPerPixel;
    if(render)this.render();
  }

  zoomAt(value,clientX,clientY,render=true) {
    if(!this.canZoom||!Number.isFinite(value))return;
    const rect=this.container.getBoundingClientRect();
    if(rect.width<1||rect.height<1)return;
    const next=clamp(value,1,this.maxZoom),ratio=next/this.zoom;
    const height=2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*this.camera.position.z;
    const x=((clientX??rect.left+rect.width/2)-rect.left-rect.width/2)*height/rect.height;
    const y=(rect.height/2-((clientY??rect.top+rect.height/2)-rect.top))*height/rect.height;
    // Keep the point under the cursor or pinch midpoint fixed while the board grows.
    this.pan.x=x-(x-this.pan.x)*ratio;
    this.pan.y=y-(y-this.pan.y)*ratio;
    this.zoom=next;
    if(render)this.render();
  }

  resetPan(render=true) {
    this.endDrag();
    this.pan.set(0,0);
    if(render)this.render();
  }

  resetView(render=true) {
    this.zoom=1;
    this.resetPan(render);
  }

  updatePan() {
    const canvas=this.renderer.domElement;
    const enabled=this.canPan||this.canZoom;
    if(enabled){
      const {width,height}=this.container.getBoundingClientRect();
      const viewHeight=2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*this.camera.position.z;
      const viewWidth=viewHeight*this.camera.aspect;
      // Allow every edge to be explored at any zoom while keeping part of the map in view.
      const limit=(view,board,pixels)=>Math.max(0,(view+board)/2-Math.min(view,board,Math.max(Math.min(view,board)*.25,view*32/Math.max(1,pixels))));
      const maxX=limit(viewWidth,WORLD_WIDTH*this.zoom,width),maxY=limit(viewHeight,data.height*scale*this.zoom,height);
      this.pan.x=clamp(this.pan.x,-maxX,maxX);
      this.pan.y=clamp(this.pan.y,-maxY,maxY);
      this.group.position.set(this.pan.x,this.pan.y,0);
      this.group.scale.setScalar(this.zoom);
    }else{
      this.endDrag();
      this.group.position.set(0,0,0);
      this.group.scale.setScalar(1);
    }
    canvas.style.cursor=this.canPan?(this.pointers.size?'grabbing':'grab'):'default';
    canvas.style.touchAction=enabled?'none':'auto';
    this.dispatchEvent(new CustomEvent('panchange',{detail:{enabled,x:this.pan.x,y:this.pan.y,zoom:this.zoom,maxZoom:this.maxZoom,dragging:this.pointers.size>0}}));
  }

  render() {
    if(!this.materials||this.destroyed)return;
    const progress=clamp(this.time/this.duration);
    const settle=Math.pow(1-clamp(progress/.94),2);
    const variant=['wave','cascade','bloom'].indexOf(this.variant);
    this.group.rotation.set((variant===2?.28:.18)*settle,-.08*settle,(variant===2?-.09:.025)*settle);
    for(const mat of this.materials){mat.uniforms.uTime.value=this.time;mat.uniforms.uVariant.value=variant;}
    // The final single sheet is pixel-perfect and removes subpixel sampling seams.
    this.final.visible=progress>=.985;
    for(const mesh of this.meshes)mesh.visible=!this.final.visible;
    this.updatePan();
    this.renderer.render(this.scene,this.camera);
    this.dispatchEvent(new CustomEvent('progress',{detail:{time:this.time,duration:this.duration,playing:this.playing}}));
  }

  seek(seconds) {
    this.time=clamp(seconds,0,this.duration);
    if(this.time<this.duration)this.resetView(false);
    this.render();
  }

  async play(restart=true) {
    await this.ready;
    if(this.destroyed)return;
    this.pause();
    if(restart||this.time>=this.duration){this.resetView(false);this.time=0;}
    if(this.sound)await this.prepareAudio();
    this.playing=true;
    let previous=performance.now();
    const frame=now=>{
      if(!this.playing)return;
      const old=this.time;
      this.time=Math.min(this.duration,this.time+(now-previous)/1000);
      previous=now;
      if(this.sound&&this.audio?.state==='running')this.playFolds(old,this.time);
      this.render();
      if(this.time<this.duration)this.raf=requestAnimationFrame(frame);
      else{this.playing=false;this.render();this.dispatchEvent(new Event('complete'));}
    };
    this.raf=requestAnimationFrame(frame);
  }

  pause() {this.playing=false;cancelAnimationFrame(this.raf);}

  setVariant(variant) {
    if(!descriptions[variant])return;
    this.variant=variant;
    this.pause();
    if(this.materials){this.build();this.seek(0);}
  }

  setDuration(seconds) {
    const fraction=this.time/this.duration;
    this.duration=clamp(Number(seconds)||7,5,10);
    if(this.materials){this.build();this.seek(fraction*this.duration);}
  }

  async prepareAudio() {
    if(!this.audio){
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)return;
      this.audio=new Audio();
      this.master=this.audio.createGain();this.master.gain.value=.22;this.master.connect(this.audio.destination);
      this.noise=this.audio.createBuffer(1,this.audio.sampleRate*.06,this.audio.sampleRate);
      const channel=this.noise.getChannelData(0);
      for(let i=0;i<channel.length;i++)channel[i]=(Math.random()*2-1)*Math.pow(1-i/channel.length,3);
    }
    if(this.audio.state==='suspended')await this.audio.resume();
  }

  playFolds(from,to) {
    let count=0;
    for(const event of this.soundEvents){
      if(event.time<=from||event.time>to||count++>2)continue;
      const t=this.audio.currentTime;
      const noise=this.audio.createBufferSource();noise.buffer=this.noise;
      const filter=this.audio.createBiquadFilter();filter.type='highpass';filter.frequency.value=1800;
      const gain=this.audio.createGain();gain.gain.setValueAtTime(.32,t);gain.gain.exponentialRampToValueAtTime(.001,t+.055);
      noise.connect(filter).connect(gain).connect(this.master);noise.start(t);noise.stop(t+.06);
      const osc=this.audio.createOscillator(),env=this.audio.createGain();
      osc.type='sine';osc.frequency.setValueAtTime([220,277.18,329.63,440,554.37,659.25,880,1108.73][event.tone],t);
      env.gain.setValueAtTime(.07,t);env.gain.exponentialRampToValueAtTime(.001,t+.1);
      osc.connect(env).connect(this.master);osc.start(t);osc.stop(t+.11);
    }
  }

  exportPNG() {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  destroy() {
    this.endDrag();this.panListeners.abort();
    this.destroyed=true;this.pause();this.observer.disconnect();
    this.audio?.close();
    for(const mesh of this.meshes||[])mesh.geometry.dispose();
    for(const mat of this.materials||[])mat.dispose();
    this.final?.geometry.dispose();this.finalMaterial?.dispose();
    for(const t of this.textures||[])t.dispose();
    this.renderer.dispose();this.renderer.domElement.remove();
  }
}

export {descriptions};
