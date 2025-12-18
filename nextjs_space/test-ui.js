/**
 * UI Test Script using Playwright
 * Tests the chat interface, message sending, and streaming responses
 *
 * Usage:
 *   TEST_EMAIL=your@email.com TEST_PASSWORD=yourpass node test-ui.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Test configuration
const BASE_URL = 'http://localhost:3001';
const SCREENSHOTS_DIR = '/tmp/test-screenshots';
const TEST_EMAIL = process.env.TEST_EMAIL || '';
const TEST_PASSWORD = process.env.TEST_PASSWORD || '';

// Create screenshots directory
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

console.log('🔧 Configuration:');
console.log(`   - Email: ${TEST_EMAIL ? TEST_EMAIL.substring(0,3) + '***' : '(not set)'}`);
console.log(`   - Password: ${TEST_PASSWORD ? '***' : '(not set)'}`);

async function takeScreenshot(page, name) {
  const screenshotPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Screenshot saved: ${screenshotPath}`);
  return screenshotPath;
}

async function testLandingPage(page) {
  console.log('\n🧪 Testing Landing Page...');

  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Take screenshot
  await takeScreenshot(page, '01-landing-page');

  // Check for login form
  const welcomeText = await page.locator('h1').textContent();
  console.log(`   - Page title: "${welcomeText}"`);

  const emailInput = await page.locator('input[type="email"]');
  const passwordInput = await page.locator('input[type="password"]');
  const submitButton = await page.locator('button[type="submit"]');

  if (await emailInput.isVisible() && await passwordInput.isVisible() && await submitButton.isVisible()) {
    console.log('   ✅ Login form is visible');
    return true;
  } else {
    console.log('   ❌ Login form not found');
    return false;
  }
}

async function testLogin(page, email, password) {
  console.log('\n🧪 Testing Login...');

  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Fill login form
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);

  await takeScreenshot(page, '02-login-filled');

  // Submit form
  await page.click('button[type="submit"]');

  console.log('   - Waiting for redirect...');

  // Wait for navigation or error
  try {
    await page.waitForURL('**/dashboard/**', { timeout: 15000 });
    console.log('   ✅ Login successful, redirected to dashboard');
    await page.waitForTimeout(2000); // Wait for page to fully load
    await takeScreenshot(page, '03-after-login');
    return true;
  } catch (e) {
    console.log('   ❌ Login failed or timeout');
    await takeScreenshot(page, '03-login-failed');

    // Check for error message
    const errorMessage = await page.locator('.text-red-600').textContent().catch(() => null);
    if (errorMessage) {
      console.log(`   - Error: ${errorMessage}`);
    }

    // Check current URL
    console.log(`   - Current URL: ${page.url()}`);
    return false;
  }
}

async function testChatPage(page) {
  console.log('\n🧪 Testing Chat Page...');

  await page.goto(`${BASE_URL}/dashboard/chat`);

  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch (e) {
    console.log('   - Network still loading, proceeding...');
  }

  await takeScreenshot(page, '04-chat-page');

  // Check for chat elements
  const greeting = await page.locator('h1').textContent().catch(() => '');
  console.log(`   - Greeting: "${greeting}"`);

  // Check for textarea
  const textarea = await page.locator('textarea');
  if (await textarea.isVisible()) {
    console.log('   ✅ Chat input textarea is visible');
  }

  // Check for sidebar
  const newChatButton = await page.locator('button:has-text("New chat")');
  if (await newChatButton.isVisible()) {
    console.log('   ✅ Sidebar with New chat button is visible');
  }

  return true;
}

async function testSendMessage(page, message) {
  console.log('\n🧪 Testing Message Sending...');
  console.log(`   - Message: "${message}"`);

  // Type message in textarea
  const textarea = await page.locator('textarea');
  await textarea.fill(message);

  await takeScreenshot(page, '05-message-typed');

  // Find and click send button
  const sendButton = await page.locator('button:has(svg)').last();
  await sendButton.click();

  console.log('   - Message sent, waiting for response...');

  // Wait for response to appear
  await page.waitForTimeout(2000);
  await takeScreenshot(page, '06-message-sent');

  // Wait for streaming response
  let responseText = '';
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);

    // Check for response text
    const messages = await page.locator('.whitespace-pre-wrap').all();
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const text = await lastMessage.textContent();
      if (text && text.length > responseText.length) {
        responseText = text;
        console.log(`   - Response streaming: ${text.length} chars...`);
      }

      // Check if streaming is complete (text stopped changing)
      if (i > 3 && text === responseText) {
        console.log('   - Response complete');
        break;
      }
    }

    // Check for error message
    const errorPattern = /Sorry, an error occurred/i;
    if (responseText && errorPattern.test(responseText)) {
      console.log('   ❌ Error response received');
      break;
    }
  }

  await takeScreenshot(page, '07-response-complete');

  console.log(`   - Final response length: ${responseText.length} chars`);
  console.log(`   - Response preview: "${responseText.substring(0, 200)}..."`);

  return responseText;
}

async function runTests() {
  console.log('🚀 Starting UI Tests\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Screenshots: ${SCREENSHOTS_DIR}\n`);

  const browser = await chromium.launch({
    headless: false,  // Show browser window
    slowMo: 500,      // Slow down actions so you can see them
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();

  // Enable console logging from the page
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`   [Browser Error] ${msg.text()}`);
    }
  });

  page.on('pageerror', error => {
    console.log(`   [Page Error] ${error.message}`);
  });

  try {
    // Test 1: Landing Page
    await testLandingPage(page);

    // Test 2: Login
    if (TEST_EMAIL && TEST_PASSWORD) {
      const loginSuccess = await testLogin(page, TEST_EMAIL, TEST_PASSWORD);

      if (loginSuccess) {
        // Test 3: Chat Page
        await testChatPage(page);

        // Test 4: Send Message from test dataset
        const testQuestion = "What is the standard corporate tax rate in the UAE?";
        const response = await testSendMessage(page, testQuestion);

        // Analyze response quality
        console.log('\n📊 Response Analysis:');
        if (response) {
          if (response.includes('9%') || response.includes('nine percent')) {
            console.log('   ✅ Response contains expected tax rate information');
          }
          if (response.includes('375,000') || response.includes('375000')) {
            console.log('   ✅ Response contains expected threshold information');
          }
          if (response.toLowerCase().includes('error')) {
            console.log('   ❌ Response contains error message');
          }
        }
      }
    } else {
      console.log('\n⚠️  No test credentials provided.');
      console.log('   Set TEST_EMAIL and TEST_PASSWORD environment variables to test login.');
      console.log('   Example: TEST_EMAIL=you@email.com TEST_PASSWORD=pass node test-ui.js\n');

      // Try to go to chat page directly (will redirect to login if not authenticated)
      await page.goto(`${BASE_URL}/dashboard/chat`);
      await page.waitForTimeout(3000);
      await takeScreenshot(page, '04-chat-or-login');
    }

    console.log('\n✅ UI Tests Complete!');
    console.log(`📁 Screenshots saved to: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await takeScreenshot(page, 'error-state');
  } finally {
    await browser.close();
  }
}

// Run tests
runTests().catch(console.error);
