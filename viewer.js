import { OrigamiBoard } from './animation.js';

const $=id=>document.getElementById(id);
let board;
try {
  board=new OrigamiBoard($('stage'));
  window.origami=board;
  await board.ready;
  $('loading').hidden=true;
  $('play').disabled=false;
  const update=({detail:d})=>{
    $('timeline').value=d.time;
    $('elapsed').textContent=d.time.toFixed(2).padStart(5,'0');
    $('play').textContent=d.playing?'Pause':'Play';
  };
  board.addEventListener('progress',update);
  board.addEventListener('complete',()=>{$('status').textContent='Unfolding complete. Scroll or pinch to zoom, drag to pan, and use Reset view to fit the full board.';});
  const updatePan=({detail:d})=>{
    $('pan-tools').hidden=!d.enabled;
    $('reset-view').disabled=Math.abs(d.x)+Math.abs(d.y)<.001&&d.zoom===1;
    $('zoom-level').textContent=Math.round(d.zoom*100)+'%';
    $('zoom-out').disabled=d.zoom<=1;
    $('zoom-in').disabled=d.zoom>=d.maxZoom;
  };
  board.addEventListener('panchange',updatePan);
  $('reset-view').addEventListener('click',()=>board.resetView());
  $('zoom-in').addEventListener('click',()=>board.zoomAt(board.zoom*1.5));
  $('zoom-out').addEventListener('click',()=>board.zoomAt(board.zoom/1.5));
  $('play').addEventListener('click',()=>board.playing?(board.pause(),board.render()):board.play(board.time===0||board.time>=board.duration));
  $('timeline').addEventListener('input',event=>{board.pause();board.seek(Number(event.target.value));});
  $('duration').addEventListener('change',event=>{
    board.setDuration(event.target.value);
    $('timeline').max=board.duration;
    $('duration-readout').textContent=board.duration.toFixed(2).padStart(5,'0')+' SEC';
    board.play();
  });
  $('sound').addEventListener('click',async()=>{
    board.sound=!board.sound;
    $('sound').setAttribute('aria-pressed',String(board.sound));
    $('sound').innerHTML=board.sound?'<span aria-hidden="true">◉</span> Sound on':'<span aria-hidden="true">◌</span> Sound off';
    if(board.sound)await board.prepareAudio();
    board.play();
  });
  const names={wave:'01 — EPICENTER',cascade:'02 — ROUTE CASCADE',bloom:'03 — SPIRAL BLOOM'};
  for(const button of document.querySelectorAll('[data-variant]'))button.addEventListener('click',()=>{
    board.setVariant(button.dataset.variant);
    for(const item of document.querySelectorAll('[data-variant]')){
      const selected=item===button;
      item.classList.toggle('selected',selected);item.setAttribute('aria-pressed',String(selected));
    }
    $('stage-label').textContent=names[board.variant];
    $('status').textContent=names[board.variant]+' selected.';
    board.play();
  });
  for(const button of document.querySelectorAll('[data-background]')){
    if(button.tagName!=='BUTTON')continue;
    button.addEventListener('click',()=>{
      document.querySelector('.stage-shell').dataset.background=button.dataset.background;
      for(const item of document.querySelectorAll('button[data-background]')){
        item.classList.toggle('selected',item===button);item.setAttribute('aria-pressed',String(item===button));
      }
    });
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduced)board.seek(board.duration);else board.play();
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&board.playing){board.pause();board.render();}});
  window.addEventListener('pagehide',()=>board.destroy(),{once:true});
} catch(error) {
  $('loading').textContent='The animation could not start. Open this folder through a local web server in a browser with WebGL 2 enabled.';
  $('loading').setAttribute('role','alert');
  console.error(error);
}
