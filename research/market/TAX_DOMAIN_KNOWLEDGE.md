# Tax Domain Knowledge for AI System Development

> Last Updated: December 2025

## Purpose

This document captures essential tax domain knowledge required to build an effective tax research AI system. Understanding the structure, hierarchy, and nuances of tax law is critical for accurate RAG retrieval and response generation.

---

## Tax Law Hierarchy & Structure

### Primary Authority (Binding)

The tax law hierarchy determines precedence when sources conflict:

```
                    ┌─────────────────────┐
                    │  U.S. Constitution  │
                    │    (Highest Law)    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Internal Revenue   │
                    │    Code (IRC)       │
                    │   (Title 26 USC)    │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼─────────┐ ┌────▼────┐ ┌─────────▼─────────┐
    │ Treasury          │ │ Court   │ │ IRS               │
    │ Regulations       │ │ Cases   │ │ Rulings           │
    └─────────┬─────────┘ └────┬────┘ └─────────┬─────────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Secondary Sources  │
                    │  (Non-Binding)      │
                    └─────────────────────┘
```

### 1. Internal Revenue Code (IRC)

**Structure:**
- **Title 26** of the United States Code
- Organized into **Subtitles A-K**
- Each subtitle contains **Chapters**
- Chapters contain **Subchapters**
- Subchapters contain **Parts**
- Parts contain **Sections** (the citation unit)

**Key Subtitles:**
| Subtitle | Coverage | Key Sections |
|----------|----------|--------------|
| A | Income Taxes | §1-1564 (most common research area) |
| B | Estate & Gift Taxes | §2001-2801 |
| C | Employment Taxes | §3101-3510 |
| D | Miscellaneous Excise Taxes | §4001-5000 |
| F | Procedure & Administration | §6001-7874 |

**Citation Format:**
```
IRC §162(a)(1)
│   │   │  │
│   │   │  └── Paragraph
│   │   └───── Subsection
│   └───────── Section number
└───────────── Internal Revenue Code
```

**Common Sections for Research:**
| Section | Topic | Research Frequency |
|---------|-------|-------------------|
| §61 | Gross Income Definition | Very High |
| §162 | Business Expenses | Very High |
| §163 | Interest Deduction | High |
| §167-168 | Depreciation | High |
| §170 | Charitable Contributions | High |
| §179 | Expensing Election | High |
| §199A | QBI Deduction | Very High |
| §351 | Corporate Formation | Medium |
| §721 | Partnership Formation | Medium |
| §1031 | Like-Kind Exchanges | High |
| §1221 | Capital Assets | High |

---

### 2. Treasury Regulations

**Types:**
| Type | Authority Level | Designation |
|------|-----------------|-------------|
| **Final Regulations** | Highest regulatory authority | Treas. Reg. § |
| **Temporary Regulations** | Same as final, 3-year limit | Treas. Reg. §(T) |
| **Proposed Regulations** | No binding authority | Prop. Reg. § |

**Citation Format:**
```
Treas. Reg. §1.162-5(a)(1)
│           │     │  │  │
│           │     │  │  └── Paragraph
│           │     │  └───── Subsection
│           │     └──────── Regulation number
│           └────────────── Related IRC section
└────────────────────────── Treasury Regulation
```

**RAG Implication:** When a query mentions IRC §162, the system should also retrieve Treas. Reg. §1.162-* for interpretive guidance.

---

### 3. IRS Guidance Documents

**By Authority Level:**

| Document Type | Abbreviation | Authority | Citable |
|---------------|--------------|-----------|---------|
| Revenue Rulings | Rev. Rul. | High (official IRS position) | Yes |
| Revenue Procedures | Rev. Proc. | High (procedural guidance) | Yes |
| Private Letter Rulings | PLR | Low (specific to taxpayer) | No* |
| Technical Advice Memoranda | TAM | Low | No* |
| Chief Counsel Advice | CCA | Low | No* |
| IRS Notices | Notice | Medium (temporary guidance) | Yes |
| IRS Announcements | Ann. | Medium | Yes |

*Can be used for insight but not relied upon as precedent.

**Citation Formats:**
```
Rev. Rul. 2023-14      → Revenue Ruling, year 2023, number 14
Rev. Proc. 2024-1      → Revenue Procedure, year 2024, number 1
PLR 202345001          → Private Letter Ruling, week 45 of 2023
Notice 2024-35         → IRS Notice, year 2024, number 35
```

---

### 4. Court Decisions

**Court Hierarchy (Federal Tax):**

```
           ┌────────────────────┐
           │   U.S. Supreme     │  ← Highest authority
           │      Court         │
           └─────────┬──────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
┌───▼───┐      ┌─────▼─────┐    ┌─────▼─────┐
│Circuit│      │ Court of  │    │   Court   │
│Courts │      │  Federal  │    │   of      │
│of     │      │  Claims   │    │  Appeals  │
│Appeals│      │           │    │   (DC)    │
└───┬───┘      └─────┬─────┘    └─────┬─────┘
    │                │                │
    └────────────────┼────────────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
┌───▼───┐      ┌─────▼─────┐    ┌─────▼─────┐
│U.S.   │      │  U.S.     │    │  U.S.     │
│Tax    │      │  District │    │  Court of │
│Court  │      │  Courts   │    │  Federal  │
│       │      │           │    │  Claims   │
└───────┘      └───────────┘    └───────────┘
```

**Key Courts for Tax:**
| Court | Characteristics | When Used |
|-------|-----------------|-----------|
| **U.S. Tax Court** | Prepayment forum, tax specialists | Most common |
| **U.S. District Court** | Jury trial available, refund required | When jury desired |
| **Court of Federal Claims** | Refund required | Large refund cases |

**Citation Format:**
```
Smith v. Commissioner, 155 T.C. 123 (2020)
│                      │    │    │
│                      │    │    └── Year decided
│                      │    └─────── Page number
│                      └──────────── Volume number
└─────────────────────────────────── Case name
```

---

### Secondary Sources (Non-Binding)

**For RAG System - Index These:**

| Source | Use Case | Integration Priority |
|--------|----------|---------------------|
| **IRS Publications** | Taxpayer-friendly explanations | High |
| **Tax Management Portfolios** | Deep analysis by topic | High (if licensed) |
| **Journal of Taxation** | Practitioner articles | Medium |
| **Tax Notes** | Current developments | Medium |
| **Tax Advisor** | AICPA publication | Medium |
| **CCH Explanations** | Plain-language summaries | High (if licensed) |

---

## Multi-Jurisdictional Complexity

### State Tax Variations

**Income Tax:**
| Category | States | Notes |
|----------|--------|-------|
| No Income Tax | TX, FL, WA, NV, WY, SD, AK, TN, NH* | *NH taxes interest/dividends only |
| Flat Tax | IL, NC, PA, MI, IN, CO, UT, KY | Single rate for all income |
| Progressive Tax | CA, NY, NJ, OR, HI, MN | Multiple brackets |

**Conformity to Federal:**
| Type | Description | States |
|------|-------------|--------|
| Rolling Conformity | Auto-adopt federal changes | ~20 states |
| Static Conformity | Conform to specific IRC date | ~15 states |
| Selective Conformity | Pick and choose provisions | ~15 states |

**RAG Implication:** Queries must be jurisdiction-aware. "What can I deduct?" has 51+ different answers.

### Key State Differences to Track

| Area | Federal | State Variations |
|------|---------|------------------|
| §179 Expensing | $1.16M (2024) | CA: $25,000 limit |
| Bonus Depreciation | 60% (2024) | Many states decouple |
| SALT Deduction | $10,000 cap | N/A at state level |
| QBI Deduction §199A | 20% of QBI | Most states don't conform |
| NOL Carryforward | Unlimited | Varies by state |

---

## Entity Type Considerations

### Entity Comparison Matrix

| Feature | Sole Prop | Partnership | S-Corp | C-Corp | LLC |
|---------|-----------|-------------|--------|--------|-----|
| **Formation** | None | Agreement | State + IRS | State + IRS | State |
| **Liability Protection** | None | Limited | Yes | Yes | Yes |
| **Tax Filing** | Schedule C | Form 1065 | Form 1120-S | Form 1120 | Varies |
| **Self-Employment Tax** | All income | All income | Wages only | N/A | Depends |
| **Double Taxation** | No | No | No | Yes | Depends |
| **Basis Tracking** | Simple | Complex | Complex | Simple | Complex |
| **Loss Limitations** | PAL, At-Risk | PAL, At-Risk, Basis | PAL, At-Risk, Basis | PAL | Depends |

### Common Entity Questions

These are high-frequency research queries:

1. **S-Corp Reasonable Compensation** - What salary must owner take?
2. **LLC Tax Classification** - Default vs. election options
3. **Partnership Allocations** - Substantial economic effect
4. **C-Corp Accumulated Earnings** - §531 penalty tax
5. **Entity Conversion** - Tax implications of changing structure

---

## Tax Calendar & Deadlines

### Key Federal Deadlines

| Form/Action | Deadline | Extension |
|-------------|----------|-----------|
| W-2, 1099-NEC | January 31 | None |
| 1065 (Partnership) | March 15 | September 15 |
| 1120-S (S-Corp) | March 15 | September 15 |
| 1040 (Individual) | April 15 | October 15 |
| 1120 (C-Corp) | April 15* | October 15 |
| Estimated Taxes | 4/15, 6/15, 9/15, 1/15 | None |

*Calendar year; fiscal year filers: 15th of 4th month after year-end.

### Common Extension/Amendment Scenarios

| Scenario | Deadline | Form |
|----------|----------|------|
| Amend Individual | 3 years from filing | 1040-X |
| Refund Claim | 3 years from filing or 2 years from payment | 1040-X |
| Audit Extension | IRS request | Form 872 |

---

## Research Query Patterns

### Common Query Types

Understanding these helps with RAG query expansion:

| Query Type | Example | Key Terms to Expand |
|------------|---------|---------------------|
| **Deductibility** | "Can I deduct X?" | ordinary, necessary, business purpose, §162 |
| **Income Inclusion** | "Is X taxable?" | gross income, §61, exclusion, deferral |
| **Timing** | "When do I recognize?" | cash method, accrual, constructive receipt |
| **Character** | "Is this ordinary or capital?" | §1221, §1231, holding period |
| **Basis** | "What's my basis in X?" | cost basis, adjusted basis, carryover |
| **Entity** | "Should I be an S-Corp?" | pass-through, self-employment, reasonable comp |

### Query Expansion Dictionary

| User Query Term | Expand To Include |
|-----------------|-------------------|
| "deduct" | deduction, deductible, ordinary, necessary, §162 |
| "depreciation" | §167, §168, MACRS, bonus, §179, recovery period |
| "home office" | §280A, regular and exclusive use, principal place |
| "meals" | §274, 50%, entertainment, business purpose |
| "vehicle" | §280F, luxury auto, standard mileage, actual expense |
| "retirement" | IRA, 401(k), pension, §401, §408, RMD |
| "gift" | §102, §2503, annual exclusion, basis carryover |
| "sale of home" | §121, primary residence, 2-of-5 year rule |

---

## IRS Forms Reference

### Most Common Forms

| Form | Purpose | Filing Frequency |
|------|---------|------------------|
| 1040 | Individual Income Tax | Annual |
| 1120 | C-Corporation Tax | Annual |
| 1120-S | S-Corporation Tax | Annual |
| 1065 | Partnership Return | Annual |
| 990 | Exempt Organization | Annual |
| 941 | Employer's Quarterly | Quarterly |
| 1099-NEC | Nonemployee Compensation | Annual |
| 1099-MISC | Miscellaneous Income | Annual |
| W-2 | Wage Statement | Annual |
| Schedule C | Sole Proprietor Income | Annual |
| Schedule E | Rental/Passive Income | Annual |
| Schedule K-1 | Partner/Shareholder Share | Annual |

### Form-to-IRC Mapping

For RAG retrieval, link forms to relevant code sections:

| Form/Schedule | Primary IRC Sections |
|---------------|---------------------|
| Schedule A | §§163, 164, 165, 170, 213 |
| Schedule C | §§61, 162, 167, 179, 280A |
| Schedule D | §§1001, 1211, 1212, 1221, 1222 |
| Schedule E | §§469, 704, 705, 1366, 1367 |
| Form 4562 | §§167, 168, 179 |
| Form 4797 | §§1231, 1245, 1250 |

---

## Tax Terminology Glossary

### Must-Know Terms for AI System

| Term | Definition | Related Sections |
|------|------------|------------------|
| **Adjusted Gross Income (AGI)** | Gross income minus above-the-line deductions | §62 |
| **Basis** | Investment in property for gain/loss calculation | §1011-1016 |
| **Capital Gain/Loss** | Gain/loss from sale of capital asset | §1221, §1222 |
| **Passive Activity** | Trade/business in which taxpayer doesn't materially participate | §469 |
| **At-Risk Rules** | Limit deductions to amount at risk | §465 |
| **Net Operating Loss (NOL)** | Excess of deductions over income | §172 |
| **Qualified Business Income (QBI)** | Income from pass-through eligible for 20% deduction | §199A |
| **Alternative Minimum Tax (AMT)** | Parallel tax system with fewer deductions | §55-59 |
| **Constructive Receipt** | Income available though not physically received | Treas. Reg. §1.451-2 |
| **Economic Substance** | Transaction must have meaningful purpose beyond tax | §7701(o) |

---

## RAG System Implications

### Indexing Recommendations

1. **Chunk by Section:** IRC sections are natural boundaries
2. **Preserve Hierarchy:** Maintain subsection/paragraph structure
3. **Link Regulations:** Connect IRC sections to related regulations
4. **Date Awareness:** Track effective dates for provisions
5. **Jurisdiction Tags:** Mark content by federal/state applicability

### Query Enhancement

1. **Synonym Expansion:** "deduct" → "deduction, deductible, allowable"
2. **Section Inference:** "home office" → §280A
3. **Entity Context:** Maintain entity type throughout conversation
4. **Year Sensitivity:** Tax law changes frequently; track tax year

### Response Requirements

1. **Always Cite:** Every claim needs IRC/Reg/Ruling citation
2. **State Caveats:** "Under current law..." "For tax year 2024..."
3. **Jurisdiction Clarity:** Specify federal vs. state applicability
4. **Professional Disclaimer:** Not a substitute for professional advice

---

## Sources & Further Reading

- [Cornell Law - U.S. Code Title 26](https://www.law.cornell.edu/uscode/text/26)
- [IRS - Tax Code, Regulations and Official Guidance](https://www.irs.gov/tax-professionals/tax-code-regulations-and-official-guidance)
- [UF Tax Research Tutorial](https://businesslibrary.uflib.ufl.edu/taxresearch)
- [TaxGPT - Ultimate Guide to Tax Research](https://www.taxgpt.com/blog/tax-research)
