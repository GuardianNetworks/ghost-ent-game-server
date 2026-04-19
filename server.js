const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end('Ghost ENT Game Server — Live');
});

const wss = new WebSocket.Server({ server });

// Store all active rooms
const rooms = {};

function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function broadcast(room, data, excludeSocket = null) {
  const msg = JSON.stringify(data);
  room.players.forEach(player => {
    if (player !== excludeSocket && player.readyState === WebSocket.OPEN) {
      player.send(msg);
    }
  });
}

function broadcastAll(room, data) {
  const msg = JSON.stringify(data);
  room.players.forEach(player => {
    if (player.readyState === WebSocket.OPEN) {
      player.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.playerName = null;
  ws.fighter = null;

  ws.on('message', (raw) => {
    let data;
    try { data = JSON.parse(raw); } catch { return; }

    switch (data.type) {

      // Player creates a new room
      case 'CREATE_ROOM': {
        const code = generateRoomCode();
        rooms[code] = {
          code,
          players: [ws],
          state: {
            player1: { name: data.name, fighter: data.fighter, hp: data.hp, maxHp: data.hp },
            player2: null,
            turn: 1,
            log: 'Waiting for opponent...'
          }
        };
        ws.roomCode = code;
        ws.playerNum = 1;
        ws.send(JSON.stringify({ type: 'ROOM_CREATED', code, playerNum: 1 }));
        break;
      }

      // Player joins an existing room
      case 'JOIN_ROOM': {
        const room = rooms[data.code];
        if (!room) {
          ws.send(JSON.stringify({ type: 'ERROR', msg: 'Room not found. Check your code.' }));
          return;
        }
        if (room.players.length >= 2) {
          ws.send(JSON.stringify({ type: 'ERROR', msg: 'Room is full.' }));
          return;
        }
        room.players.push(ws);
        ws.roomCode = data.code;
        ws.playerNum = 2;
        room.state.player2 = { name: data.name, fighter: data.fighter, hp: data.hp, maxHp: data.hp };
        room.state.log = 'Battle started! Player 1 goes first.';

        // Tell both players the battle is starting
        broadcastAll(room, { type: 'BATTLE_START', state: room.state });
        break;
      }

      // A player attacks
      case 'ATTACK': {
        const room = rooms[ws.roomCode];
        if (!room) return;

        const attacker = ws.playerNum === 1 ? 'player1' : 'player2';
        const defender = ws.playerNum === 1 ? 'player2' : 'player1';

        let dmg = data.dmg;
        let isCrit = Math.random() < 0.15;
        if (isCrit) dmg = Math.round(dmg * 1.5);

        const blocked = data.defenseBonus || 0;
        const finalDmg = Math.max(1, dmg - blocked);

        room.state[defender].hp = Math.max(0, room.state[defender].hp - finalDmg);

        let log = `${data.moveName} — ${finalDmg} damage!`;
        if (isCrit) log += ' CRITICAL HIT!';
        if (blocked > 0) log += ` (blocked ${blocked})`;
        room.state.log = log;

        const gameOver = room.state[defender].hp <= 0;

        broadcastAll(room, {
          type: gameOver ? 'GAME_OVER' : 'STATE_UPDATE',
          state: room.state,
          winner: gameOver ? attacker : null,
          isCrit
        });

        if (gameOver) {
          delete rooms[ws.roomCode];
        }
        break;
      }

      // A player sets defense
      case 'SET_DEFENSE': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        broadcast(room, {
          type: 'DEFENSE_SET',
          playerNum: ws.playerNum,
          moveName: data.moveName,
          defenseBonus: data.defenseBonus
        }, ws);
        break;
      }

      // Chat / taunts
      case 'TAUNT': {
        const room = rooms[ws.roomCode];
        if (!room) return;
        broadcast(room, { type: 'TAUNT', msg: data.msg, playerNum: ws.playerNum }, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!ws.roomCode || !rooms[ws.roomCode]) return;
    const room = rooms[ws.roomCode];
    broadcast(room, { type: 'OPPONENT_LEFT', msg: 'Opponent disconnected.' });
    delete rooms[ws.roomCode];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Ghost ENT Game Server running on port ${PORT}`);
});
