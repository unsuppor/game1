// Minimal shop UI helper — uses prompt for quick testing
export function openShopFlow(socket){
  socket.emit('openShop');
  socket.once('shopOpened', (data)=>{
    const items = data.items || [];
    let txt = 'Shop items:\\n';
    items.forEach((it, idx)=> txt += `${idx+1}. ${it.label} - ₹${it.price}\\n`);
    const sel = prompt(txt + '\\nEnter item number to buy (or cancel):');
    if(!sel) return;
    const i = parseInt(sel) - 1;
    if(isNaN(i) || i < 0 || i >= items.length) return alert('invalid');
    const item = items[i];
    socket.emit('buyItem', {itemId: item.id});
  });
}
