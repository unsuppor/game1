import { createJoystick } from './mobileControls.js';
import { createSocket } from './socketClient.js';
import { openShopFlow } from './ui_shop.js';

const SERVER = "http://localhost:3000"; // local dev

// BABYLON setup
const canvas = document.getElementById('renderCanvas');
const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });

let scene, camera;
const socket = createSocket(SERVER);

// players and vehicles
const players = {}; // id -> {id, vis, prevPos, targetPos, lastUpdate, inVehicleId}
const vehicles = {}; // id -> {id, mesh, ownerId, physics: {x,z,rot,speed}}

// input
let inputX = 0, inputZ = 0;
let keys = {}; // keyboard state
let interactPressed = false;

// helpers
function lerp(a,b,t){ return a + (b-a)*t; }
function vec3Lerp(a,b,t){ return new BABYLON.Vector3(lerp(a.x,b.x,t), lerp(a.y,b.y,t), lerp(a.z,b.z,t)); }
function hexToColor3(hex){ try{ return BABYLON.Color3.FromHexString(hex);}catch{ return new BABYLON.Color3(1,0.5,0.5);} }

// ---------- visuals ----------
async function createPlayerVisual(id, name, clothing){
  const root = new BABYLON.TransformNode('playerRoot_'+id, scene);
  root.position = new BABYLON.Vector3(0,0,0);

  const plane = BABYLON.MeshBuilder.CreatePlane('label_'+id,{width:2,height:0.5},scene);
  plane.parent = root; plane.position.y = 2.6; plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
  const dt = new BABYLON.DynamicTexture('dt_'+id,{width:512,height:128},scene);
  const lm = new BABYLON.StandardMaterial('lm_'+id,scene); lm.diffuseTexture = dt; lm.emissiveColor = new BABYLON.Color3(1,1,1); plane.material = lm;
  dt.drawText(name||'Player', null, 70, "bold 48px Arial", "white", "transparent");

  // capsule body fallback
  const body = BABYLON.MeshBuilder.CreateCapsule('body_'+id,{radius:0.45,height:1.4},scene);
  body.parent = root; body.position.y = 1;
  const bmat = new BABYLON.StandardMaterial('bmat_'+id,scene); bmat.diffuseColor = new BABYLON.Color3(0.8,0.7,0.8); body.material = bmat;

  const shirt = BABYLON.MeshBuilder.CreateBox('shirt_'+id,{height:0.7,width:0.9,depth:0.35},scene);
  shirt.parent=root; shirt.position.y=1.05; shirt.material = new BABYLON.StandardMaterial('sm_'+id,scene);
  const pants = BABYLON.MeshBuilder.CreateBox('pants_'+id,{height:0.6,width:0.9,depth:0.35},scene);
  pants.parent=root; pants.position.y=0.45; pants.material = new BABYLON.StandardMaterial('pm_'+id,scene);
  const hat = BABYLON.MeshBuilder.CreateBox('hat_'+id,{height:0.18,width:0.6,depth:0.6},scene);
  hat.parent=root; hat.position.y=1.7; hat.material = new BABYLON.StandardMaterial('hm_'+id,scene);

  // apply clothing
  if(clothing){
    if(clothing.shirt) shirt.material.diffuseColor = hexToColor3(clothing.shirt);
    if(clothing.pants) pants.material.diffuseColor = hexToColor3(clothing.pants);
    if(clothing.hat) hat.material.diffuseColor = hexToColor3(clothing.hat);
  } else {
    shirt.material.diffuseColor = new BABYLON.Color3(1,0.5,0.5);
    pants.material.diffuseColor = new BABYLON.Color3(0.3,0.3,1);
  }

  return { root, hide: ()=>{ root.setEnabled(false); }, show: ()=>{ root.setEnabled(true); }, setName: (n)=> dt.drawText(n, null, 70, "bold 48px Arial", "white", "transparent") };
}

// vehicle visual
function createVehicleVisual(vehicle){
  // simple auto-rickshaw shape made from boxes + cylinder
  const root = new BABYLON.TransformNode('vehRoot_'+vehicle.id, scene);
  root.position = new BABYLON.Vector3(vehicle.x||10, 0, vehicle.z||10);

  const base = BABYLON.MeshBuilder.CreateBox('vehBase_'+vehicle.id,{height:0.6,width:2.0,depth:1.0},scene);
  base.parent = root; base.position.y = 0.3;
  const baseMat = new BABYLON.StandardMaterial('vbmat_'+vehicle.id, scene); baseMat.diffuseColor = new BABYLON.Color3(0.95,0.55,0.15); base.material = baseMat;

  const cabin = BABYLON.MeshBuilder.CreateBox('vehCab_'+vehicle.id,{height:0.8,width:1.8,depth:0.9},scene);
  cabin.parent = root; cabin.position.y = 0.9; cabin.position.z = -0.05;
  const cm = new BABYLON.StandardMaterial('vcmat_'+vehicle.id,scene); cm.diffuseColor = new BABYLON.Color3(0.15,0.15,0.15); cabin.material = cm;

  // small roof
  const roof = BABYLON.MeshBuilder.CreateBox('vehRoof_'+vehicle.id,{height:0.12,width:1.8,depth:0.95},scene);
  roof.parent=root; roof.position.y = 1.35; roof.material = cm;

  // front light
  const fl = BABYLON.MeshBuilder.CreateSphere('fl_'+vehicle.id,{diameter:0.12},scene); fl.parent=root; fl.position = new BABYLON.Vector3(0.9,0.5,0.2);
  const flm = new BABYLON.StandardMaterial('flm_'+vehicle.id, scene); flm.emissiveColor = new BABYLON.Color3(1,0.9,0.6); fl.material = flm;

  // set root rotation if provided
  if(typeof vehicle.rot === 'number') root.rotation.y = vehicle.rot;

  vehicles[vehicle.id] = { id: vehicle.id, mesh: root, ownerId: vehicle.ownerId || null, physics: { x: vehicle.x||10, z: vehicle.z||10, rot: vehicle.rot||0, speed: 0 } };
}

// ---------- world ----------
function createWorld(){
  scene.clearColor = new BABYLON.Color3(0.55,0.75,0.95);
  const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.5, -1, -0.3), scene);
  sun.intensity = 1.5;
  const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0,1,0), scene); hemi.intensity = 1.1;

  const ground = BABYLON.MeshBuilder.CreateGround("ground",{width:300, height:300}, scene);
  const gmat = new BABYLON.StandardMaterial("gmat", scene); gmat.diffuseColor = new BABYLON.Color3(0.45,0.75,0.45); ground.material = gmat;

  for(let x=-4;x<=4;x++){
    for(let z=-4;z<=4;z++){
      if(Math.random() < 0.5) continue;
      const h = 3 + Math.random()*6;
      const box = BABYLON.MeshBuilder.CreateBox(`b${x}${z}`, {height:h, width:10, depth:10}, scene);
      box.position = new BABYLON.Vector3(x*25, h/2, z*25);
      const bm = new BABYLON.StandardMaterial(`bm${x}${z}`, scene);
      bm.diffuseColor = new BABYLON.Color3(0.25 + Math.random()*0.6, 0.25 + Math.random()*0.6, 0.25 + Math.random()*0.6);
      box.material = bm;
    }
  }

  // small trees
  for(let i=0;i<25;i++){
    const t = BABYLON.MeshBuilder.CreateCylinder("tree"+i, {diameter:1, height:3}, scene);
    t.position.x = (Math.random()-0.5)*260; t.position.z = (Math.random()-0.5)*260; t.position.y = 1.5;
    const tm = new BABYLON.StandardMaterial("tm"+i, scene); tm.diffuseColor = new BABYLON.Color3(0.07,0.4+Math.random()*0.5,0.07); t.material = tm;
  }
}

// ---------- camera & controls ----------
function setupCameraAndControls(){
  camera = new BABYLON.UniversalCamera('cam', new BABYLON.Vector3(0, 12, -18), scene);
  camera.setTarget(new BABYLON.Vector3(0,1,0));
  camera.attachControl(canvas, true);
  if(camera.inputs.attached.mousewheel) camera.inputs.attached.mousewheel.detachControl(canvas);

  // keyboard
  window.addEventListener('keydown', (e)=>{ keys[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', (e)=>{ keys[e.key.toLowerCase()] = false; });

  // E interact on keydown
  window.addEventListener('keydown', (e)=>{
    if(e.key.toLowerCase() === 'e' && !interactPressed){
      interactPressed = true; handleInteract();
    }
    if(e.key.toLowerCase() === ' '){ /* space as handbrake while driving handled in loop */ }
  });
  window.addEventListener('keyup', (e)=>{
    if(e.key.toLowerCase() === 'e') interactPressed = false;
  });
}

// ---------- interactions ----------
function findNearbyVehicle(playerPos, radius=3){
  for(const vid in vehicles){
    const v = vehicles[vid];
    const pos = v.mesh.position;
    const dist = Math.hypot(pos.x - playerPos.x, pos.z - playerPos.z);
    if(dist <= radius) return v;
  }
  return null;
}

function handleInteract(){
  const me = players[socket.id];
  if(!me) return;
  if(me.inVehicleId){
    // if in vehicle -> exit
    socket.emit('exitVehicle', { vehicleId: me.inVehicleId });
    return;
  }
  // find nearby vehicle
  const pos = me.vis.root.position;
  const nearby = findNearbyVehicle(pos, 3.5);
  if(nearby && !nearby.ownerId){
    // enter
    socket.emit('enterVehicle', { vehicleId: nearby.id });
  } else {
    // nothing important, fire local interact
    socket.emit('interact');
  }
}

// ---------- network handlers ----------
function setupSocketHandlers(){
  socket.on('connect', ()=> {
    const name = prompt('Enter public name:', 'Guest') || 'Guest';
    socket.emit('join', { name });
  });

  socket.on('currentPlayers', async (pl) => {
    // players object: id -> {x,z,name,clothing,money,inVehicleId}
    for(const id in pl){
      const p = pl[id];
      if(players[id]) continue;
      const vis = await createPlayerVisual(id, p.name, p.clothing);
      vis.root.position = new BABYLON.Vector3(p.x||0,0,p.z||0);
      players[id] = { id, vis, prevPos: vis.root.position.clone(), targetPos: vis.root.position.clone(), lastUpdate: Date.now(), inVehicleId: p.inVehicleId || null };
      if(p.inVehicleId && vehicles[p.inVehicleId]){
        // if the player is already in a vehicle, hide their visual
        players[id].vis.hide();
      }
      if(id === socket.id && p.money !== undefined) document.getElementById('money').innerText = p.money;
    }
  });

  socket.on('playerJoined', async (p) => {
    if(players[p.id]) return;
    const vis = await createPlayerVisual(p.id, p.name, p.clothing);
    vis.root.position = new BABYLON.Vector3(p.x||0,0,p.z||0);
    players[p.id] = { id: p.id, vis, prevPos: vis.root.position.clone(), targetPos: vis.root.position.clone(), lastUpdate: Date.now(), inVehicleId: p.inVehicleId || null };
    if(p.inVehicleId) players[p.id].vis.hide();
  });

  socket.on('playerLeft', (id) => {
    if(players[id]){ players[id].vis.root.dispose(); delete players[id]; }
  });

  socket.on('playerMoved', (d) => {
    const p = players[d.id]; if(!p) return;
    p.prevPos = p.vis.root.position.clone();
    p.targetPos = new BABYLON.Vector3(d.x, 0, d.z);
    p.lastUpdate = Date.now();
  });

  socket.on('playerUpdate', (d) => {
    if(players[d.id] && d.clothing){
      // apply clothing tint if available
      try{
        const shirt = scene.getMeshByName('shirt_'+d.id);
        const pants = scene.getMeshByName('pants_'+d.id);
        if(shirt && d.clothing.shirt) shirt.material.diffuseColor = hexToColor3(d.clothing.shirt);
        if(pants && d.clothing.pants) pants.material.diffuseColor = hexToColor3(d.clothing.pants);
      }catch(e){}
    }
    if(d.id === socket.id && d.money !== undefined) document.getElementById('money').innerText = d.money;
  });

  // vehicles initial snapshot
  socket.on('vehiclesSnapshot', (vlist) => {
    // vlist: array of {id,x,z,rot,ownerId}
    vlist.forEach(v=>{
      if(vehicles[v.id]) return;
      createVehicleVisual(v);
    });
  });

  socket.on('vehicleSpawned', (v) => {
    if(vehicles[v.id]) return;
    createVehicleVisual(v);
  });

  socket.on('vehicleUpdate', (v) => {
    // server broadcasts owner changes / position updates
    const veh = vehicles[v.id];
    if(!veh) {
      createVehicleVisual(v); return;
    }
    veh.ownerId = v.ownerId || null;
    if(v.x !== undefined && v.z !== undefined){
      veh.mesh.position.x = v.x;
      veh.mesh.position.z = v.z;
      if(typeof v.rot === 'number') veh.mesh.rotation.y = v.rot;
      veh.physics.x = v.x; veh.physics.z = v.z; veh.physics.rot = v.rot || veh.physics.rot;
    }
    // if owner set, we hide the player mesh for that owner
    if(v.ownerId && players[v.ownerId]) players[v.ownerId].vis.hide();
    if(!v.ownerId){
      // if owner cleared, show the player's mesh again
      for(const pid in players){
        if(players[pid].inVehicleId === v.id) players[pid].vis.show();
      }
    }
  });

  socket.on('enteredVehicleAck', ({ vehicleId, playerId })=>{
    // server confirmed playerId entered vehicleId
    if(players[playerId]) {
      players[playerId].inVehicleId = vehicleId;
      players[playerId].vis.hide();
    }
    if(vehicles[vehicleId]) vehicles[vehicleId].ownerId = playerId;
  });

  socket.on('exitedVehicleAck', ({ vehicleId, playerId, x, z })=>{
    if(players[playerId]){
      players[playerId].inVehicleId = null;
      players[playerId].vis.show();
      // teleport player to vehicle exit pos
      players[playerId].vis.root.position = new BABYLON.Vector3(x,0,z);
    }
    if(vehicles[vehicleId]) vehicles[vehicleId].ownerId = null;
  });

  socket.on('vehicleMoved', (v) => {
    // authoritative vehicle movement from server (other clients)
    const veh = vehicles[v.id];
    if(!veh) return;
    veh.mesh.position.x = v.x; veh.mesh.position.z = v.z; if(typeof v.rot === 'number') veh.mesh.rotation.y = v.rot;
    veh.physics.x = v.x; veh.physics.z = v.z; veh.physics.rot = v.rot;
  });
}

// ---------- driving model (client-side prediction while owner) ----------
function updateVehicleDriving(veh, dt){
  // veh.physics: x,z,rot,speed
  // simple car-like controller for rickshaw
  const physics = veh.physics;
  const ownerId = veh.ownerId;
  if(ownerId !== socket.id) return; // only update local-ownership vehicle with input

  // get driving inputs: keyboard or mobile controls (on mobile use joystick: inputZ forward/back, inputX steer)
  const forward = (keys['w'] || keys['arrowup']) ? 1 : ((keys['s']||keys['arrowdown']) ? -1 : 0);
  const steerLeft = keys['a'] || keys['arrowleft'];
  const steerRight = keys['d'] || keys['arrowright'];
  const handbrake = keys[' ']; // space
  // also allow mobile joystick: inputZ negative is forward in our joystick mapping (we used negative earlier)
  let acc = 0;
  if(Math.abs(inputZ) > 0.15) acc = -inputZ; // joystick: up -> negative -> forward
  if(forward) acc = forward > 0 ? 1 : -1;

  // steering from joystick
  let steer = inputX;
  if(steerLeft) steer = steer === 0 ? -0.9 : (steer - 0.05);
  if(steerRight) steer = steer === 0 ? 0.9 : (steer + 0.05);

  // parameters
  const maxSpeed = 10; // m/s
  const accel = 8.0;
  const brake = 10.0;
  const steerSpeed = 2.5; // steering angular speed factor
  const drag = 1.2;

  // update speed
  if(acc > 0.01){
    physics.speed += accel * acc * dt;
  } else if(acc < -0.01){
    // reverse
    physics.speed += accel * acc * dt * 0.6;
  } else {
    // natural drag
    physics.speed -= Math.sign(physics.speed) * drag * dt;
    if(Math.abs(physics.speed) < 0.05) physics.speed = 0;
  }

  // handbrake sharp
  if(handbrake) physics.speed *= 0.92;

  // clamp
  if(physics.speed > maxSpeed) physics.speed = maxSpeed;
  if(physics.speed < -maxSpeed*0.5) physics.speed = -maxSpeed*0.5;

  // steering affects rotation (reduce steering at low speed)
  const steerEffect = steer * steerSpeed * (Math.max(0.2, Math.abs(physics.speed)/maxSpeed));
  physics.rot += steerEffect * dt * (physics.speed >= 0 ? 1 : -1);

  // move in local forward direction
  const dx = Math.sin(physics.rot) * physics.speed * dt;
  const dz = Math.cos(physics.rot) * physics.speed * dt;

  physics.x += dx;
  physics.z += dz;

  // apply to mesh
  veh.mesh.position.x = physics.x;
  veh.mesh.position.z = physics.z;
  veh.mesh.rotation.y = physics.rot;

  // send small updates to server (throttle)
  const now = performance.now();
  if(!veh._lastSend || now - veh._lastSend > 80){
    veh._lastSend = now;
    socket.emit('vehicleMove', { id: veh.id, x: physics.x, z: physics.z, rot: physics.rot });
  }
}

// ---------- main init ----------
async function init(){
  scene = new BABYLON.Scene(engine);
  createWorld();
  setupCameraAndControls();
  createWorld(); // ensure ground/buildings/trees

  setupSocketHandlers();

  // joystick
  const base = document.getElementById('joystickBase'), thumb = document.getElementById('joystickThumb');
  createJoystick(base, thumb, (nx, ny) => { inputX = nx; inputZ = ny; });

  // action buttons
  document.getElementById('btnShop').onclick = ()=> openShopFlow(socket);
  document.getElementById('btnJob').onclick = ()=> socket.emit('startJob', { jobType: 'delivery' });
  document.getElementById('btnInteract').onclick = ()=> handleInteract();

  // render loop
  let last = performance.now();
  engine.runRenderLoop(()=>{
    const now = performance.now();
    const dt = Math.max(0.001, (now - last) / 1000);
    last = now;

    // keyboard walking for local player if not in vehicle
    const me = players[socket.id];
    if(me){
      if(!me.inVehicleId){
        // keyboard mapping: WASD
        let forward = (keys['w']||keys['arrowup']) ? 1 : ((keys['s']||keys['arrowdown']) ? -1 : 0);
        let right = (keys['d']||keys['arrowright']) ? 1 : ((keys['a']||keys['arrowleft']) ? -1 : 0);
        // joystick has priority (already maps to inputX,inputZ)
        if(Math.abs(inputZ) > 0.12){
          // inputZ: negative => forward
          const speed = 4.5;
          me.vis.root.position.x += inputX * speed * dt;
          me.vis.root.position.z += -inputZ * speed * dt;
        } else {
          if(forward) {
            const speed = 4.5 * (forward>0?1:0.6);
            me.vis.root.position.z += (forward>0 ? -1 : 1) * speed * dt; // moving in Z axis
          }
          if(right){
            const speed = 4.5;
            me.vis.root.position.x += right * speed * dt;
          }
        }

        // send position to server occasionally
        me._sendTimer = me._sendTimer || 0;
        me._sendTimer += dt*1000;
        if(me._sendTimer > 80){
          me._sendTimer = 0;
          const pos = me.vis.root.position;
          socket.emit('move', { x: pos.x, z: pos.z });
        }
      } else {
        // if in vehicle: follow vehicle with camera; don't send player pos
      }
    }

    // update vehicles (driving)
    for(const vid in vehicles){
      const veh = vehicles[vid];
      // if local owner, update driving physics
      if(veh.ownerId === socket.id) updateVehicleDriving(veh, dt);
      // if remote owner, simple smoothing could be added
    }

    // interpolation for remote players (not in vehicle)
    for(const id in players){
      if(id === socket.id) continue;
      const p = players[id];
      if(p.inVehicleId){
        // if player is in vehicle, hide their body (server controls vehicle)
        if(p.vis) p.vis.hide();
        continue;
      }
      const elapsed = (Date.now() - p.lastUpdate) / 1000;
      const t = Math.min(1, elapsed / 0.12);
      const newPos = vec3Lerp(p.prevPos, p.targetPos, t);
      p.vis.root.position.copyFrom(newPos);
    }

    // camera follow: if local in vehicle, position behind vehicle; else follow player
    if(players[socket.id]){
      const my = players[socket.id];
      if(my.inVehicleId && vehicles[my.inVehicleId]){
        const v = vehicles[my.inVehicleId];
        const desired = new BABYLON.Vector3(v.mesh.position.x, 5.5, v.mesh.position.z - 6);
        camera.position = vec3Lerp(camera.position, desired, 0.12);
        camera.setTarget(new BABYLON.Vector3(v.mesh.position.x, 1.2, v.mesh.position.z));
      } else {
        const target = my.vis.root.position;
        const desired = new BABYLON.Vector3(target.x, 12, target.z - 18);
        camera.position = vec3Lerp(camera.position, desired, 0.12);
        camera.setTarget(new BABYLON.Vector3(target.x, 1.2, target.z));
      }
    }

    scene.render();
  });

  window.addEventListener('resize', ()=> engine.resize());
}

init();
