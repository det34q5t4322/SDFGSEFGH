import asyncio
import json
import logging
import random
import string
import time
from typing import Dict, List, Optional, Any, Tuple
from fastapi import WebSocket

import db

logger = logging.getLogger(__name__)

# Срок жизни неактивной комнаты до автоочистки (20 минут)
ROOM_TTL_SECONDS = 1200
DISCONNECT_GRACE_SECONDS = 15


def generate_room_code(length: int = 6) -> str:
    """Генерирует легко читаемый 6-значный код комнаты (без 0/O и 1/I)."""
    alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
    return "".join(random.choices(alphabet, k=length))


class DuelRoom:
    def __init__(self, room_id: str, game_id: str, host_info: Dict[str, Any]):
        self.room_id = room_id
        self.game_id = game_id.lower()
        self.created_at = time.time()
        self.last_activity = time.time()

        # Игроки
        self.host = host_info  # {telegram_id, name, photo_url, rating}
        self.guest: Optional[Dict[str, Any]] = None

        self.status = "waiting"  # waiting | lobby | countdown | playing | round_over | match_over
        self.rounds_to_win = 2  # Best of 3 (первый до 2 побед)
        self.current_round = 1

        # Счёт раундов: {telegram_id: wins_count}
        self.round_wins: Dict[int, int] = {self.host["telegram_id"]: 0}

        # Текущие WebSocket соединения: {telegram_id: WebSocket}
        self.connections: Dict[int, WebSocket] = {}

        # Флаги готовности: {telegram_id: bool}
        self.ready_states: Dict[int, bool] = {self.host["telegram_id"]: False}

        # Таймеры дисконнекта: {telegram_id: asyncio.Task}
        self.disconnect_tasks: Dict[int, asyncio.Task] = {}

        # Общий seed для раунда (для синхронных блоков тетриса или спавна 2048)
        self.round_seed = random.randint(100000, 999999)

        # Результат матча
        self.match_result: Optional[Dict[str, Any]] = None

    def touch(self):
        self.last_activity = time.time()

    def get_player(self, telegram_id: int) -> Optional[Dict[str, Any]]:
        if self.host and self.host["telegram_id"] == telegram_id:
            return self.host
        if self.guest and self.guest["telegram_id"] == telegram_id:
            return self.guest
        return None

    def get_opponent_id(self, telegram_id: int) -> Optional[int]:
        if self.host and self.host["telegram_id"] == telegram_id:
            return self.guest["telegram_id"] if self.guest else None
        if self.guest and self.guest["telegram_id"] == telegram_id:
            return self.host["telegram_id"]
        return None

    def to_dict(self) -> Dict[str, Any]:
        """Публичное представление комнаты для лобби."""
        return {
            "room_id": self.room_id,
            "game_id": self.game_id,
            "status": self.status,
            "created_at": self.created_at,
            "rounds_to_win": self.rounds_to_win,
            "current_round": self.current_round,
            "host": {
                "telegram_id": self.host["telegram_id"],
                "name": self.host.get("name") or "Хост",
                "photo_url": self.host.get("photo_url", ""),
                "rating": self.host.get("rating", 1000)
            },
            "guest": {
                "telegram_id": self.guest["telegram_id"],
                "name": self.guest.get("name") or "Соперник",
                "photo_url": self.guest.get("photo_url", ""),
                "rating": self.guest.get("rating", 1000)
            } if self.guest else None,
            "round_wins": {str(k): v for k, v in self.round_wins.items()},
            "ready": {str(k): v for k, v in self.ready_states.items()}
        }

    async def broadcast(self, message: Dict[str, Any]):
        """Рассылает JSON сообщение всем подключенным игрокам."""
        payload = json.dumps(message)
        dead = []
        for tid, ws in list(self.connections.items()):
            try:
                await ws.send_text(payload)
            except Exception as e:
                logger.warning(f"Error broadcasting to {tid} in {self.room_id}: {e}")
                dead.append(tid)
        for tid in dead:
            self.connections.pop(tid, None)

    async def send_to(self, telegram_id: int, message: Dict[str, Any]):
        """Отправляет JSON сообщение конкретному игроку."""
        ws = self.connections.get(telegram_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception as e:
                logger.warning(f"Error sending to {telegram_id} in {self.room_id}: {e}")
                self.connections.pop(telegram_id, None)


class DuelManager:
    def __init__(self):
        self._rooms: Dict[str, DuelRoom] = {}
        self._lock = asyncio.Lock()

    async def create_room(self, game_id: str, host_info: Dict[str, Any]) -> DuelRoom:
        async with self._lock:
            # Очистка старых комнат хоста
            hid = host_info["telegram_id"]
            for rid, room in list(self._rooms.items()):
                if (room.host and room.host["telegram_id"] == hid) or (room.guest and room.guest["telegram_id"] == hid):
                    if room.status in ("waiting", "match_over"):
                        self._rooms.pop(rid, None)

            # Генерация уникального кода
            for _ in range(20):
                code = generate_room_code()
                if code not in self._rooms:
                    break
            else:
                code = f"RM{random.randint(1000, 9999)}"

            room = DuelRoom(code, game_id, host_info)
            self._rooms[code] = room
            logger.info(f"Created duel room {code} ({game_id}) by user {hid}")
            return room

    async def get_room(self, room_id: str) -> Optional[DuelRoom]:
        code = room_id.strip().upper()
        return self._rooms.get(code)

    async def get_open_rooms(self) -> List[Dict[str, Any]]:
        """Возвращает список комнат, доступных для подключения."""
        now = time.time()
        result = []
        async with self._lock:
            # Чистим протухшие комнаты
            expired = [rid for rid, r in self._rooms.items() if now - r.last_activity > ROOM_TTL_SECONDS]
            for rid in expired:
                self._rooms.pop(rid, None)

            for room in self._rooms.values():
                if room.status == "waiting":
                    result.append(room.to_dict())
        result.sort(key=lambda x: x["created_at"], reverse=True)
        return result

    async def join_room(self, room_id: str, guest_info: Dict[str, Any]) -> Tuple[bool, str, Optional[DuelRoom]]:
        async with self._lock:
            code = room_id.strip().upper()
            room = self._rooms.get(code)
            if not room:
                return False, "Комната не найдена", None

            gid = guest_info["telegram_id"]

            # Если игрок уже хост
            if room.host["telegram_id"] == gid:
                return True, "Вы создатель этой комнаты", room

            # Если игрок уже гость
            if room.guest and room.guest["telegram_id"] == gid:
                return True, "Вы уже в этой комнате", room

            # Если комната уже занята
            if room.guest is not None and room.status != "waiting":
                return False, "Комната уже заполнена", None

            room.guest = guest_info
            room.round_wins[gid] = 0
            room.ready_states[gid] = False
            room.status = "lobby"
            room.touch()

            logger.info(f"User {gid} joined duel room {code}")
            await room.broadcast({
                "type": "player_connected",
                "telegram_id": gid,
                "room": room.to_dict()
            })
            return True, "Успешное подключение", room

    async def handle_connect(self, room: DuelRoom, telegram_id: int, websocket: WebSocket):
        """Подключение сокета игрока и отмена таймера дисконнекта при возврате."""
        room.connections[telegram_id] = websocket
        room.touch()

        # Отменяем таймер grace-периода, если был дисконнект
        task = room.disconnect_tasks.pop(telegram_id, None)
        if task and not task.done():
            task.cancel()
            logger.info(f"User {telegram_id} reconnected to room {room.room_id} in time")
            await room.broadcast({
                "type": "opponent_reconnected",
                "telegram_id": telegram_id
            })

        # Отправляем текущее состояние комнаты
        await room.send_to(telegram_id, {
            "type": "room_state",
            "room": room.to_dict(),
            "my_id": telegram_id
        })

        # Уведомляем оппонента о подключении
        opp_id = room.get_opponent_id(telegram_id)
        if opp_id and opp_id in room.connections:
            await room.send_to(opp_id, {
                "type": "player_connected",
                "telegram_id": telegram_id,
                "room": room.to_dict()
            })

    async def handle_disconnect(self, room: DuelRoom, telegram_id: int):
        """Обработка обрыва связи: даётся 15 секунд на переподключение."""
        room.connections.pop(telegram_id, None)
        room.touch()

        # Если матч уже завершён или комната ещё в ожидании
        if room.status in ("waiting", "match_over"):
            if room.status == "waiting" and room.host["telegram_id"] == telegram_id:
                async with self._lock:
                    self._rooms.pop(room.room_id, None)
            return

        opp_id = room.get_opponent_id(telegram_id)
        if not opp_id:
            return

        logger.info(f"User {telegram_id} disconnected from room {room.room_id}. Starting 15s grace timer.")

        # Уведомляем соперника об обрыве
        await room.send_to(opp_id, {
            "type": "opponent_disconnected",
            "telegram_id": telegram_id,
            "grace_seconds": DISCONNECT_GRACE_SECONDS
        })

        async def _grace_countdown():
            try:
                await asyncio.sleep(DISCONNECT_GRACE_SECONDS)
                # Если игрок не вернулся
                if telegram_id not in room.connections and room.status != "match_over":
                    logger.info(f"User {telegram_id} forfeited room {room.room_id} due to timeout")
                    await self.finish_match(room, winner_id=opp_id, forfeit_by=telegram_id)
            except asyncio.CancelledError:
                pass

        task = asyncio.create_task(_grace_countdown())
        room.disconnect_tasks[telegram_id] = task

    async def handle_message(self, room: DuelRoom, telegram_id: int, data: Dict[str, Any]):
        """Маршрутизация сообщений матча."""
        msg_type = data.get("type")
        room.touch()

        if msg_type == "ready":
            is_ready = bool(data.get("ready", True))
            room.ready_states[telegram_id] = is_ready
            await room.broadcast({
                "type": "ready_update",
                "ready": {str(k): v for k, v in room.ready_states.items()}
            })

            # Если оба игрока готовы — запускаем раунд
            if room.guest and all(room.ready_states.get(tid, False) for tid in (room.host["telegram_id"], room.guest["telegram_id"])):
                await self.start_round_sequence(room)

        elif msg_type == "state_update":
            # Пересылаем обновление сетки и очков сопернику
            opp_id = room.get_opponent_id(telegram_id)
            if opp_id and opp_id in room.connections:
                await room.send_to(opp_id, {
                    "type": "opponent_state",
                    "telegram_id": telegram_id,
                    "score": data.get("score", 0),
                    "grid": data.get("grid"),
                    "aux": data.get("aux")
                })

        elif msg_type == "attack":
            # Тетрис: отправка штрафных линий сопернику
            opp_id = room.get_opponent_id(telegram_id)
            lines = max(1, min(int(data.get("lines", 1)), 8))
            if opp_id and opp_id in room.connections:
                await room.send_to(opp_id, {
                    "type": "incoming_attack",
                    "from_player": telegram_id,
                    "lines": lines
                })

        elif msg_type == "game_action":
            # Пересылаем игровое действие (атака картой, защита, бито, взятие) сопернику
            opp_id = room.get_opponent_id(telegram_id)
            if opp_id and opp_id in room.connections:
                await room.send_to(opp_id, {
                    "type": "game_action",
                    "from_player": telegram_id,
                    "action": data.get("action"),
                    "payload": data.get("payload")
                })

        elif msg_type == "round_lost":
            # Игрок проиграл текущий раунд (врезался / заполнился стакан)
            opp_id = room.get_opponent_id(telegram_id)
            if opp_id and room.status == "playing":
                await self.handle_round_winner(room, winner_id=opp_id)

        elif msg_type == "ping":
            await room.send_to(telegram_id, {"type": "pong", "time": time.time()})

    async def start_round_sequence(self, room: DuelRoom):
        """Быстрый динамичный отсчёт перед раундом 2..1 и старт."""
        room.status = "countdown"
        room.round_seed = random.randint(100000, 999999)

        for sec in (2, 1):
            await room.broadcast({
                "type": "countdown",
                "seconds": sec,
                "round": room.current_round
            })
            await asyncio.sleep(0.7)

        room.status = "playing"
        await room.broadcast({
            "type": "round_start",
            "round": room.current_round,
            "seed": room.round_seed,
            "round_wins": {str(k): v for k, v in room.round_wins.items()}
        })

    async def handle_round_winner(self, room: DuelRoom, winner_id: int):
        """Фиксация победы в раунде."""
        room.status = "round_over"
        room.round_wins[winner_id] = room.round_wins.get(winner_id, 0) + 1

        w_count = room.round_wins[winner_id]
        logger.info(f"Round {room.current_round} won by {winner_id} in {room.room_id}. Total: {w_count}/{room.rounds_to_win}")

        await room.broadcast({
            "type": "round_end",
            "winner_id": winner_id,
            "round": room.current_round,
            "round_wins": {str(k): v for k, v in room.round_wins.items()}
        })

        if w_count >= room.rounds_to_win:
            # Матч выигран!
            await self.finish_match(room, winner_id=winner_id)
        else:
            # Следующий раунд через 1.5 секунды (быстрый темп)
            room.current_round += 1
            for tid in room.ready_states:
                room.ready_states[tid] = True

            async def _next_round():
                await asyncio.sleep(1.5)
                if room.status == "round_over":
                    await self.start_round_sequence(room)

            asyncio.create_task(_next_round())

    async def finish_match(self, room: DuelRoom, winner_id: int, forfeit_by: Optional[int] = None):
        """Завершение матча, подсчет ELO и сохранение в БД."""
        room.status = "match_over"
        h_id = room.host["telegram_id"]
        g_id = room.guest["telegram_id"] if room.guest else 0

        # Сохранение в SQLite через db.record_duel_match_result
        try:
            elo_result = db.record_duel_match_result(
                match_id=f"duel_{room.room_id}_{int(time.time())}",
                game_id=room.game_id,
                p1_id=h_id,
                p2_id=g_id,
                p1_score=room.round_wins.get(h_id, 0),
                p2_score=room.round_wins.get(g_id, 0),
                winner_id=winner_id
            )
            room.match_result = elo_result
        except Exception as e:
            logger.error(f"Error recording duel match result: {e}")
            elo_result = {
                "p1_id": h_id, "p2_id": g_id, "winner_id": winner_id,
                "p1_delta": 20 if winner_id == h_id else -20,
                "p2_delta": 20 if winner_id == g_id else -20,
                "p1_new_rating": 1020 if winner_id == h_id else 980,
                "p2_new_rating": 1020 if winner_id == g_id else 980
            }

        p1_d = elo_result.get("p1_delta", 20 if winner_id == h_id else -20)
        p2_d = elo_result.get("p2_delta", 20 if winner_id == g_id else -20)
        p1_r = elo_result.get("p1_new_rating", 1000)
        p2_r = elo_result.get("p2_new_rating", 1000)

        elo_data = {
            "winner_id": winner_id,
            "deltas": {
                str(h_id): p1_d,
                str(g_id): p2_d
            },
            "new_ratings": {
                str(h_id): p1_r,
                str(g_id): p2_r
            }
        }

        await room.broadcast({
            "type": "match_over",
            "winner_id": winner_id,
            "forfeit_by": forfeit_by,
            "round_wins": {str(k): v for k, v in room.round_wins.items()},
            "elo": elo_data
        })

        # Планируем удаление комнаты через 5 минут
        async def _cleanup():
            await asyncio.sleep(300)
            async with self._lock:
                self._rooms.pop(room.room_id, None)

        asyncio.create_task(_cleanup())


duel_manager = DuelManager()
