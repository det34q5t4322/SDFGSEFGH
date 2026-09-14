import unittest
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By

class TestAdminChartRegression(unittest.TestCase):
    def setUp(self):
        chrome_options = Options()
        chrome_options.add_argument("--headless=new")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_experimental_option("mobileEmulation", {
            "deviceMetrics": {"width": 375, "height": 812, "pixelRatio": 3.0},
            "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1"
        })
        self.driver = webdriver.Chrome(options=chrome_options)

    def tearDown(self):
        if self.driver:
            self.driver.quit()

    def test_admin_chart_no_horizontal_overflow_375px(self):
        driver = self.driver
        driver.get("http://127.0.0.1:8000/?dev=1")

        # Bypass onboarding
        driver.execute_script("localStorage.setItem('onboarding_completed', 'true');")
        driver.refresh()
        time.sleep(1)

        # Open admin modal and navigate to stats tab
        driver.execute_script("window.openAdminModal(); window.switchAdminTab('stats');")
        time.sleep(1.5)

        # Check chart container exists
        chart_bars = driver.find_elements(By.CSS_SELECTOR, ".admin-chart-bars")
        self.assertTrue(len(chart_bars) > 0, "Hourly load chart .admin-chart-bars must be rendered")

        # Verify no horizontal page overflow
        scroll_width = driver.execute_script("return document.documentElement.scrollWidth;")
        inner_width = driver.execute_script("return window.innerWidth;")
        print(f"Viewport innerWidth={inner_width}, scrollWidth={scroll_width}")
        self.assertEqual(inner_width, 375, "Inner width should be exactly 375px with mobile emulation")
        self.assertLessEqual(scroll_width, inner_width, f"Horizontal scroll detected! scrollWidth={scroll_width} > innerWidth={inner_width}")

        # Verify .admin-chart-bars containment
        measurements = driver.execute_script("""
            var chart = document.querySelector('.admin-chart-bars');
            var chartRect = chart.getBoundingClientRect();
            var modal = document.querySelector('.admin-modal');
            var modalRect = modal ? modal.getBoundingClientRect() : null;
            return {
                chartWidth: chartRect.width,
                chartLeft: chartRect.left,
                chartRight: chartRect.right,
                modalWidth: modalRect ? modalRect.width : 0,
                modalRight: modalRect ? modalRect.right : 0,
                windowWidth: window.innerWidth
            };
        """)

        print(f"Mobile 375px measurements: {measurements}")
        self.assertLessEqual(measurements['chartRight'], measurements['windowWidth'] + 1, "Chart right edge must not exceed window width")
        self.assertLessEqual(measurements['chartWidth'], measurements['windowWidth'], "Chart width must not exceed window width")

if __name__ == "__main__":
    unittest.main()
