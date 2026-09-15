import unittest
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

class TestGamesLeakAndStress(unittest.TestCase):
    def setUp(self):
        chrome_options = Options()
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
        chrome_options.add_experimental_option("mobileEmulation", {
            "deviceMetrics": {"width": 375, "height": 812, "pixelRatio": 3.0},
            "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1"
        })
        self.driver = webdriver.Chrome(options=chrome_options)

    def tearDown(self):
        if self.driver:
            self.driver.quit()

    def test_games_10x_mount_unmount_leak_stress(self):
        driver = self.driver
        driver.get("http://127.0.0.1:8000/?dev=1")

        # Bypass onboarding
        driver.execute_script("localStorage.setItem('onboarding_completed', 'true');")
        driver.refresh()
        time.sleep(1.5)

        # 1. Open Games Modal
        driver.execute_script("window.openGamesModal();")
        time.sleep(0.5)

        modal_display = driver.execute_script("return document.getElementById('gamesModal').style.display;")
        self.assertEqual(modal_display, "flex", "gamesModal should be visible")

        # 2. Test 10x Mount/Unmount Cycle for each game
        games = ['2048', 'tetris', 'minesweeper']

        for game_id in games:
            print(f"\n--- Testing 10x cycle stress test for {game_id} ---")
            for cycle in range(1, 11):
                # Open game
                driver.execute_script(f"window.openGame('{game_id}');")
                time.sleep(0.25)

                # Verify game viewport populated
                has_content = driver.execute_script(
                    "return document.getElementById('gameViewport').children.length > 0;"
                )
                self.assertTrue(has_content, f"Cycle {cycle}: {game_id} should have content in gameViewport")

                # Close game back to catalog
                driver.execute_script("window.backToGamesCatalog();")
                time.sleep(0.1)

                # Verify viewport is cleared and activeInstance is null
                is_cleaned = driver.execute_script("""
                    var state = window._getGameDebugState ? window._getGameDebugState() : null;
                    return Boolean(
                        state &&
                        state.viewportChildren === 0 &&
                        state.activeInstance === null &&
                        state.activeGameId === null &&
                        state.gameTimerInterval === null
                    );
                """)
                self.assertTrue(is_cleaned, f"Cycle {cycle}: {game_id} should be cleanly unmounted with zero remnants")

            print(f"PASS: 10/10 cycles cleanly mounted and unmounted for {game_id}")

        # 3. Verify no critical JS errors in browser console
        logs = driver.get_log('browser')
        severe_errors = [l for l in logs if l['level'] == 'SEVERE' and 'favicon' not in l['message'].lower()]
        print(f"Browser console logs count: {len(logs)}, Severe errors: {len(severe_errors)}")
        for err in severe_errors:
            print("Console Error:", err['message'])
        self.assertEqual(len(severe_errors), 0, "There should be 0 severe JavaScript errors in console")

    def test_games_responsive_layout_375px(self):
        driver = self.driver
        driver.get("http://127.0.0.1:8000/?dev=1")
        driver.execute_script("localStorage.setItem('onboarding_completed', 'true');")
        driver.refresh()
        time.sleep(1.5)

        driver.execute_script("window.openGamesModal();")
        time.sleep(0.5)

        # Verify games catalog fits in 375px
        scroll_width = driver.execute_script("return document.documentElement.scrollWidth;")
        inner_width = driver.execute_script("return window.innerWidth;")
        self.assertEqual(inner_width, 375)
        self.assertLessEqual(scroll_width, inner_width, "Catalog should not cause horizontal overflow")

        games = ['2048', 'tetris', 'minesweeper']
        for game_id in games:
            driver.execute_script(f"window.openGame('{game_id}');")
            time.sleep(0.5)

            # Check no horizontal blowout
            sw = driver.execute_script("return document.documentElement.scrollWidth;")
            self.assertLessEqual(sw, 375, f"{game_id} caused horizontal overflow: scrollWidth={sw}")

            # Check viewport rect fits screen width
            vp_width = driver.execute_script(
                "return document.getElementById('gameViewport').getBoundingClientRect().width;"
            )
            self.assertLessEqual(vp_width, 375, f"{game_id} viewport wider than 375px: {vp_width}")
            print(f"PASS: {game_id} fits perfectly in 375px (vp_width={vp_width}, scrollWidth={sw})")

            driver.execute_script("window.backToGamesCatalog();")
            time.sleep(0.2)

        driver.execute_script("window.closeGamesModal();")
        time.sleep(0.2)
        print("PASS: Responsive layout verified for all 3 games on 375px")

    def test_gameplay_mechanics(self):
        driver = self.driver
        driver.get("http://127.0.0.1:8000/?dev=1")
        driver.execute_script("localStorage.setItem('onboarding_completed', 'true');")
        driver.refresh()
        time.sleep(1.5)

        driver.execute_script("window.openGamesModal();")
        time.sleep(0.5)

        # 1. 2048 Gameplay
        driver.execute_script("window.openGame('2048');")
        time.sleep(0.4)
        tiles_count = driver.execute_script(
            "return document.querySelectorAll('.g2048-tile').length;"
        )
        self.assertGreaterEqual(tiles_count, 2, "2048 should start with at least 2 tiles")

        # Simulate arrow key moves
        from selenium.webdriver.common.keys import Keys
        body = driver.find_element(By.TAG_NAME, "body")
        for _ in range(5):
            body.send_keys(Keys.ARROW_DOWN)
            time.sleep(0.05)
            body.send_keys(Keys.ARROW_RIGHT)
            time.sleep(0.05)

        score_2048 = driver.execute_script(
            "return parseInt(document.getElementById('g2048Score').textContent, 10);"
        )
        print(f"2048 Gameplay test passed. Current score: {score_2048}")

        # 2. Tetris Gameplay
        driver.execute_script("window.openGame('tetris');")
        time.sleep(0.4)
        canvas_present = driver.execute_script(
            "return document.getElementById('tetrisCanvas') !== null;"
        )
        self.assertTrue(canvas_present, "Tetris canvas should exist")

        # Simulate drop and movements
        btn_drop = driver.find_element(By.ID, "tBtnDrop")
        btn_drop.click()
        time.sleep(0.2)
        btn_drop.click()
        time.sleep(0.2)

        tetris_score = driver.execute_script(
            "return parseInt(document.getElementById('tetrisScore').textContent, 10);"
        )
        self.assertGreater(tetris_score, 0, "Tetris hard drop should award points")
        print(f"Tetris Gameplay test passed. Current score: {tetris_score}")

        # 3. Minesweeper Gameplay
        driver.execute_script("window.openGame('minesweeper');")
        time.sleep(0.4)

        cells = driver.find_elements(By.CSS_SELECTOR, ".ms-cell")
        self.assertEqual(len(cells), 81, "9x9 Minesweeper should have 81 cells")

        # First click on center cell
        center_cell = cells[40]
        center_cell.click()
        time.sleep(0.3)

        revealed_cells = driver.find_elements(By.CSS_SELECTOR, ".ms-cell.revealed")
        self.assertGreater(len(revealed_cells), 0, "Clicking a cell should reveal it")

        # Safe first click guarantee check: center cell should NOT be a mine
        center_is_mine = driver.execute_script(
            "return document.querySelectorAll('.ms-cell')[40].classList.contains('mine');"
        )
        self.assertFalse(center_is_mine, "Safe first click guarantee violated: clicked mine on move 1!")

        # Timer should have started
        time.sleep(1.1)
        timer_val = driver.execute_script(
            "return parseInt(document.getElementById('msTimer').textContent, 10);"
        )
        self.assertGreaterEqual(timer_val, 1, "Minesweeper timer should count elapsed seconds")
        print(f"Minesweeper Gameplay test passed. Revealed: {len(revealed_cells)}, Timer: {timer_val}s")

        driver.execute_script("window.backToGamesCatalog(); window.closeGamesModal();")
        time.sleep(0.3)
        print("PASS: Gameplay mechanics verified for all 3 games!")

if __name__ == "__main__":
    unittest.main()
