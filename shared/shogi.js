const BOARD_SIZE = 9;
export const COLORS = { SENTE: 'sente', GOTE: 'gote' };
export const PIECE_TYPES = ['K', 'R', 'B', 'G', 'S', 'N', 'L', 'P'];
export const PROMOTABLE_TYPES = new Set(['R', 'B', 'S', 'N', 'L', 'P']);

export const PIECE_LABELS = {
  K: '王',
  R: '飛',
  B: '角',
  G: '金',
  S: '銀',
  N: '桂',
  L: '香',
  P: '歩',
  PR: '龍',
  PB: '馬',
  PS: '全',
  PN: '圭',
  PL: '杏',
  PP: 'と',
  BLANK: '　'
};

const GOLD_MOVES = {
  [COLORS.SENTE]: [
    { r: -1, c: -1 },
    { r: -1, c: 0 },
    { r: -1, c: 1 },
    { r: 0, c: -1 },
    { r: 0, c: 1 },
    { r: 1, c: 0 }
  ],
  [COLORS.GOTE]: [
    { r: 1, c: -1 },
    { r: 1, c: 0 },
    { r: 1, c: 1 },
    { r: 0, c: -1 },
    { r: 0, c: 1 },
    { r: -1, c: 0 }
  ]
};

const SILVER_MOVES = {
  [COLORS.SENTE]: [
    { r: -1, c: -1 },
    { r: -1, c: 0 },
    { r: -1, c: 1 },
    { r: 1, c: -1 },
    { r: 1, c: 1 }
  ],
  [COLORS.GOTE]: [
    { r: 1, c: -1 },
    { r: 1, c: 0 },
    { r: 1, c: 1 },
    { r: -1, c: -1 },
    { r: -1, c: 1 }
  ]
};

const KING_MOVES = [
  { r: -1, c: -1 },
  { r: -1, c: 0 },
  { r: -1, c: 1 },
  { r: 0, c: -1 },
  { r: 0, c: 1 },
  { r: 1, c: -1 },
  { r: 1, c: 0 },
  { r: 1, c: 1 }
];

const KNIGHT_MOVES = {
  [COLORS.SENTE]: [
    { r: -2, c: -1 },
    { r: -2, c: 1 }
  ],
  [COLORS.GOTE]: [
    { r: 2, c: -1 },
    { r: 2, c: 1 }
  ]
};

const ROOK_DIRS = [
  { r: -1, c: 0 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: 0, c: 1 }
];

const BISHOP_DIRS = [
  { r: -1, c: -1 },
  { r: -1, c: 1 },
  { r: 1, c: -1 },
  { r: 1, c: 1 }
];

const PROMOTION_ZONE = {
  [COLORS.SENTE]: new Set([0, 1, 2]),
  [COLORS.GOTE]: new Set([6, 7, 8])
};

const BASE_FROM_PROMOTED = {
  R: 'R',
  B: 'B',
  S: 'S',
  N: 'N',
  L: 'L',
  P: 'P'
};

export class MaouShogi {
  constructor(options = {}) {
    this.state = createInitialState(options);
  }

  getActiveColor() {
    return this.state.activeColor;
  }

  getPublicState() {
    return deepCloneState(this.state);
  }

  getState() {
    return deepCloneState(this.state);
  }

  setFriendlyPierce(value) {
    this.state.allowFriendlyPierce = !!value;
  }

  isFriendlyPierceEnabled() {
    return !!this.state.allowFriendlyPierce;
  }

  movePiece({ from, to, promote = false, maou = false }) {
    if (!this.state || this.state.status === 'finished') {
      throw new Error('対局は終了しています。');
    }
    if (!isValidCoord(from) || !isValidCoord(to)) {
      throw new Error('不正な座標です。');
    }
    const legalMoves = generateLegalMoves(this.state, from.row, from.col);
    const selected = legalMoves.find((move) =>
      move.to.row === to.row &&
      move.to.col === to.col &&
      !!move.promote === !!promote &&
      !!move.maou === !!maou
    );
    if (!selected) {
      throw new Error('その手は指せません。');
    }
    this.state = applyMove(this.state, selected);
  }

  dropPiece({ to, piece }) {
    if (!this.state || this.state.status === 'finished') {
      throw new Error('対局は終了しています。');
    }
    if (!isValidCoord(to)) {
      throw new Error('不正な座標です。');
    }
    const drops = generateDropMoves(this.state, this.state.activeColor, piece);
    const selected = drops.find((move) => move.to.row === to.row && move.to.col === to.col);
    if (!selected) {
      throw new Error('その持ち駒は打てません。');
    }
    this.state = applyDrop(this.state, selected);
  }

  resign(color) {
    if (this.state.status === 'finished') return;
    if (!color) return;
    const winner = oppositeColor(color);
    this.state = {
      ...this.state,
      status: 'finished',
      winner,
      lastMove: { type: 'resign', color }
    };
  }
}

export function createInitialState(options = {}) {
  const board = createInitialBoard();
  return {
    board,
    activeColor: COLORS.SENTE,
    allowFriendlyPierce: !!options.allowFriendlyPierce,
    captured: {
      [COLORS.SENTE]: initCaptured(),
      [COLORS.GOTE]: initCaptured()
    },
    status: 'ongoing',
    winner: null,
    inCheck: null,
    lastMove: null
  };
}

export function generateLegalMoves(state, row, col) {
  if (!isValidIndex(row) || !isValidIndex(col)) return [];
  const piece = state.board[row][col];
  if (!piece) return [];
  if (piece.owner !== state.activeColor) return [];
  const pseudoMoves = generatePseudoMoves(state, row, col);
  const legal = [];
  for (const move of pseudoMoves) {
    const next = applyMove(state, move, { dryRun: true });
    if (!isInCheck(next, piece.owner)) {
      legal.push(move);
    }
  }
  return legal;
}

export function generateDropMoves(state, color, pieceType) {
  if (!PIECE_TYPES.includes(pieceType)) return [];
  if (pieceType === 'K') return [];
  const stock = state.captured[color][pieceType];
  if (!stock) return [];
  const moves = [];
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      if (state.board[r][c]) continue;
      if (!canDropPiece(state, color, pieceType, r, c)) continue;
      const move = {
        type: 'drop',
        piece: pieceType,
        color,
        to: { row: r, col: c }
      };
      const next = applyDrop(state, move, { dryRun: true });
      if (!isInCheck(next, color)) {
        moves.push(move);
      }
    }
  }
  return moves;
}

export function isInCheck(state, color) {
  const kingPos = findKing(state, color);
  if (!kingPos) return false;
  const opponent = oppositeColor(color);
  return isSquareAttacked(state, kingPos.row, kingPos.col, opponent);
}

export function isCheckmate(state, color) {
  if (!isInCheck(state, color)) return false;
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const piece = state.board[r][c];
      if (!piece || piece.owner !== color) continue;
      const moves = generateLegalMoves(state, r, c);
      if (moves.length > 0) return false;
    }
  }
  const captured = state.captured[color];
  for (const pieceType of PIECE_TYPES) {
    if (pieceType === 'K') continue;
    if (captured[pieceType] > 0) {
      const drops = generateDropMoves(state, color, pieceType);
      if (drops.length > 0) return false;
    }
  }
  return true;
}

function applyMove(state, move, { dryRun = false } = {}) {
  const next = deepCloneState(state);
  const { from, to } = move;
  const piece = next.board[from.row][from.col];
  if (!piece) {
    throw new Error('駒が存在しません。');
  }
  const moving = clonePiece(piece);
  const capturedPieces = [];
  if (move.captured && move.captured.length > 0) {
    for (const pos of move.captured) {
      const target = next.board[pos.row][pos.col];
      if (target) {
        capturedPieces.push({ position: pos, piece: clonePiece(target) });
        next.board[pos.row][pos.col] = null;
      }
    }
  } else {
    const target = next.board[to.row][to.col];
    if (target) {
      capturedPieces.push({ position: to, piece: clonePiece(target) });
    }
  }
  next.board[from.row][from.col] = null;
  if (move.maou) {
    moving.maou = true;
  } else if (move.promote) {
    moving.promoted = true;
  }
  next.board[to.row][to.col] = moving;
  for (const entry of capturedPieces) {
    const cap = entry.piece;
    if (cap.type === 'K') {
      next.status = 'finished';
      next.winner = moving.owner;
      next.inCheck = null;
      next.board[entry.position.row][entry.position.col] = null;
      continue;
    }
    if (cap.maou) {
      next.status = 'finished';
      next.winner = moving.owner;
      next.inCheck = null;
      continue;
    }
    const demoted = cap.promoted ? demoteType(cap.type) : cap.type;
    const owner = moving.owner;
    next.captured[owner][demoted] += 1;
  }
  if (dryRun) {
    next.activeColor = oppositeColor(state.activeColor);
    return next;
  }
  if (next.status !== 'finished') {
    next.activeColor = oppositeColor(state.activeColor);
    const opponent = next.activeColor;
    next.inCheck = isInCheck(next, opponent) ? opponent : null;
    if (isCheckmate(next, opponent)) {
      next.status = 'finished';
      next.winner = moving.owner;
    }
  }
  next.lastMove = {
    type: 'move',
    from: { ...from },
    to: { ...to },
    promote: !!move.promote,
    maou: !!move.maou,
    captured: capturedPieces.map((c) => ({ position: c.position, piece: c.piece }))
  };
  return next;
}

function applyDrop(state, move, { dryRun = false } = {}) {
  const next = deepCloneState(state);
  const { to, piece, color } = move;
  if (next.board[to.row][to.col]) {
    throw new Error('そのマスには駒があります。');
  }
  if (next.captured[color][piece] <= 0) {
    throw new Error('その駒は持っていません。');
  }
  next.board[to.row][to.col] = createPiece(piece, color);
  next.captured[color][piece] -= 1;
  if (dryRun) {
    next.activeColor = oppositeColor(state.activeColor);
    return next;
  }
  next.lastMove = {
    type: 'drop',
    to: { ...to },
    piece
  };
  next.activeColor = oppositeColor(state.activeColor);
  const opponent = next.activeColor;
  next.inCheck = isInCheck(next, opponent) ? opponent : null;
  if (isCheckmate(next, opponent)) {
    next.status = 'finished';
    next.winner = color;
  }
  return next;
}

function generatePseudoMoves(state, row, col) {
  const piece = state.board[row][col];
  if (!piece) return [];
  const moves = [];
  if (piece.maou) {
    moves.push(...generateMaouMoves(state, row, col, piece));
  } else if (piece.type === 'K') {
    for (const delta of KING_MOVES) {
      const targetRow = row + delta.r;
      const targetCol = col + delta.c;
      if (!isValidIndex(targetRow) || !isValidIndex(targetCol)) continue;
      const target = state.board[targetRow][targetCol];
      if (target && target.owner === piece.owner) continue;
      const capture = target && target.owner !== piece.owner ? [{ row: targetRow, col: targetCol }] : [];
      addMoveVariants(state, moves, piece, row, col, targetRow, targetCol, capture, { allowMaou: true });
    }
  } else if (piece.type === 'G' || (piece.promoted && ['P', 'L', 'N', 'S'].includes(piece.type))) {
    for (const delta of GOLD_MOVES[piece.owner]) {
      const targetRow = row + delta.r;
      const targetCol = col + delta.c;
      if (!isValidIndex(targetRow) || !isValidIndex(targetCol)) continue;
      const target = state.board[targetRow][targetCol];
      if (target && target.owner === piece.owner) continue;
      const capture = target && target.owner !== piece.owner ? [{ row: targetRow, col: targetCol }] : [];
      addMoveVariants(state, moves, piece, row, col, targetRow, targetCol, capture);
    }
  } else if (piece.type === 'S') {
    for (const delta of SILVER_MOVES[piece.owner]) {
      const targetRow = row + delta.r;
      const targetCol = col + delta.c;
      if (!isValidIndex(targetRow) || !isValidIndex(targetCol)) continue;
      const target = state.board[targetRow][targetCol];
      if (target && target.owner === piece.owner) continue;
      const capture = target && target.owner !== piece.owner ? [{ row: targetRow, col: targetCol }] : [];
      addMoveVariants(state, moves, piece, row, col, targetRow, targetCol, capture);
    }
  } else if (piece.type === 'N') {
    for (const delta of KNIGHT_MOVES[piece.owner]) {
      const targetRow = row + delta.r;
      const targetCol = col + delta.c;
      if (!isValidIndex(targetRow) || !isValidIndex(targetCol)) continue;
      const target = state.board[targetRow][targetCol];
      if (target && target.owner === piece.owner) continue;
      const capture = target && target.owner !== piece.owner ? [{ row: targetRow, col: targetCol }] : [];
      addMoveVariants(state, moves, piece, row, col, targetRow, targetCol, capture);
    }
  } else if (piece.type === 'L') {
    const dir = piece.owner === COLORS.SENTE ? -1 : 1;
    let r = row + dir;
    while (isValidIndex(r)) {
      const target = state.board[r][col];
      if (target) {
        if (target.owner !== piece.owner) {
          addMoveVariants(state, moves, piece, row, col, r, col, [{ row: r, col }]);
        }
        break;
      } else {
        addMoveVariants(state, moves, piece, row, col, r, col, []);
      }
      r += dir;
    }
  } else if (piece.type === 'P') {
    const dir = piece.owner === COLORS.SENTE ? -1 : 1;
    const targetRow = row + dir;
    const targetCol = col;
    if (isValidIndex(targetRow)) {
      const target = state.board[targetRow][targetCol];
      if (!target || target.owner !== piece.owner) {
        const capture = target && target.owner !== piece.owner ? [{ row: targetRow, col: targetCol }] : [];
        addMoveVariants(state, moves, piece, row, col, targetRow, targetCol, capture);
      }
    }
  } else if (piece.type === 'R') {
    moves.push(...generateSlidingMoves(state, row, col, piece, ROOK_DIRS));
  } else if (piece.type === 'B') {
    moves.push(...generateSlidingMoves(state, row, col, piece, BISHOP_DIRS));
  }
  if (piece.promoted && piece.type === 'R') {
    for (const delta of BISHOP_DIRS) {
      const targetRow = row + delta.r;
      const targetCol = col + delta.c;
      if (!isValidIndex(targetRow) || !isValidIndex(targetCol)) continue;
      const target = state.board[targetRow][targetCol];
      if (target && target.owner === piece.owner) continue;
      const capture = target && target.owner !== piece.owner ? [{ row: targetRow, col: targetCol }] : [];
      moves.push(createMove(row, col, targetRow, targetCol, capture, { promote: false }));
    }
  }
  if (piece.promoted && piece.type === 'B') {
    for (const delta of ROOK_DIRS) {
      const targetRow = row + delta.r;
      const targetCol = col + delta.c;
      if (!isValidIndex(targetRow) || !isValidIndex(targetCol)) continue;
      const target = state.board[targetRow][targetCol];
      if (target && target.owner === piece.owner) continue;
      const capture = target && target.owner !== piece.owner ? [{ row: targetRow, col: targetCol }] : [];
      moves.push(createMove(row, col, targetRow, targetCol, capture, { promote: false }));
    }
  }
  if (piece.promoted && ['P', 'L', 'N', 'S'].includes(piece.type)) {
    // Already handled as gold above
  }
  return moves;
}

function generateSlidingMoves(state, row, col, piece, directions) {
  const moves = [];
  for (const dir of directions) {
    let r = row + dir.r;
    let c = col + dir.c;
    while (isValidIndex(r) && isValidIndex(c)) {
      const target = state.board[r][c];
      if (target) {
        if (target.owner !== piece.owner) {
          addMoveVariants(state, moves, piece, row, col, r, c, [{ row: r, col: c }]);
        }
        break;
      } else {
        addMoveVariants(state, moves, piece, row, col, r, c, []);
      }
      r += dir.r;
      c += dir.c;
    }
  }
  return moves;
}

function generateMaouMoves(state, row, col, piece) {
  const moves = [];
  const directions = [...ROOK_DIRS, ...BISHOP_DIRS];
  for (const dir of directions) {
    let r = row + dir.r;
    let c = col + dir.c;
    const captured = [];
    while (isValidIndex(r) && isValidIndex(c)) {
      const target = state.board[r][c];
      if (target) {
        if (target.owner === piece.owner) {
          if (state.allowFriendlyPierce) {
            r += dir.r;
            c += dir.c;
            continue;
          }
          break;
        }
        captured.push({ row: r, col: c });
        moves.push(createMove(row, col, r, c, [...captured], { maou: false }));
        r += dir.r;
        c += dir.c;
        continue;
      }
      moves.push(createMove(row, col, r, c, [...captured], { maou: false }));
      r += dir.r;
      c += dir.c;
    }
  }
  return moves;
}

function addMoveVariants(state, moves, piece, fromRow, fromCol, toRow, toCol, captured, options = {}) {
  const baseMove = createMove(fromRow, fromCol, toRow, toCol, captured, options);
  const inPromotionZone = isPromotionOpportunity(piece.owner, fromRow, toRow);
  const forcedPromotion = isForcedPromotion(piece, toRow);
  if (piece.type === 'K' && !piece.maou && inPromotionZone) {
    moves.push({ ...baseMove, maou: true });
  }
  if (piece.promoted || !PROMOTABLE_TYPES.has(piece.type)) {
    moves.push(baseMove);
    return;
  }
  if (forcedPromotion) {
    moves.push({ ...baseMove, promote: true });
    return;
  }
  moves.push(baseMove);
  if (inPromotionZone) {
    moves.push({ ...baseMove, promote: true });
  }
}

function createMove(fromRow, fromCol, toRow, toCol, captured, options = {}) {
  return {
    type: 'move',
    from: { row: fromRow, col: fromCol },
    to: { row: toRow, col: toCol },
    captured,
    promote: !!options.promote,
    maou: !!options.maou
  };
}

function isPromotionOpportunity(owner, fromRow, toRow) {
  return PROMOTION_ZONE[owner].has(fromRow) || PROMOTION_ZONE[owner].has(toRow);
}

function isForcedPromotion(piece, toRow) {
  if (piece.maou) return false;
  if (piece.promoted) return false;
  if (piece.type === 'P' || piece.type === 'L') {
    if ((piece.owner === COLORS.SENTE && toRow === 0) || (piece.owner === COLORS.GOTE && toRow === 8)) {
      return true;
    }
  }
  if (piece.type === 'N') {
    if ((piece.owner === COLORS.SENTE && toRow <= 1) || (piece.owner === COLORS.GOTE && toRow >= 7)) {
      return true;
    }
  }
  return false;
}

function canDropPiece(state, color, pieceType, row, col) {
  if (pieceType === 'P') {
    if ((color === COLORS.SENTE && row === 0) || (color === COLORS.GOTE && row === 8)) {
      return false;
    }
    for (let r = 0; r < BOARD_SIZE; r += 1) {
      const piece = state.board[r][col];
      if (piece && piece.owner === color && piece.type === 'P' && !piece.promoted) {
        return false;
      }
    }
  }
  if (pieceType === 'L') {
    if ((color === COLORS.SENTE && row === 0) || (color === COLORS.GOTE && row === 8)) {
      return false;
    }
  }
  if (pieceType === 'N') {
    if ((color === COLORS.SENTE && row <= 1) || (color === COLORS.GOTE && row >= 7)) {
      return false;
    }
  }
  return true;
}

function isSquareAttacked(state, row, col, attackerColor) {
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const piece = state.board[r][c];
      if (!piece || piece.owner !== attackerColor) continue;
      if (piece.maou) {
        if (maouAttacksSquare(state, r, c, row, col, piece)) return true;
        continue;
      }
      switch (piece.type) {
        case 'K':
          if (Math.max(Math.abs(r - row), Math.abs(c - col)) === 1) return true;
          break;
        case 'G':
          if (attacksWithGold(piece.owner, r, c, row, col)) return true;
          break;
        case 'S':
          if (!piece.promoted) {
            if (attacksWithSilver(piece.owner, r, c, row, col)) return true;
          } else if (attacksWithGold(piece.owner, r, c, row, col)) {
            return true;
          }
          break;
        case 'N':
          if (!piece.promoted) {
            const deltas = KNIGHT_MOVES[piece.owner];
            for (const d of deltas) {
              if (r + d.r === row && c + d.c === col) return true;
            }
          } else if (attacksWithGold(piece.owner, r, c, row, col)) {
            return true;
          }
          break;
        case 'L':
          if (!piece.promoted) {
            const dir = piece.owner === COLORS.SENTE ? -1 : 1;
            let rr = r + dir;
            let blocked = false;
            while (isValidIndex(rr)) {
              const target = state.board[rr][c];
              if (target) {
                if (rr === row && c === col && target.owner !== piece.owner) {
                  return true;
                }
                blocked = true;
                break;
              }
              if (rr === row && c === col) return true;
              rr += dir;
            }
            if (blocked) {
              continue;
            }
          } else if (attacksWithGold(piece.owner, r, c, row, col)) {
            return true;
          }
          break;
        case 'P':
          if (!piece.promoted) {
            const dir = piece.owner === COLORS.SENTE ? -1 : 1;
            if (r + dir === row && c === col) return true;
          } else if (attacksWithGold(piece.owner, r, c, row, col)) {
            return true;
          }
          break;
        case 'R':
          if (attacksAlongDirections(state, r, c, row, col, piece, ROOK_DIRS)) return true;
          if (piece.promoted && attacksWithKingLike(state, r, c, row, col, BISHOP_DIRS)) return true;
          break;
        case 'B':
          if (attacksAlongDirections(state, r, c, row, col, piece, BISHOP_DIRS)) return true;
          if (piece.promoted && attacksWithKingLike(state, r, c, row, col, ROOK_DIRS)) return true;
          break;
        default:
          break;
      }
    }
  }
  return false;
}

function maouAttacksSquare(state, fromRow, fromCol, targetRow, targetCol, piece) {
  const directions = [...ROOK_DIRS, ...BISHOP_DIRS];
  for (const dir of directions) {
    let r = fromRow + dir.r;
    let c = fromCol + dir.c;
    const captured = [];
    while (isValidIndex(r) && isValidIndex(c)) {
      if (r === targetRow && c === targetCol) {
        return true;
      }
      const target = state.board[r][c];
      if (target) {
        if (target.owner === piece.owner) {
          if (state.allowFriendlyPierce) {
            r += dir.r;
            c += dir.c;
            continue;
          }
          break;
        }
        captured.push({ row: r, col: c });
        if (r === targetRow && c === targetCol) {
          return true;
        }
        r += dir.r;
        c += dir.c;
        continue;
      }
      r += dir.r;
      c += dir.c;
    }
  }
  return false;
}

function attacksWithGold(owner, fromRow, fromCol, targetRow, targetCol) {
  return GOLD_MOVES[owner].some((d) => fromRow + d.r === targetRow && fromCol + d.c === targetCol);
}

function attacksWithSilver(owner, fromRow, fromCol, targetRow, targetCol) {
  return SILVER_MOVES[owner].some((d) => fromRow + d.r === targetRow && fromCol + d.c === targetCol);
}

function attacksAlongDirections(state, fromRow, fromCol, targetRow, targetCol, piece, directions) {
  for (const dir of directions) {
    let r = fromRow + dir.r;
    let c = fromCol + dir.c;
    while (isValidIndex(r) && isValidIndex(c)) {
      const target = state.board[r][c];
      if (r === targetRow && c === targetCol) {
        if (!target || target.owner !== piece.owner) {
          return true;
        }
        break;
      }
      if (target) {
        break;
      }
      r += dir.r;
      c += dir.c;
    }
  }
  return false;
}

function attacksWithKingLike(state, fromRow, fromCol, targetRow, targetCol, deltas) {
  return deltas.some((d) => fromRow + d.r === targetRow && fromCol + d.c === targetCol);
}

function demoteType(type) {
  switch (type) {
    case 'R':
      return 'R';
    case 'B':
      return 'B';
    case 'S':
      return 'S';
    case 'N':
      return 'N';
    case 'L':
      return 'L';
    case 'P':
      return 'P';
    default:
      return type;
  }
}

function findKing(state, color) {
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const piece = state.board[r][c];
      if (!piece) continue;
      if (piece.owner === color && piece.type === 'K') {
        return { row: r, col: c };
      }
      if (piece.owner === color && piece.maou) {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

function deepCloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function clonePiece(piece) {
  return JSON.parse(JSON.stringify(piece));
}

function createInitialBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  const topPieces = ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'];
  const bottomPieces = ['L', 'N', 'S', 'G', 'K', 'G', 'S', 'N', 'L'];
  for (let c = 0; c < BOARD_SIZE; c += 1) {
    board[0][c] = createPiece(topPieces[c], COLORS.GOTE);
    board[8][c] = createPiece(bottomPieces[c], COLORS.SENTE);
    board[2][c] = createPiece('P', COLORS.GOTE);
    board[6][c] = createPiece('P', COLORS.SENTE);
  }
  board[1][1] = createPiece('R', COLORS.GOTE);
  board[1][7] = createPiece('B', COLORS.GOTE);
  board[7][1] = createPiece('B', COLORS.SENTE);
  board[7][7] = createPiece('R', COLORS.SENTE);
  return board;
}

function createPiece(type, owner) {
  return { type, owner, promoted: false, maou: false };
}

function initCaptured() {
  const captured = {};
  for (const type of PIECE_TYPES) {
    captured[type] = 0;
  }
  return captured;
}

function isValidIndex(index) {
  return index >= 0 && index < BOARD_SIZE;
}

function isValidCoord(coord) {
  return coord && isValidIndex(coord.row) && isValidIndex(coord.col);
}

export function oppositeColor(color) {
  return color === COLORS.SENTE ? COLORS.GOTE : COLORS.SENTE;
}
