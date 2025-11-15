export function createSocket(serverUrl){
  // returns a socket.io client instance
  const socket = io(serverUrl, {transports:['websocket']});
  return socket;
}
