/**
 * Simple Chat Test - Tests conversational and legal queries
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3001';
const SCREENSHOTS_DIR = '/tmp/test-screenshots';
const TEST_EMAIL = 'demo@legalai.test';
const TEST_PASSWORD = 'demo1234';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function takeScreenshot(page, name) {
  const screenshotPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Screenshot: ${screenshotPath}`);
  return screenshotPath;
}

async function waitForResponse(page, timeout = 60000) {
  const startTime = Date.now();
  let lastContent = '';
  let stableCount = 0;

  while (Date.now() - startTime < timeout) {
    await page.waitForTimeout(1000);

    // Look for assistant responses
    const responses = await page.locator('.whitespace-pre-wrap').all();

    for (const resp of responses) {
      const text = await resp.textContent().catch(() => '');
      // Skip user messages and empty content
      if (text && text.length > 10) {
        if (text === lastContent) {
          stableCount++;
          if (stableCount >= 3) {
            return text;
          }
        } else {
          stableCount = 0;
          lastContent = text;
          console.log(`   Streaming: ${text.length} chars...`);
        }
      }
    }
  }

  return lastContent;
}

async function runTests() {
  console.log('🚀 Chat Response Test\n');
  console.log(`Using: ${TEST_EMAIL}\n`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 200,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  });

  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`   [Browser] ${msg.text()}`);
    }
  });

  try {
    // Login
    console.log('🔐 Logging in...');
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', TEST_EMAIL);
    await page.fill('input[type="password"]', TEST_PASSWORD);
    await takeScreenshot(page, 'test-01-login');

    await page.click('button[type="submit"]');

    try {
      await page.waitForURL('**/dashboard/**', { timeout: 15000 });
      console.log('   ✅ Login successful\n');
    } catch (e) {
      console.log('   ❌ Login failed');
      await takeScreenshot(page, 'test-login-failed');
      throw new Error('Login failed');
    }

    // Navigate to chat
    await page.goto(`${BASE_URL}/dashboard/chat`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await takeScreenshot(page, 'test-02-chat-page');

    // TEST 1: Conversational Query
    console.log('🧪 Test 1: Conversational Query');
    console.log('   Sending: "Hello! Are you there?"');

    const textarea = page.locator('textarea');
    await textarea.fill('Hello! Are you there?');
    await takeScreenshot(page, 'test-03-conversational-query');

    const sendButton = page.locator('button').filter({ has: page.locator('svg') }).last();
    await sendButton.click();

    console.log('   Waiting for response...');
    const response1 = await waitForResponse(page);
    await takeScreenshot(page, 'test-04-conversational-response');

    console.log(`\n   📝 Response (${response1.length} chars):`);
    console.log(`   "${response1.substring(0, 300)}${response1.length > 300 ? '...' : ''}"`);

    // Check if response is natural (not document-focused)
    if (response1.toLowerCase().includes("i couldn't find") ||
        response1.toLowerCase().includes("no documents") ||
        response1.toLowerCase().includes("upload a document")) {
      console.log('\n   ❌ FAIL: Response is too document-focused for a greeting');
    } else if (response1.toLowerCase().includes("hello") ||
               response1.toLowerCase().includes("hi") ||
               response1.toLowerCase().includes("help") ||
               response1.toLowerCase().includes("here") ||
               response1.toLowerCase().includes("assist")) {
      console.log('\n   ✅ PASS: Response is conversational');
    } else {
      console.log('\n   ⚠️  UNCLEAR: Review response manually');
    }

    // Wait before next test
    await page.waitForTimeout(3000);

    // TEST 2: Legal Query (if documents exist)
    console.log('\n🧪 Test 2: Legal Document Query');
    console.log('   Sending: "What is the corporate tax rate in the UAE?"');

    // Start a new chat
    const newChatBtn = page.locator('button:has-text("New")').or(page.locator('a[href="/dashboard/chat"]'));
    if (await newChatBtn.isVisible()) {
      await newChatBtn.first().click();
      await page.waitForTimeout(1000);
    }

    await textarea.fill('What is the corporate tax rate in the UAE?');
    await takeScreenshot(page, 'test-05-legal-query');

    await sendButton.click();

    console.log('   Waiting for response...');
    const response2 = await waitForResponse(page);
    await takeScreenshot(page, 'test-06-legal-response');

    console.log(`\n   📝 Response (${response2.length} chars):`);
    console.log(`   "${response2.substring(0, 400)}${response2.length > 400 ? '...' : ''}"`);

    // Check for tax information
    if (response2.includes('9%') || response2.includes('nine percent')) {
      console.log('\n   ✅ PASS: Response contains correct tax rate (9%)');
    } else if (response2.toLowerCase().includes("document") || response2.toLowerCase().includes("upload")) {
      console.log('\n   ℹ️  INFO: Response asks about documents (expected if none uploaded)');
    } else {
      console.log('\n   ⚠️  Review response manually');
    }

    console.log('\n✅ Tests Complete!');
    console.log(`📁 Screenshots: ${SCREENSHOTS_DIR}`);

    // Keep browser open briefly
    console.log('\nBrowser closing in 5 seconds...');
    await page.waitForTimeout(5000);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await takeScreenshot(page, 'test-error');
  } finally {
    await browser.close();
  }
}

runTests().catch(console.error);
