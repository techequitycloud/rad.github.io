from playwright.sync_api import sync_playwright

def verify_meta():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto("http://localhost:3000")

        # We need to verify meta tags
        og_image = page.locator('meta[property="og:image"]').get_attribute('content')
        og_desc = page.locator('meta[property="og:description"]').get_attribute('content')
        desc = page.locator('meta[name="description"]').get_attribute('content')

        print(f"og:image: {og_image}")
        print(f"og:description: {og_desc}")
        print(f"description: {desc}")

        page.screenshot(path="/home/jules/verification.png")

        browser.close()

if __name__ == "__main__":
    verify_meta()
