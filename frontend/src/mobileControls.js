// Simple touch joystick handler
export function createJoystick(baseEl, thumbEl, onMove){
  let active=false, startX=0, startY=0, max=44;

  function getPoint(e){
    return e.touches ? e.touches[0] : e;
  }

  function start(e){
    active=true;
    const p = getPoint(e);
    startX = p.clientX;
    startY = p.clientY;
    e.preventDefault();
  }
  function end(e){
    active=false;
    thumbEl.style.transform='translate(0px,0px)';
    onMove(0,0);
  }
  function move(e){
    if(!active) return;
    const p = getPoint(e);
    let dx = p.clientX - startX;
    let dy = p.clientY - startY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if(dist > max){
      dx = dx/dist*max;
      dy = dy/dist*max;
    }
    thumbEl.style.transform = `translate(${dx}px,${dy}px)`;
    // Normalize to -1..1
    onMove(dx / max, dy / max);
    e.preventDefault();
  }

  baseEl.addEventListener('touchstart', start, {passive:false});
  baseEl.addEventListener('touchmove', move, {passive:false});
  baseEl.addEventListener('touchend', end);
  baseEl.addEventListener('mousedown', start);
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
}
