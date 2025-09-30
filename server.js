import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { MaouShogi } from './shared/shogi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARED_DIR = path.join(__dirname, 'shared');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;
  if (pathname === '/') {
    pathname = '/index.html';
  }
  let filePath;
  if (pathname.startsWith('/shared/')) {
    filePath = path.join(SHARED_DIR, pathname.replace('/shared/', ''));
  } else {
    filePath = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ''));
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    res.end(data);
  });
});

const rooms = new Map();

server.on('upgrade', (req, socket, head) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const acceptKey = generateAcceptValue(key);
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`
  ];
  socket.write(headers.concat('\r\n').join('\r\n'));
  const client = createClient(socket);
  client.onMessage = (msg) => handleClientMessage(client, msg);
  client.onClose = () => handleClientClose(client);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

function createClient(socket) {
  const client = {
    socket,
    buffer: Buffer.alloc(0),
    roomId: null,
    color: null,
    name: null,
    onMessage: null,
    onClose: null
  };

  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    let frame;
    while ((frame = decodeFrame(client.buffer))) {
      const { payload, length } = frame;
      client.buffer = client.buffer.slice(length);
      if (client.onMessage) {
        try {
          const data = JSON.parse(payload.toString('utf8'));
          client.onMessage(data);
        } catch (err) {
          console.error('Failed to parse message', err);
        }
      }
    }
  });

  socket.on('close', () => {
    if (client.onClose) client.onClose();
  });

  socket.on('end', () => {
    if (client.onClose) client.onClose();
  });

  socket.on('error', (err) => {
    console.error('Socket error', err);
    if (client.onClose) client.onClose();
  });

  client.send = (data) => {
    const payload = Buffer.from(JSON.stringify(data));
    const frame = encodeFrame(payload);
    socket.write(frame);
  };

  client.close = () => {
    try {
      socket.end();
    } catch (err) {
      console.error('Error closing socket', err);
    }
  };

  return client;
}

function handleClientMessage(client, message) {
  const { type } = message;
  switch (type) {
    case 'join':
      handleJoin(client, message);
      break;
    case 'move':
      handleMove(client, message);
      break;
    case 'drop':
      handleDrop(client, message);
      break;
    case 'resign':
      handleResign(client);
      break;
    case 'requestState':
      sendRoomState(client.roomId);
      break;
    default:
      console.warn('Unknown message type', message);
  }
}

function handleClientClose(client) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  if (!room) return;
  room.clients = room.clients.filter((c) => c !== client);
  broadcast(room, {
    type: 'system',
    message: `${client.name || 'プレイヤー'}が離脱しました。`
  });
  if (room.clients.length === 0) {
    rooms.delete(client.roomId);
  } else {
    sendRoomState(client.roomId);
  }
}

function handleJoin(client, { roomId, name, friendlyPierce }) {
  if (!roomId || typeof roomId !== 'string') return;
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      id: roomId,
      clients: [],
      game: new MaouShogi({ allowFriendlyPierce: !!friendlyPierce }),
      friendlyPierce: !!friendlyPierce
    };
    rooms.set(roomId, room);
  }
  if (room.clients.length >= 2 && !room.clients.includes(client)) {
    client.send({ type: 'error', message: 'この部屋は満員です。' });
    return;
  }
  if (!client.name) client.name = name || `プレイヤー${Math.floor(Math.random() * 1000)}`;
  if (!room.clients.includes(client)) {
    room.clients.push(client);
  }
  client.roomId = roomId;
  if (!client.color) {
    client.color = room.clients.length === 1 ? 'sente' : room.clients.length === 2 ? 'gote' : null;
  }
  if (room.clients.length === 1) {
    room.host = client;
    room.game.setFriendlyPierce(!!friendlyPierce);
    room.friendlyPierce = room.game.isFriendlyPierceEnabled();
  }
  if (room.clients.length === 2) {
    const [first, second] = room.clients;
    first.color = 'sente';
    second.color = 'gote';
  }
  client.send({
    type: 'joined',
    color: client.color,
    friendlyPierce: room.game.isFriendlyPierceEnabled(),
    roomId
  });
  if (room.clients.length === 2) {
    for (const c of room.clients) {
      c.send({
        type: 'joined',
        color: c.color,
        friendlyPierce: room.game.isFriendlyPierceEnabled(),
        roomId
      });
    }
  }
  sendRoomState(roomId);
}

function handleMove(client, { from, to, promote, maou }) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  if (client.color !== room.game.getActiveColor()) {
    client.send({ type: 'error', message: 'あなたの手番ではありません。' });
    return;
  }
  try {
    room.game.movePiece({ from, to, promote: !!promote, maou: !!maou });
    broadcast(room, { type: 'move', state: room.game.getPublicState() });
  } catch (err) {
    client.send({ type: 'error', message: err.message });
  }
}

function handleDrop(client, { to, piece }) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  if (client.color !== room.game.getActiveColor()) {
    client.send({ type: 'error', message: 'あなたの手番ではありません。' });
    return;
  }
  try {
    room.game.dropPiece({ to, piece });
    broadcast(room, { type: 'move', state: room.game.getPublicState() });
  } catch (err) {
    client.send({ type: 'error', message: err.message });
  }
}

function handleResign(client) {
  const room = rooms.get(client.roomId);
  if (!room) return;
  room.game.resign(client.color);
  broadcast(room, { type: 'move', state: room.game.getPublicState() });
}

function sendRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const state = room.game.getPublicState();
  broadcast(room, { type: 'state', state });
}

function broadcast(room, message) {
  room.clients.forEach((client) => {
    try {
      client.send(message);
    } catch (err) {
      console.error('Failed to send message', err);
    }
  });
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function generateAcceptValue(secWebSocketKey) {
  return crypto.createHash('sha1')
    .update(secWebSocketKey + WS_GUID, 'binary')
    .digest('base64');
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const isFinal = (firstByte & 0x80) === 0x80;
  const opcode = firstByte & 0x0f;
  if (!isFinal || opcode !== 0x1) {
    return null;
  }
  const isMasked = (secondByte & 0x80) === 0x80;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;
  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    const high = buffer.readUInt32BE(2);
    const low = buffer.readUInt32BE(6);
    payloadLength = high * 2 ** 32 + low;
    offset += 8;
  }
  if (isMasked) {
    if (buffer.length < offset + 4 + payloadLength) return null;
    const maskingKey = buffer.slice(offset, offset + 4);
    offset += 4;
    const payload = Buffer.alloc(payloadLength);
    for (let i = 0; i < payloadLength; i += 1) {
      payload[i] = buffer[offset + i] ^ maskingKey[i % 4];
    }
    return { payload, length: offset + payloadLength };
  }
  if (buffer.length < offset + payloadLength) return null;
  const payload = buffer.slice(offset, offset + payloadLength);
  return { payload, length: offset + payloadLength };
}

function encodeFrame(payload) {
  const length = payload.length;
  let frame;
  if (length < 126) {
    frame = Buffer.alloc(length + 2);
    frame[0] = 0x81;
    frame[1] = length;
    payload.copy(frame, 2);
  } else if (length < 65536) {
    frame = Buffer.alloc(length + 4);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
    payload.copy(frame, 4);
  } else {
    frame = Buffer.alloc(length + 10);
    frame[0] = 0x81;
    frame[1] = 127;
    frame.writeUInt32BE(0, 2);
    frame.writeUInt32BE(length, 6);
    payload.copy(frame, 10);
  }
  return frame;
}
