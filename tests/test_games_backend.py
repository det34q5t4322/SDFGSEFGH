import time
import sys
from pathlib import Path
from fastapi.testclient import TestClient

root = Path(__file__).parent.parent
sys.path.insert(0, str(root / "server"))

import db
from app import app

client = TestClient(app)

def test_db_record_and_get_game_stats():
    db.init_db()
    uid = int(time.time() * 1000) % 1_000_000_000

    # Record 2048
    res = db.record_game_stats(telegram_id=uid, game_id="2048", score=2048, time_delta=30)
    assert res["high_score"] == 2048
    assert res["total_time_seconds"] == 30

    # Lower score should not overwrite high_score, but time accumulates
    res2 = db.record_game_stats(telegram_id=uid, game_id="2048", score=1024, time_delta=15)
    assert res2["high_score"] == 2048
    assert res2["total_time_seconds"] == 45

    # Tetris
    res_t = db.record_game_stats(telegram_id=uid, game_id="tetris", score=5000, time_delta=20)
    assert res_t["high_score"] == 5000
    assert res_t["total_time_seconds"] == 20

    stats = db.get_user_game_stats(uid)
    assert "2048" in stats["my_stats"]
    assert stats["my_stats"]["2048"]["high_score"] == 2048
    assert stats["my_stats"]["tetris"]["high_score"] == 5000
    assert "leaderboards" in stats
    assert "minesweeper" in stats["leaderboards"]
    print("test_db_record_and_get_game_stats PASSED")

def test_api_games_stats_endpoint():
    res = client.get("/api/games/stats")
    assert res.status_code == 200
    data = res.json()
    assert "my_stats" in data
    assert "leaderboards" in data
    print("test_api_games_stats_endpoint PASSED")

def test_api_activity_with_game_data():
    payload = {
        "group": "ИСС9-25",
        "action": "Игра: 2048",
        "game_id": "2048",
        "game_score": 4096,
        "game_time_delta": 20
    }
    res = client.post("/api/activity", json=payload)
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    print("test_api_activity_with_game_data PASSED")

if __name__ == "__main__":
    test_db_record_and_get_game_stats()
    test_api_games_stats_endpoint()
    test_api_activity_with_game_data()
    print("ALL BACKEND GAME TESTS PASSED!")
