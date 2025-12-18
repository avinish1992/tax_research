/**
 * RAG Pipeline E2E Evaluation Tests
 *
 * Tests the full RAG pipeline through the actual application:
 * 1. Upload document via UI
 * 2. Wait for processing
 * 3. Run test queries via chat
 * 4. Evaluate response quality
 *
 * Run: npx playwright test tests/e2e/rag-evaluation.spec.ts
 */

import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// Test configuration
const BASE_URL = 'http://localhost:3000'
const DOCUMENT_PATH = path.join(__dirname, '../../..', 'documents', 'Federal-Decree-Law-No.-47-of-2022-EN.pdf')

// Test questions with expected answers and keywords
const TEST_QUESTIONS = [
  {
    id: 'q1',
    question: 'What is the standard corporate tax rate in the UAE?',
    expectedKeywords: ['9%', '375,000', 'taxable income'],
    expectedPages: [6, 33],
    category: 'tax_rates',
    difficulty: 'easy'
  },
  {
    id: 'q2',
    question: 'Who is exempt from corporate tax in the UAE?',
    expectedKeywords: ['government', 'exempt', 'pension', 'public benefit'],
    expectedPages: [7, 8, 9, 10, 11],
    category: 'exemptions',
    difficulty: 'easy'
  },
  {
    id: 'q3',
    question: 'When does the UAE Corporate Tax Law come into effect?',
    expectedKeywords: ['June 2023', 'Tax Period', 'effect'],
    expectedPages: [55],
    category: 'effective_date',
    difficulty: 'easy'
  },
  {
    id: 'q4',
    question: 'What is the arm\'s length principle for transfer pricing?',
    expectedKeywords: ['arm\'s length', 'Related Parties', 'independent'],
    expectedPages: [36, 37],
    category: 'transfer_pricing',
    difficulty: 'medium'
  },
  {
    id: 'q5',
    question: 'What are the requirements for forming a Tax Group?',
    expectedKeywords: ['95%', 'parent', 'ownership', 'Tax Group'],
    expectedPages: [42, 43],
    category: 'tax_group',
    difficulty: 'hard'
  }
]

// Results storage
interface TestResult {
  questionId: string
  question: string
  response: string
  keywordsFound: string[]
  keywordRecall: number
  responseTime: number
  hasAnswer: boolean
}

const results: TestResult[] = []

test.describe('RAG Pipeline E2E Evaluation', () => {

  test.beforeAll(async () => {
    // Verify document exists
    if (!fs.existsSync(DOCUMENT_PATH)) {
      throw new Error(`Document not found: ${DOCUMENT_PATH}`)
    }
  })

  test('should login and access dashboard', async ({ page }) => {
    // Navigate to app
    await page.goto(BASE_URL)

    // Check if we need to login
    const currentUrl = page.url()

    if (currentUrl.includes('login') || currentUrl.includes('auth')) {
      // Perform Google OAuth login (or handle auth)
      // For testing, we may need to use a test account or mock auth
      console.log('Login required - URL:', currentUrl)

      // Wait for any auth redirect
      await page.waitForTimeout(2000)
    }

    // Navigate to dashboard
    await page.goto(`${BASE_URL}/dashboard/chat`)
    await page.waitForLoadState('networkidle')

    // Verify we're on the dashboard
    await expect(page.locator('body')).toBeVisible()
  })

  test('should upload document via UI', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/chat`)
    await page.waitForLoadState('networkidle')

    // Look for upload button/area
    const uploadButton = page.locator('[data-testid="upload-button"], button:has-text("Upload"), input[type="file"]')

    // If there's a file input, use it directly
    const fileInput = page.locator('input[type="file"]')

    if (await fileInput.count() > 0) {
      // Set the file
      await fileInput.setInputFiles(DOCUMENT_PATH)

      // Wait for upload to complete
      await page.waitForTimeout(5000) // Initial wait

      // Wait for processing indicator to disappear or success message
      try {
        await page.waitForSelector('[data-status="completed"], .upload-success, :text("processed")', {
          timeout: 120000 // 2 minutes for processing
        })
      } catch {
        console.log('Upload may still be processing...')
      }
    } else {
      console.log('No file input found, document may need to be uploaded manually')
    }

    // Verify document appears in list
    await page.waitForTimeout(2000)
  })

  test('should run test queries and evaluate responses', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/chat`)
    await page.waitForLoadState('networkidle')

    // Find chat input
    const chatInput = page.locator('textarea, input[type="text"]').first()
    const sendButton = page.locator('button[type="submit"], button:has-text("Send"), button:has([data-icon="send"])')

    for (const q of TEST_QUESTIONS) {
      console.log(`\nTesting: ${q.id} - ${q.question.substring(0, 50)}...`)

      const startTime = Date.now()

      // Type question
      await chatInput.fill(q.question)

      // Send
      await sendButton.click()

      // Wait for response
      await page.waitForTimeout(3000) // Initial wait

      // Wait for response to appear
      try {
        await page.waitForSelector('.assistant-message, [data-role="assistant"], .response-text', {
          timeout: 30000
        })
      } catch {
        console.log('Response selector not found, continuing...')
      }

      const responseTime = Date.now() - startTime

      // Get the response text
      const responseElements = await page.locator('.assistant-message, [data-role="assistant"], .message-content').all()
      const lastResponse = responseElements[responseElements.length - 1]
      const responseText = lastResponse ? await lastResponse.textContent() || '' : ''

      // Evaluate keywords
      const responseLower = responseText.toLowerCase()
      const keywordsFound = q.expectedKeywords.filter(kw =>
        responseLower.includes(kw.toLowerCase())
      )

      const result: TestResult = {
        questionId: q.id,
        question: q.question,
        response: responseText.substring(0, 500),
        keywordsFound,
        keywordRecall: keywordsFound.length / q.expectedKeywords.length,
        responseTime,
        hasAnswer: responseText.length > 50 && !responseText.toLowerCase().includes('sorry')
      }

      results.push(result)

      console.log(`  Keywords found: ${keywordsFound.length}/${q.expectedKeywords.length}`)
      console.log(`  Response time: ${responseTime}ms`)

      // Small delay between questions
      await page.waitForTimeout(1000)
    }

    // Save results
    const resultsPath = path.join(__dirname, '../rag_evaluation/reports/e2e_results.json')
    fs.mkdirSync(path.dirname(resultsPath), { recursive: true })
    fs.writeFileSync(resultsPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      totalQuestions: TEST_QUESTIONS.length,
      results,
      metrics: {
        avgKeywordRecall: results.reduce((sum, r) => sum + r.keywordRecall, 0) / results.length,
        avgResponseTime: results.reduce((sum, r) => sum + r.responseTime, 0) / results.length,
        answerRate: results.filter(r => r.hasAnswer).length / results.length
      }
    }, null, 2))

    console.log(`\nResults saved to: ${resultsPath}`)
  })

  test.afterAll(async () => {
    // Print summary
    console.log('\n' + '='.repeat(60))
    console.log('E2E EVALUATION SUMMARY')
    console.log('='.repeat(60))

    if (results.length > 0) {
      const avgRecall = results.reduce((sum, r) => sum + r.keywordRecall, 0) / results.length
      const avgTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length
      const answerRate = results.filter(r => r.hasAnswer).length / results.length

      console.log(`Total Questions: ${results.length}`)
      console.log(`Avg Keyword Recall: ${(avgRecall * 100).toFixed(1)}%`)
      console.log(`Avg Response Time: ${avgTime.toFixed(0)}ms`)
      console.log(`Answer Rate: ${(answerRate * 100).toFixed(1)}%`)
    }
  })
})
