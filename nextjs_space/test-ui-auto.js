/**
 * Autonomous UI Test Script using Playwright
 * Signs up a new test user and tests the chat interface
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Test configuration
const BASE_URL = 'http://localhost:3001';
const SCREENSHOTS_DIR = '/tmp/test-screenshots';
const TEST_EMAIL = `test-${Date.now()}@example.com`;
const TEST_PASSWORD = 'TestPassword123!';

// Create screenshots directory
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function takeScreenshot(page, name) {
  const screenshotPath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`📸 Screenshot saved: ${screenshotPath}`);
  return screenshotPath;
}

async function testSignup(page) {
  console.log('\n🧪 Testing Signup...');
  console.log(`   - Email: ${TEST_EMAIL}`);

  await page.goto(`${BASE_URL}/signup`);
  await page.waitForLoadState('networkidle');

  await takeScreenshot(page, '01-signup-page');

  // Fill signup form - including Name field
  const nameInput = await page.locator('input[placeholder="Name"]').or(page.locator('input').first());
  if (await nameInput.isVisible()) {
    await nameInput.fill('Test User');
  }
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);

  await takeScreenshot(page, '02-signup-filled');

  // Submit form
  await page.click('button[type="submit"]');

  console.log('   - Waiting for signup response...');
  await page.waitForTimeout(3000);

  await takeScreenshot(page, '03-after-signup');

  // Check if we were redirected or got an error
  const currentUrl = page.url();
  console.log(`   - Current URL: ${currentUrl}`);

  if (currentUrl.includes('dashboard')) {
    console.log('   ✅ Signup successful, redirected to dashboard');
    return true;
  }

  // Check for success message or error
  const pageContent = await page.content();
  if (pageContent.includes('Check your email') || pageContent.includes('verification')) {
    console.log('   ⚠️  Email verification required');
    return false;
  }

  return currentUrl.includes('dashboard');
}

async function testLogin(page, email, password) {
  console.log('\n🧪 Testing Login...');

  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Fill login form
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);

  await takeScreenshot(page, '04-login-filled');

  // Submit form
  await page.click('button[type="submit"]');

  console.log('   - Waiting for redirect...');

  try {
    await page.waitForURL('**/dashboard/**', { timeout: 15000 });
    console.log('   ✅ Login successful, redirected to dashboard');
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '05-dashboard');
    return true;
  } catch (e) {
    console.log('   ❌ Login failed or timeout');
    await takeScreenshot(page, '05-login-failed');
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

  await takeScreenshot(page, '06-chat-page');

  // Check for greeting
  const greeting = await page.locator('h1').textContent().catch(() => '');
  console.log(`   - Greeting: "${greeting}"`);

  // Check for textarea
  const textarea = await page.locator('textarea');
  if (await textarea.isVisible()) {
    console.log('   ✅ Chat input textarea is visible');
  }

  // Check for sidebar
  const sidebar = await page.locator('.w-64').first();
  if (await sidebar.isVisible()) {
    console.log('   ✅ Sidebar is visible');
  }

  return true;
}

async function testSendMessage(page, message) {
  console.log('\n🧪 Testing Message Sending...');
  console.log(`   - Message: "${message}"`);

  // Type message in textarea
  const textarea = await page.locator('textarea');
  await textarea.fill(message);

  await takeScreenshot(page, '07-message-typed');

  // Find and click send button (the arrow up button)
  const sendButton = await page.locator('button').filter({ has: page.locator('svg') }).last();
  await sendButton.click();

  console.log('   - Message sent, waiting for response...');

  await page.waitForTimeout(2000);
  await takeScreenshot(page, '08-message-sent');

  // Wait for streaming response
  let responseText = '';
  let lastLength = 0;
  let stableCount = 0;

  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);

    // Look for assistant response (the div without the user message styling)
    const assistantMessages = await page.locator('.whitespace-pre-wrap').all();

    if (assistantMessages.length > 0) {
      // Get the last message that's not the user's
      for (const msg of assistantMessages) {
        const text = await msg.textContent().catch(() => '');
        if (text && text !== message && !text.includes('How can I help')) {
          responseText = text;
        }
      }
    }

    if (responseText.length > 0) {
      if (responseText.length === lastLength) {
        stableCount++;
        if (stableCount >= 3) {
          console.log('   - Response complete (text stable)');
          break;
        }
      } else {
        stableCount = 0;
        console.log(`   - Streaming: ${responseText.length} chars...`);
      }
      lastLength = responseText.length;
    }

    // Check for error
    if (responseText.toLowerCase().includes('error')) {
      console.log('   ⚠️  Response contains error');
      break;
    }

    // Take periodic screenshots during streaming
    if (i === 5 || i === 15 || i === 30) {
      await takeScreenshot(page, `09-streaming-${i}s`);
    }
  }

  await takeScreenshot(page, '10-response-complete');

  console.log(`   - Final response length: ${responseText.length} chars`);
  if (responseText.length > 0) {
    console.log(`   - Response preview: "${responseText.substring(0, 300)}..."`);
  }

  return responseText;
}

async function runTests() {
  console.log('🚀 Starting Autonomous UI Tests\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Screenshots: ${SCREENSHOTS_DIR}`);
  console.log(`Test Email: ${TEST_EMAIL}\n`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
  });

  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 }
  });

  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log(`   [Browser Error] ${msg.text()}`);
    }
  });

  try {
    // First, try to login with existing test credentials
    // Using your email - you might need to provide password
    const existingEmail = 'acavinish@gmail.com';

    console.log('\n📋 Attempting to use existing user account...');
    console.log('   If login fails, the test will attempt signup.\n');

    // Go to login page
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '00-landing');

    // Check if we're already logged in
    if (page.url().includes('dashboard')) {
      console.log('   ✅ Already logged in!');
    } else {
      // Try signup with new test user
      const signupSuccess = await testSignup(page);

      if (!signupSuccess) {
        console.log('\n⚠️  Could not signup. Please provide credentials manually.');
        console.log('   Run: TEST_EMAIL=your@email.com TEST_PASSWORD=pass node test-ui.js');

        // Keep browser open for manual testing
        console.log('\n   Browser will stay open for 30 seconds for manual testing...');
        await page.waitForTimeout(30000);
        await browser.close();
        return;
      }
    }

    // Test chat functionality
    await testChatPage(page);

    // Send a test message
    const testQuestion = "What is the standard corporate tax rate in the UAE?";
    const response = await testSendMessage(page, testQuestion);

    // Analyze response
    console.log('\n📊 Response Analysis:');
    if (response) {
      if (response.includes('9%') || response.includes('nine percent')) {
        console.log('   ✅ Response contains expected tax rate');
      }
      if (response.includes('375,000') || response.includes('375000')) {
        console.log('   ✅ Response contains threshold info');
      }
      if (response.toLowerCase().includes('error')) {
        console.log('   ❌ Response contains error');
      }
      if (response.includes('upload') || response.includes('document')) {
        console.log('   ℹ️  Response mentions documents (expected if no docs uploaded)');
      }
    } else {
      console.log('   ❌ No response received');
    }

    console.log('\n✅ UI Tests Complete!');
    console.log(`📁 Screenshots saved to: ${SCREENSHOTS_DIR}`);

    // Keep browser open for a moment to see the result
    console.log('\n   Browser will close in 10 seconds...');
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    await takeScreenshot(page, 'error-state');
  } finally {
    await browser.close();
  }
}

runTests().catch(console.error);
