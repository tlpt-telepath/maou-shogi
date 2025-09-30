import {
  PIECE_LABELS,
  generateLegalMoves,
  generateDropMoves,
  COLORS
} from '/shared/shogi.js';

const boardEl = document.getElementById('board');
const lobbyEl = document.getElementById('lobby');
const gameEl = document.getElementById('game');
const lobbyInfoEl = document.getElementById('lobby-info');
const playerColorEl = document.getElementById('player-color');
const currentTurnEl = document.getElementById('current-turn');
const pierceModeEl = document.getElementById('pierce-mode');
const resultEl = document.getElementById('game-result');
const systemMessagesEl = document.getElementById('system-messages');
const capturedAreas = document.querySelectorAll('.captured .pieces');
const resignButton = document.getElementById('resign-button');
const returnButton = document.getElementById('return-lobby');

let socket = null;
let myColor = null;
let currentRoomId = null;
let gameState = null;
let selectedCell = null;
let selectedMoves = [];
let selectedDrop = null;
let dropMoves = [];
let messageHistory = [];
let friendlyPierceSetting = false;
let awaitingServer = false;

const BOARD_SIZE = 9;

setupBoard();
setupForm();
setupControls();
render();

function setupBoard() {
  boardEl.innerHTML = '';
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      const pieceEl = document.createElement('span');
      cell.appendChild(pieceEl);
      cell.addEventListener('click', () => handleCellClick(r, c));
      boardEl.appendChild(cell);
    }
  }
}

function setupForm() {
  const createButton = document.getElementById('create-room');
  const joinButton = document.getElementById('join-room');
  const roomInput = document.getElementById('room-id');
  const nameInput = document.getElementById('player-name');
  const friendlyCheckbox = document.getElementById('friendly-pierce');

  createButton.addEventListener('click', () => {
    const roomId = roomInput.value.trim();
    if (!roomId) {
      lobbyInfoEl.textContent = '部屋IDを入力してください。';
      return;
    }
    connectToRoom({
      roomId,
      name: nameInput.value.trim(),
      friendly: friendlyCheckbox.checked,
      asHost: true
    });
  });

  joinButton.addEventListener('click', () => {
    const roomId = roomInput.value.trim();
    if (!roomId) {
      lobbyInfoEl.textContent = '部屋IDを入力してください。';
      return;
    }
    connectToRoom({
      roomId,
      name: nameInput.value.trim(),
      friendly: false,
      asHost: false
    });
  });
}

function setupControls() {
  resignButton.addEventListener('click', () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!gameState || gameState.status === 'finished') return;
    if (!confirm('投了しますか？')) return;
    socket.send(JSON.stringify({ type: 'resign' }));
  });

  returnButton.addEventListener('click', () => {
    resetToLobby();
  });
}

function connectToRoom({ roomId, name, friendly, asHost }) {
  if (awaitingServer) return;
  if (socket) {
    socket.close();
    socket = null;
  }
  awaitingServer = true;
  lobbyInfoEl.textContent = 'サーバーに接続中…';
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${window.location.host}`;
  socket = new WebSocket(url);
  socket.addEventListener('open', () => {
    const payload = { type: 'join', roomId, name };
    if (asHost) {
      payload.friendlyPierce = friendly;
    }
    socket.send(JSON.stringify(payload));
    currentRoomId = roomId;
    myColor = null;
    friendlyPierceSetting = friendly;
    lobbyInfoEl.textContent = `部屋 ${roomId} に接続しました。対戦相手を待っています…`;
    lobbyEl.classList.add('hidden');
    gameEl.classList.remove('hidden');
  });
  socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);
    handleServerMessage(data);
  });
  socket.addEventListener('close', () => {
    if (awaitingServer) {
      lobbyInfoEl.textContent = '接続が切断されました。';
    } else if (!lobbyEl.classList.contains('hidden')) {
      lobbyInfoEl.textContent = '接続が切断されました。';
    } else if (gameState) {
      pushSystemMessage('サーバーとの接続が切断されました。');
    }
    awaitingServer = false;
  });
  socket.addEventListener('error', () => {
    lobbyInfoEl.textContent = '通信エラーが発生しました。';
    awaitingServer = false;
  });
}

function handleServerMessage(message) {
  awaitingServer = false;
  switch (message.type) {
    case 'state':
    case 'move':
      gameState = message.state;
      if (gameState) {
        friendlyPierceSetting = !!gameState.allowFriendlyPierce;
      }
      render();
      break;
    case 'error':
      lobbyInfoEl.textContent = message.message || 'エラーが発生しました。';
      break;
    case 'system':
      pushSystemMessage(message.message);
      break;
    case 'joined':
      if (message.color) {
        myColor = message.color;
        friendlyPierceSetting = !!message.friendlyPierce;
        pushSystemMessage(`${colorLabel(message.color)}として参加しました。`);
      }
      break;
    default:
      break;
  }
}

function handleCellClick(row, col) {
  if (!gameState || !socket || socket.readyState !== WebSocket.OPEN) return;
  if (gameState.status === 'finished') return;
  if (gameState.activeColor !== myColor) return;

  const cellKey = `${row},${col}`;
  if (selectedDrop) {
    const move = dropMoves.find((m) => m.to.row === row && m.to.col === col);
    if (move) {
      socket.send(JSON.stringify({ type: 'drop', to: move.to, piece: move.piece }));
      clearSelection();
    }
    return;
  }

  if (selectedCell && selectedCell.row === row && selectedCell.col === col) {
    clearSelection();
    render();
    return;
  }

  const piece = gameState.board[row][col];
  if (piece && piece.owner === myColor) {
    selectedCell = { row, col };
    selectedDrop = null;
    dropMoves = [];
    selectedMoves = generateLegalMoves(gameState, row, col);
    render();
    return;
  }

  if (selectedMoves.length > 0) {
    const matches = selectedMoves.filter((move) => move.to.row === row && move.to.col === col);
    if (matches.length === 0) {
      clearSelection();
      render();
      return;
    }
    let chosen = matches[0];
    if (matches.length > 1) {
      const maouOption = matches.find((m) => m.maou);
      const nonMaou = matches.find((m) => !m.maou);
      if (maouOption && nonMaou) {
        const promote = confirm('王を魔王に成りますか？');
        chosen = promote ? maouOption : nonMaou;
      } else {
        const promoteOption = matches.find((m) => m.promote);
        const nonPromote = matches.find((m) => !m.promote);
        if (promoteOption && nonPromote) {
          const promote = confirm('成りますか？');
          chosen = promote ? promoteOption : nonPromote;
        }
      }
    }
    socket.send(
      JSON.stringify({
        type: 'move',
        from: chosen.from,
        to: chosen.to,
        promote: !!chosen.promote,
        maou: !!chosen.maou
      })
    );
    clearSelection();
  }
}

function clearSelection() {
  selectedCell = null;
  selectedMoves = [];
  selectedDrop = null;
  dropMoves = [];
}

function render() {
  renderStatus();
  renderBoard();
  renderCaptured();
  renderResult();
  renderSystemMessages();
}

function renderStatus() {
  playerColorEl.textContent = myColor ? colorLabel(myColor) : '-';
  currentTurnEl.textContent = gameState ? colorLabel(gameState.activeColor) : '-';
  pierceModeEl.textContent = friendlyPierceSetting ? '味方も貫通' : '敵のみ貫通';
}

function renderBoard() {
  const isFlipped = myColor === COLORS.GOTE;
  boardEl.classList.toggle('flipped', isFlipped);

  const cells = boardEl.children;
  const highlightMap = new Map();
  const dropMap = new Map();
  const lastMove = gameState?.lastMove;
  const inCheckColor = gameState?.inCheck;
  let kingInCheck = null;
  if (gameState && inCheckColor) {
    kingInCheck = findKing(gameState, inCheckColor);
  }

  if (selectedMoves.length > 0) {
    for (const move of selectedMoves) {
      const key = `${move.to.row},${move.to.col}`;
      highlightMap.set(key, {
        capture: move.captured && move.captured.length > 0,
        maou: !!move.maou
      });
    }
  }

  if (selectedDrop && dropMoves.length > 0) {
    for (const move of dropMoves) {
      dropMap.set(`${move.to.row},${move.to.col}`, true);
    }
  }

  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const index = r * BOARD_SIZE + c;
      const cell = cells[index];
      const span = cell.firstChild;
      cell.className = 'cell';
      const piece = gameState ? gameState.board[r][c] : null;
      if (piece) {
        const label = getPieceLabel(piece);
        span.textContent = label;
        cell.classList.add(piece.owner === COLORS.SENTE ? 'sente' : 'gote');
        if (piece.maou) {
          cell.classList.add('maou');
        }
      } else {
        span.textContent = '';
      }
      if (selectedCell && selectedCell.row === r && selectedCell.col === c) {
        cell.classList.add('selected');
      }
      const highlight = highlightMap.get(`${r},${c}`);
      if (highlight) {
        cell.classList.add('legal');
        if (highlight.capture) {
          cell.classList.add('capture');
        }
      }
      if (dropMap.has(`${r},${c}`)) {
        cell.classList.add('drop-target');
      }
      if (lastMove && lastMove.type === 'move') {
        if ((lastMove.from.row === r && lastMove.from.col === c) || (lastMove.to.row === r && lastMove.to.col === c)) {
          cell.classList.add('last-move');
        }
      }
      if (lastMove && lastMove.type === 'drop') {
        if (lastMove.to.row === r && lastMove.to.col === c) {
          cell.classList.add('last-move');
        }
      }
      if (kingInCheck && kingInCheck.row === r && kingInCheck.col === c) {
        cell.classList.add('in-check');
      }
    }
  }
}

function renderCaptured() {
  if (!gameState) {
    capturedAreas.forEach((area) => {
      area.innerHTML = '';
    });
    return;
  }
  const order = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
  capturedAreas.forEach((area) => {
    const owner = area.dataset.owner;
    area.innerHTML = '';
    for (const type of order) {
      const count = gameState.captured[owner]?.[type] || 0;
      if (!count) continue;
      const chip = document.createElement('div');
      chip.className = 'piece-chip';
      chip.textContent = `${labelForCaptured(type)}×${count}`;
      if (owner === myColor) {
        chip.addEventListener('click', () => {
          if (gameState.activeColor !== myColor) return;
          selectedDrop = selectedDrop === type ? null : type;
          selectedCell = null;
          selectedMoves = [];
          dropMoves = selectedDrop ? generateDropMoves(gameState, myColor, selectedDrop) : [];
          render();
        });
        if (selectedDrop === type) {
          chip.classList.add('selected');
        }
      } else {
        chip.classList.add('disabled');
      }
      area.appendChild(chip);
    }
  });
}

function renderResult() {
  if (!gameState || gameState.status !== 'finished') {
    resultEl.classList.add('hidden');
    resultEl.textContent = '';
    return;
  }
  resultEl.classList.remove('hidden');
  if (gameState.lastMove?.type === 'resign') {
    const loser = gameState.lastMove.color;
    const winner = loser === COLORS.SENTE ? COLORS.GOTE : COLORS.SENTE;
    resultEl.textContent = `${colorLabel(winner)}の勝ち (投了)`;
    return;
  }
  if (!gameState.winner) {
    resultEl.textContent = '千日手／引き分け';
    return;
  }
  const youWin = myColor && myColor === gameState.winner;
  resultEl.textContent = youWin ? '勝利しました！' : '敗北しました…';
}

function renderSystemMessages() {
  systemMessagesEl.innerHTML = messageHistory.map((msg) => `<div>${escapeHtml(msg)}</div>`).join('');
}

function pushSystemMessage(message) {
  if (!message) return;
  messageHistory.push(message);
  if (messageHistory.length > 5) {
    messageHistory = messageHistory.slice(-5);
  }
  renderSystemMessages();
}

function resetToLobby() {
  if (socket) {
    socket.close();
    socket = null;
  }
  gameState = null;
  myColor = null;
  currentRoomId = null;
  friendlyPierceSetting = false;
  messageHistory = [];
  awaitingServer = false;
  clearSelection();
  lobbyEl.classList.remove('hidden');
  gameEl.classList.add('hidden');
  lobbyInfoEl.textContent = '新しく部屋を作成するか、既存の部屋に参加してください。';
  render();
}

function getPieceLabel(piece) {
  if (piece.maou) {
    return PIECE_LABELS.BLANK;
  }
  if (piece.promoted) {
    switch (piece.type) {
      case 'R':
        return PIECE_LABELS.PR;
      case 'B':
        return PIECE_LABELS.PB;
      case 'S':
        return PIECE_LABELS.PS;
      case 'N':
        return PIECE_LABELS.PN;
      case 'L':
        return PIECE_LABELS.PL;
      case 'P':
        return PIECE_LABELS.PP;
      default:
        return PIECE_LABELS[piece.type] || '';
    }
  }
  return PIECE_LABELS[piece.type] || '';
}

function labelForCaptured(type) {
  switch (type) {
    case 'R':
      return PIECE_LABELS.R;
    case 'B':
      return PIECE_LABELS.B;
    case 'G':
      return PIECE_LABELS.G;
    case 'S':
      return PIECE_LABELS.S;
    case 'N':
      return PIECE_LABELS.N;
    case 'L':
      return PIECE_LABELS.L;
    case 'P':
      return PIECE_LABELS.P;
    default:
      return type;
  }
}

function colorLabel(color) {
  return color === COLORS.SENTE ? '先手' : color === COLORS.GOTE ? '後手' : '-';
}

function findKing(state, color) {
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const piece = state.board[r][c];
      if (!piece) continue;
      if (piece.owner === color && (piece.type === 'K' || piece.maou)) {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
