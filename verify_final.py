from playwright.sync_api import Page, sync_playwright
import time

def verify_feature(page: Page):
    print("Navigating to home page...")
    page.goto("http://localhost:3000", timeout=60000)
    page.wait_for_timeout(2000)

    print("Scrolling to footer to check links...")
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(1000)

    print("Taking screenshot of footer...")
    page.screenshot(path="/home/jules/verification/home_footer_clean.png")

if __name__ == "__main__":
    import os
    os.makedirs("/home/jules/verification/video_final", exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir="/home/jules/verification/video_final", viewport={"width": 1280, "height": 800})
        page = context.new_page()
        try:
            verify_feature(page)
        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
        finally:
            context.close()
            browser.close()
            print("Done")
