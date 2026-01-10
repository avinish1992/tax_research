/**
 * PageIndex Accuracy Testing Suite
 *
 * Tests document upload, tree indexing, and retrieval accuracy
 */

import { test, expect, Page } from '@playwright/test';

// Test configuration
const BASE_URL = 'http://localhost:5000';
const TEST_EMAIL = 'avinish@gmail.com';
const TEST_PASSWORD = 'admin123';

// Test documents
const FEDERAL_DECREE_LAW_PATH = '/home/avinish/Downloads/tax_research/documents/Federal-Decree-Law-No.-47-of-2022-EN.pdf';
const PARTICIPATION_EXEMPTION_PATH = '/home/avinish/Downloads/tax_research/documents/Participation Exemption.pdf';

// Test queries with expected content keywords
interface TestQuery {
  query: string;
  expectedKeywords: string[];
  expectedArticle?: string;
  multiPage?: boolean;
}

// Single document queries - Federal Decree Law
const FEDERAL_DECREE_QUERIES: TestQuery[] = [
  {
    query: "What does Article 50 say about anti-abuse rules?",
    expectedKeywords: ["anti-abuse", "arrangement", "transaction", "tax advantage"],
    expectedArticle: "Article 50",
  },
  {
    query: "What is the corporate tax rate in UAE?",
    expectedKeywords: ["9%", "nine percent", "0%", "zero"],
    expectedArticle: "Article 3",
  },
  {
    query: "What are the conditions for small business relief?",
    expectedKeywords: ["small business", "relief", "revenue", "threshold"],
    expectedArticle: "Article 21",
  },
  {
    query: "Explain transfer pricing requirements",
    expectedKeywords: ["transfer pricing", "arm's length", "related party", "connected persons"],
    expectedArticle: "Article 34",
    multiPage: true,
  },
  {
    query: "What is a Qualifying Free Zone Person?",
    expectedKeywords: ["free zone", "qualifying", "substance", "qualifying income"],
    expectedArticle: "Article 18",
  },
  {
    query: "How are dividends treated under exempt income?",
    expectedKeywords: ["dividend", "exempt", "participation", "juridical person"],
    expectedArticle: "Article 22",
  },
  {
    query: "What are the penalties for non-compliance?",
    expectedKeywords: ["penalty", "penalties", "violation", "administrative"],
    expectedArticle: "Article 58",
    multiPage: true,
  },
];

// Multi-page queries
const MULTI_PAGE_QUERIES: TestQuery[] = [
  {
    query: "How do tax groups work and what are the requirements?",
    expectedKeywords: ["tax group", "parent", "subsidiary", "ownership", "resident"],
    multiPage: true,
  },
  {
    query: "Explain the relationship between taxable income calculation and deductions",
    expectedKeywords: ["taxable income", "deduction", "accounting income", "adjustment"],
    multiPage: true,
  },
];

// Helper functions
async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/);
}

async function uploadDocument(page: Page, filePath: string) {
  await page.goto(`${BASE_URL}/dashboard/documents`);
  await page.waitForLoadState('networkidle');

  // Click upload button or trigger file input
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(filePath);

  // Wait for upload to complete (look for success indicator)
  await page.waitForSelector('[data-testid="document-item"], .document-card, table tbody tr', {
    timeout: 120000 // 2 minutes for indexing
  });

  // Additional wait for tree indexing
  await page.waitForTimeout(30000); // 30 seconds for background indexing
}

async function sendQuery(page: Page, query: string): Promise<{
  response: string;
  sources: string[];
  thinking?: string;
}> {
  await page.goto(`${BASE_URL}/dashboard/chat`);
  await page.waitForLoadState('networkidle');

  // Find chat input
  const chatInput = page.locator('textarea, input[type="text"]').last();
  await chatInput.fill(query);

  // Submit query
  await page.keyboard.press('Enter');

  // Wait for response (look for assistant message or loading to finish)
  await page.waitForSelector('[data-message-role="assistant"], .assistant-message', {
    timeout: 60000
  });

  // Wait for streaming to complete
  await page.waitForTimeout(5000);

  // Extract response text
  const responseElement = page.locator('[data-message-role="assistant"], .assistant-message').last();
  const response = await responseElement.textContent() || '';

  // Extract sources/citations
  const sourceElements = page.locator('[data-source], .citation, .source-item');
  const sources = await sourceElements.allTextContents();

  // Extract thinking if available
  const thinkingElement = page.locator('[data-thinking], .thinking-display');
  const thinking = await thinkingElement.textContent().catch(() => null) ?? undefined;

  return { response, sources, thinking };
}

function checkKeywords(response: string, expectedKeywords: string[]): {
  found: string[];
  missing: string[];
  accuracy: number;
} {
  const lowerResponse = response.toLowerCase();
  const found: string[] = [];
  const missing: string[] = [];

  for (const keyword of expectedKeywords) {
    if (lowerResponse.includes(keyword.toLowerCase())) {
      found.push(keyword);
    } else {
      missing.push(keyword);
    }
  }

  return {
    found,
    missing,
    accuracy: found.length / expectedKeywords.length,
  };
}

// Test Suite
test.describe('PageIndex Accuracy Tests', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await login(page);
    await page.close();
  });

  test.describe('Document Upload', () => {
    test('upload Federal Decree Law document', async ({ page }) => {
      await login(page);
      await uploadDocument(page, FEDERAL_DECREE_LAW_PATH);

      // Verify document appears in list
      const documentName = page.locator('text=Federal-Decree-Law');
      await expect(documentName).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Single Document Queries - Federal Decree Law', () => {
    test.beforeEach(async ({ page }) => {
      await login(page);
    });

    for (const testQuery of FEDERAL_DECREE_QUERIES) {
      test(`Query: ${testQuery.query.substring(0, 50)}...`, async ({ page }) => {
        const result = await sendQuery(page, testQuery.query);

        // Check for expected keywords
        const keywordCheck = checkKeywords(result.response, testQuery.expectedKeywords);

        console.log(`Query: ${testQuery.query}`);
        console.log(`Found keywords: ${keywordCheck.found.join(', ')}`);
        console.log(`Missing keywords: ${keywordCheck.missing.join(', ')}`);
        console.log(`Accuracy: ${(keywordCheck.accuracy * 100).toFixed(1)}%`);

        // Assert at least 50% of keywords found
        expect(keywordCheck.accuracy).toBeGreaterThanOrEqual(0.5);

        // Check for article reference if expected
        if (testQuery.expectedArticle) {
          const hasArticle = result.response.toLowerCase().includes(testQuery.expectedArticle.toLowerCase());
          console.log(`Expected article ${testQuery.expectedArticle}: ${hasArticle ? 'FOUND' : 'MISSING'}`);
        }

        // Check sources are present
        expect(result.sources.length).toBeGreaterThan(0);
      });
    }
  });

  test.describe('Multi-Page Queries', () => {
    test.beforeEach(async ({ page }) => {
      await login(page);
    });

    for (const testQuery of MULTI_PAGE_QUERIES) {
      test(`Multi-page: ${testQuery.query.substring(0, 50)}...`, async ({ page }) => {
        const result = await sendQuery(page, testQuery.query);

        const keywordCheck = checkKeywords(result.response, testQuery.expectedKeywords);

        console.log(`Query: ${testQuery.query}`);
        console.log(`Accuracy: ${(keywordCheck.accuracy * 100).toFixed(1)}%`);

        // Multi-page queries should still find most keywords
        expect(keywordCheck.accuracy).toBeGreaterThanOrEqual(0.4);
      });
    }
  });
});

// Accuracy Report Generator
test('Generate Accuracy Report', async ({ page }) => {
  await login(page);

  const results: Array<{
    query: string;
    accuracy: number;
    found: string[];
    missing: string[];
    hasCorrectArticle: boolean;
    sourceCount: number;
  }> = [];

  for (const testQuery of [...FEDERAL_DECREE_QUERIES, ...MULTI_PAGE_QUERIES]) {
    const result = await sendQuery(page, testQuery.query);
    const keywordCheck = checkKeywords(result.response, testQuery.expectedKeywords);

    const hasCorrectArticle = testQuery.expectedArticle
      ? result.response.toLowerCase().includes(testQuery.expectedArticle.toLowerCase())
      : true;

    results.push({
      query: testQuery.query,
      accuracy: keywordCheck.accuracy,
      found: keywordCheck.found,
      missing: keywordCheck.missing,
      hasCorrectArticle,
      sourceCount: result.sources.length,
    });

    // Small delay between queries
    await page.waitForTimeout(2000);
  }

  // Generate report
  console.log('\n========== ACCURACY REPORT ==========\n');

  let totalAccuracy = 0;
  let articleMatches = 0;
  let totalWithArticle = 0;

  for (const r of results) {
    totalAccuracy += r.accuracy;
    if (r.hasCorrectArticle !== undefined) {
      totalWithArticle++;
      if (r.hasCorrectArticle) articleMatches++;
    }

    console.log(`Query: ${r.query}`);
    console.log(`  Keyword Accuracy: ${(r.accuracy * 100).toFixed(1)}%`);
    console.log(`  Correct Article: ${r.hasCorrectArticle ? 'YES' : 'NO'}`);
    console.log(`  Sources: ${r.sourceCount}`);
    console.log(`  Missing: ${r.missing.join(', ') || 'None'}`);
    console.log('');
  }

  const avgAccuracy = totalAccuracy / results.length;
  const articleAccuracy = totalWithArticle > 0 ? articleMatches / totalWithArticle : 1;

  console.log('========== SUMMARY ==========');
  console.log(`Total Queries: ${results.length}`);
  console.log(`Average Keyword Accuracy: ${(avgAccuracy * 100).toFixed(1)}%`);
  console.log(`Article Match Rate: ${(articleAccuracy * 100).toFixed(1)}%`);
  console.log(`Overall Score: ${((avgAccuracy + articleAccuracy) / 2 * 100).toFixed(1)}%`);
  console.log('==============================\n');

  // Assert overall accuracy is above threshold
  expect(avgAccuracy).toBeGreaterThanOrEqual(0.6);
});
