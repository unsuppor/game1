const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname + '/../frontend')); // serve frontend

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// In-memory state
const players = {}; // id -> {id,name,x,z,clothing,money,lastUpdate,inVehicleId}
const vehicles = {}; // id -> {id,x,z,rot,ownerId}

// spawn a sample auto-rickshaw
function spawnInitialVehicles(){
  const vId = 'rick1';
  vehicles[vId] = { id: vId, x: 8, z: 8, rot: 0, ownerId: null };
  console.log('spawned vehicle', vId);
}
spawnInitialVehicles();

// helpers
function broadcastVehiclesSnapshot(socket){
  const list = Object.values(vehicles);
  socket.emit('vehiclesSnapshot', list);
}

// Socket IO
io.on('connection', (socket) => {
  console.log('conn', socket.id);

  socket.on('join', ({ name }) => {
    const spawn = { x: (Math.random()-0.5)*20, z: (Math.random()-0.5)*20 };
    players[socket.id] = { id: socket.id, name: name || 'Guest', x: spawn.x, z: spawn.z, clothing: { shirt:'#e05a44', pants:'#131133', hat:'#222222' }, money: 100, lastUpdate: Date.now(), inVehicleId: null };

    // send world snapshot
    socket.emit('currentPlayers', players);
    broadcastVehiclesSnapshot(socket);

    // notify others
    socket.broadcast.emit('playerJoined', players[socket.id]);
  });

  socket.on('move', (data) => {
    const p = players[socket.id];
    if(!p) return;
    const now = Date.now();
    const dt = Math.max(0.001, (now - (p.lastUpdate||now))/1000);
    const dx = (data.x - p.x) || 0;
    const dz = (data.z - p.z) || 0;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const speed = dist / dt;
    const MAX_SPEED = 12;
    if(speed > MAX_SPEED * 1.6){
      // clamp interpolation
      const ratio = (MAX_SPEED * 1.6 * dt) / (dist || 1);
      p.x = p.x + dx * ratio; p.z = p.z + dz * ratio;
    } else {
      p.x = data.x; p.z = data.z;
    }
    p.lastUpdate = now;
    socket.broadcast.emit('playerMoved', { id: socket.id, x: p.x, z: p.z });
  });

  // SHOP / BUY
  const CATALOG = {
    'shirt-red': { id:'shirt-red', label: 'Red Shirt', price: 50, type:'shirt', color:'#e05a44' },
    'pants-blue': { id:'pants-blue', label: 'Blue Pants', price: 40, type:'pants', color:'#131133' }
  };

  socket.on('openShop', ()=> socket.emit('shopOpened', { items: Object.values(CATALOG) }));

  socket.on('buyItem', ({ itemId })=>{
    const p = players[socket.id];
    if(!p) return;
    const item = CATALOG[itemId];
    if(!item) return socket.emit('error', 'no item');
    if(p.money < item.price) return socket.emit('error','insufficient');
    p.money -= item.price;
    p.clothing[item.type] = item.color;
    io.emit('playerUpdate', { id: socket.id, clothing: p.clothing, money: p.money });
  });

  // JOBS
  socket.on('startJob', ({ jobType })=>{
    const p = players[socket.id]; if(!p) return;
    socket.emit('jobStarted', { jobType });
    setTimeout(()=>{ if(players[socket.id]){ players[socket.id].money += 100; io.emit('playerUpdate', { id: socket.id, money: players[socket.id].money }); socket.emit('jobFinished', { earned: 100 }); } }, 8000);
  });

  // VEHICLE: enter request
  socket.on('enterVehicle', ({ vehicleId })=>{
    const p = players[socket.id]; if(!p) return;
    const v = vehicles[vehicleId]; if(!v) return;
    if(v.ownerId){
      socket.emit('error','vehicle occupied');
      return;
    }
    v.ownerId = socket.id;
    p.inVehicleId = vehicleId;
    // notify all
    io.emit('vehicleUpdate', v);
    io.emit('enteredVehicleAck', { vehicleId: vehicleId, playerId: socket.id });
  });

  // VEHICLE: exit request
  socket.on('exitVehicle', ({ vehicleId })=>{
    const p = players[socket.id]; if(!p) return;
    const v = vehicles[vehicleId]; if(!v) return;
    if(v.ownerId !== socket.id){
      socket.emit('error','not owner');
      return;
    }
    // set owner to null and teleport player to slightly behind the vehicle
    v.ownerId = null;
    p.inVehicleId = null;
    // compute exit pos
    const exitX = v.x - Math.sin(v.rot) * 1.8;
    const exitZ = v.z - Math.cos(v.rot) * 1.8;
    p.x = exitX; p.z = exitZ;
    io.emit('vehicleUpdate', v);
    io.emit('exitedVehicleAck', { vehicleId: v.id, playerId: socket.id, x: exitX, z: exitZ });
  });

  // Vehicle movement authoritative updates from client owner
  socket.on('vehicleMove', ({ id, x, z, rot })=>{
    const v = vehicles[id];
    if(!v) return;
    // only owner can update
    if(v.ownerId !== socket.id) return;
    // apply small validation (clamp speed if needed)
    v.x = x; v.z = z; if(typeof rot === 'number') v.rot = rot;
    // broadcast to others
    socket.broadcast.emit('vehicleMoved', { id: v.id, x: v.x, z: v.z, rot: v.rot });
    // also persist authoritative position to all (so new joiners can see)
    io.emit('vehicleUpdate', v);
  });

  socket.on('interact', ()=>{ socket.emit('interactAck'); });

  socket.on('disconnect', ()=>{
    // free any vehicle owned by this player
    if(players[socket.id]){
      const pid = socket.id;
      for(const vid in vehicles){
        if(vehicles[vid].ownerId === pid){
          vehicles[vid].ownerId = null;
          io.emit('vehicleUpdate', vehicles[vid]);
        }
      }
      delete players[socket.id];
      socket.broadcast.emit('playerLeft', socket.id);
    }
  });
});

// http endpoints
app.get('/api/players', (req,res)=> res.json(Object.values(players)));
app.get('/api/vehicles', (req,res)=> res.json(Object.values(vehicles)));

app.get('/', (req,res)=> res.sendFile(__dirname + '/../frontend/index.html'));

server.listen(PORT, ()=> console.log('Server listening on', PORT));
