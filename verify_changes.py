from playwright.sync_api import sync_playwright

def verify_changes():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Verify Workflow Tutorial Page
        print("Navigating to Workflow Tutorial...")
        page.goto("http://localhost:3000/docs/workflows/roi-tutorial")

        # Verify Title
        title = page.locator("h1").inner_text()
        print(f"Page Title: {title}")
        if title != "Tutorial: ROI Calculator":
            print("ERROR: Incorrect Page Title")
        else:
            print("SUCCESS: Page Title Verified")

        # Verify Sidebar for Workflows
        # The sidebar item should be "ROI" and active (link to current page)
        sidebar_item = page.get_by_role("link", name="ROI", exact=True).first
        if sidebar_item.is_visible():
             print("SUCCESS: Sidebar 'ROI' item found")
        else:
             print("ERROR: Sidebar 'ROI' item NOT found")

        page.screenshot(path="verification_workflow.png")

        # 2. Verify Guide Page
        print("Navigating to Guide Page...")
        page.goto("http://localhost:3000/docs/guides/roi-guide")

        # Verify Sidebar for Guides
        # The sidebar item should be "ROI"
        # We need to distinguish between the two 'ROI' links if both are visible.
        # But Docusaurus usually keeps sidebar structure.

        # Let's just check if "ROI Calculator" is GONE and "ROI" is present.

        roi_calc_link = page.get_by_role("link", name="ROI Calculator")
        if roi_calc_link.count() > 0 and roi_calc_link.is_visible():
            print("ERROR: 'ROI Calculator' still visible in sidebar")
        else:
            print("SUCCESS: 'ROI Calculator' not visible")

        roi_link = page.get_by_role("link", name="ROI", exact=True).first
        if roi_link.is_visible():
             print("SUCCESS: Sidebar 'ROI' item found in Guides")

        page.screenshot(path="verification_guide.png")

        browser.close()

if __name__ == "__main__":
    verify_changes()
