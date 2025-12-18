# Platform Diagrams
## Mermaid Format (GitHub/Markdown Compatible)

---

## 1. High-Level Platform Architecture

```mermaid
flowchart TB
    subgraph Presentation["PRESENTATION LAYER"]
        WebApp["Web App"]
        Mobile["Mobile App"]
        Desktop["Desktop Client"]
        Integrations["Third-party Integrations"]
    end

    subgraph Experience["EXPERIENCE LAYER"]
        Research["Research Assistant"]
        DocWorkspace["Document Workspace"]
        Compliance["Compliance Dashboard"]
        Collab["Collaboration Hub"]
    end

    subgraph AI["AI AGENT LAYER"]
        ResearchAgent["Research Agent"]
        DocAgent["Document Agent"]
        ComplianceAgent["Compliance Agent"]
        WorkflowAgent["Workflow Agent"]
        TaxAgent["Tax Calc Agent"]
        RiskAgent["Risk Agent"]
    end

    subgraph Core["CORE SERVICES"]
        RAG["RAG Engine"]
        KnowledgeGraph["Knowledge Graph"]
        Workflow["Workflow Engine"]
        Analytics["Analytics Engine"]
        DocProcess["Document Processing"]
        Auth["Auth & Permissions"]
    end

    subgraph Data["DATA LAYER"]
        Postgres["PostgreSQL + pgvector"]
        VectorDB["Qdrant Vector DB"]
        Storage["Document Storage"]
        Cache["Redis Cache"]
    end

    subgraph External["EXTERNAL INTEGRATIONS"]
        LegalDB["Legal Databases"]
        TaxDB["Tax Databases"]
        GovAPI["Government APIs"]
        CloudStorage["Cloud Storage"]
    end

    Presentation --> Experience
    Experience --> AI
    AI --> Core
    Core --> Data
    Core --> External

    style Presentation fill:#F5F0E8,stroke:#DA7756
    style AI fill:#FAEEE9,stroke:#DA7756
    style Core fill:#E8F0E5,stroke:#88A47C
```

---

## 2. Tax Research Workflow

```mermaid
flowchart TD
    Start([Tax Question Intake])

    subgraph Processing["QUERY PROCESSING"]
        Expand["Query Expansion"]
        Intent["Intent Detection"]
        Entity["Entity Extraction"]
    end

    subgraph Search["MULTI-SOURCE SEARCH"]
        IRS["IRS Code Database"]
        State["State Tax DBs"]
        Internal["Internal Knowledge"]
    end

    subgraph Analysis["ANALYSIS ENGINE"]
        Aggregate["Result Aggregation"]
        Relevance["Relevance Ranking"]
        Apply["Fact Application"]
    end

    subgraph Output["MEMO GENERATION"]
        Draft["Draft Generation"]
        Citation["Citation Verification"]
        Risk["Risk Scoring"]
    end

    Review["Human Review"]
    Final([Finalize & Deliver])
    Knowledge["Knowledge Capture"]

    Start --> Processing
    Processing --> Search
    Search --> Analysis
    Analysis --> Output
    Output --> Review
    Review --> Final
    Final --> Knowledge

    style Processing fill:#FAEEE9,stroke:#DA7756
    style Search fill:#E8EEF3,stroke:#6B8CAE
    style Analysis fill:#FAEEE9,stroke:#DA7756
    style Output fill:#E8F0E5,stroke:#88A47C
```

---

## 3. Document Analysis Flow

```mermaid
flowchart LR
    subgraph Ingest["INGESTION"]
        Upload["Upload"]
        OCR["OCR Processing"]
        Format["Format Detection"]
    end

    subgraph Analyze["AI ANALYSIS"]
        Clause["Clause Extraction"]
        Entity["Entity Recognition"]
        Risk["Risk Analysis"]
    end

    subgraph Output["OUTPUTS"]
        Summary["Summary View"]
        Issues["Issue List"]
        Compare["Comparison"]
    end

    subgraph Collab["COLLABORATION"]
        Annotate["Annotations"]
        Review["Review Workflow"]
        Approve["Approval"]
    end

    Ingest --> Analyze
    Analyze --> Output
    Output --> Collab

    style Ingest fill:#E8EEF3,stroke:#6B8CAE
    style Analyze fill:#FAEEE9,stroke:#DA7756
    style Output fill:#F5F0E8,stroke:#9CA3AF
    style Collab fill:#E8F0E5,stroke:#88A47C
```

---

## 4. Compliance Monitoring Flow

```mermaid
flowchart TD
    subgraph Sources["REGULATORY SOURCES"]
        IRS["IRS Updates"]
        SEC["SEC Filings"]
        State["State Regulations"]
        FASB["FASB Updates"]
    end

    Detection["Change Detection Engine"]

    subgraph Impact["IMPACT ANALYSIS"]
        Analyze["Semantic Analysis"]
        Map["Entity Mapping"]
        Priority["Priority Scoring"]
    end

    subgraph Response["RESPONSE SYSTEM"]
        Alert["Alert Distribution"]
        Tasks["Task Generation"]
        Track["Compliance Tracker"]
    end

    subgraph Workflow["ACTION WORKFLOW"]
        Assign["Assignment"]
        Execute["Execution"]
        Document["Documentation"]
    end

    Audit["Audit Trail"]

    Sources --> Detection
    Detection --> Impact
    Impact --> Response
    Response --> Workflow
    Workflow --> Audit

    style Sources fill:#E8EEF3,stroke:#6B8CAE
    style Detection fill:#FAEEE9,stroke:#DA7756
    style Impact fill:#FDF3E3,stroke:#E5A853
    style Response fill:#E8F0E5,stroke:#88A47C
```

---

## 5. Client Collaboration Flow

```mermaid
flowchart TB
    subgraph Portal["CLIENT PORTAL"]
        DocReq["Document Request"]
        Upload["Secure Upload"]
        Status["Status View"]
    end

    subgraph Collection["SMART COLLECTION"]
        Generate["AI Request Generation"]
        Validate["Auto-Validation"]
        Remind["Auto-Reminders"]
    end

    subgraph Processing["PROCESSING"]
        Extract["Data Extraction"]
        Categorize["Categorization"]
        Queue["Review Queue"]
    end

    subgraph Signature["E-SIGNATURE"]
        Prepare["Doc Preparation"]
        Sign["Signature Flow"]
        Complete["Completion Tracking"]
    end

    Delivery["Secure Delivery"]

    Portal --> Collection
    Collection --> Processing
    Processing --> Signature
    Signature --> Delivery

    style Portal fill:#F5F0E8,stroke:#DA7756
    style Collection fill:#FAEEE9,stroke:#DA7756
    style Processing fill:#E8EEF3,stroke:#6B8CAE
    style Signature fill:#E8F0E5,stroke:#88A47C
```

---

## 6. Module Dependencies

```mermaid
flowchart TD
    Auth["Auth & Identity<br/>(Foundation)"]

    subgraph Core["CORE LAYER"]
        Doc["Document<br/>Management"]
        Work["Workspace<br/>Engine"]
        Analytics["Analytics<br/>Engine"]
    end

    subgraph Middle["MIDDLEWARE LAYER"]
        Knowledge["Knowledge<br/>Graph"]
        Workflow["Workflow<br/>Engine"]
        Notify["Notification<br/>Center"]
    end

    subgraph Intelligence["INTELLIGENCE LAYER"]
        Research["Research<br/>Assistant"]
        DocAnalyze["Document<br/>Analyzer"]
        Compliance["Compliance<br/>Monitor"]
    end

    subgraph Specialized["SPECIALIZED MODULES"]
        TaxMemo["Tax Memo<br/>Generator"]
        Contract["Contract<br/>Reviewer"]
        DD["Due<br/>Diligence"]
        Regulatory["Regulatory<br/>Tracker"]
    end

    Auth --> Core
    Core --> Middle
    Middle --> Intelligence
    Intelligence --> Specialized

    style Auth fill:#E8EEF3,stroke:#6B8CAE
    style Core fill:#F5F0E8,stroke:#9CA3AF
    style Intelligence fill:#FAEEE9,stroke:#DA7756
    style Specialized fill:#E8F0E5,stroke:#88A47C
```

---

## 7. User Journey: Tax Research to Memo

```mermaid
journey
    title Tax Research to Memo Delivery
    section Question Intake
      Open Research Assistant: 5: Tax Professional
      Enter Question: 4: Tax Professional
      Provide Facts: 4: Tax Professional
    section Research
      AI Searches Sources: 5: AI Agent
      Review Results: 4: Tax Professional
      Ask Follow-ups: 4: Tax Professional
    section Memo Creation
      Generate Draft: 5: AI Agent
      Review & Edit: 4: Tax Professional
      Check Risk Score: 5: Tax Professional
    section Review
      Submit for Approval: 4: Tax Professional
      Partner Reviews: 3: Partner
      Resolve Comments: 4: Tax Professional
    section Delivery
      Prepare Client Version: 5: AI Agent
      Send to Client: 5: Tax Professional
      Archive Knowledge: 5: System
```

---

## 8. State Machine: Document Review

```mermaid
stateDiagram-v2
    [*] --> Uploaded: Upload document
    Uploaded --> Processing: Auto-process
    Processing --> Analyzed: Analysis complete
    Analyzed --> InReview: Assign reviewer
    InReview --> NeedsChanges: Issues found
    InReview --> Approved: No issues
    NeedsChanges --> InReview: Changes made
    Approved --> Delivered: Send to client
    Delivered --> Archived: Complete
    Archived --> [*]

    note right of Processing
        AI performs:
        - OCR
        - Entity extraction
        - Risk analysis
    end note

    note right of InReview
        Human reviewer:
        - Validates AI findings
        - Adds annotations
        - Requests changes
    end note
```

---

## 9. Data Flow: RAG System

```mermaid
flowchart LR
    subgraph Input["INPUT"]
        Query["User Query"]
        Context["Context"]
    end

    subgraph Process["PROCESSING"]
        Expand["Query Expansion"]
        Embed["Embedding Generation"]
    end

    subgraph Search["HYBRID SEARCH"]
        Semantic["Semantic Search<br/>(Vector)"]
        Keyword["Keyword Search<br/>(BM25)"]
        Fusion["RRF Fusion"]
    end

    subgraph Retrieval["RETRIEVAL"]
        TopK["Top-K Selection"]
        Rerank["Re-ranking"]
        Filter["Context Filtering"]
    end

    subgraph Generation["GENERATION"]
        LLM["LLM Processing"]
        Citation["Citation Extraction"]
        Response["Response Assembly"]
    end

    Input --> Process
    Process --> Search
    Search --> Retrieval
    Retrieval --> Generation

    style Process fill:#FAEEE9,stroke:#DA7756
    style Search fill:#E8EEF3,stroke:#6B8CAE
    style Generation fill:#E8F0E5,stroke:#88A47C
```

---

## 10. Entity Relationship: Core Data Model

```mermaid
erDiagram
    Organization ||--o{ User : has
    Organization ||--o{ Client : manages
    Organization ||--o{ Matter : owns

    User ||--o{ Matter : assigned_to
    User ||--o{ Document : uploads
    User ||--o{ ResearchSession : creates

    Client ||--o{ Matter : has
    Client ||--o{ Document : provides

    Matter ||--o{ Document : contains
    Matter ||--o{ Task : has
    Matter ||--o{ ResearchSession : includes

    Document ||--o{ Chunk : has
    Document ||--o{ Annotation : has
    Document ||--o{ Analysis : has

    Chunk ||--o{ Embedding : has

    ResearchSession ||--o{ Query : contains
    ResearchSession ||--o{ Citation : references

    Memo ||--o{ Citation : uses
    Memo }|--|| Matter : belongs_to

    Organization {
        uuid id PK
        string name
        string plan
        jsonb settings
    }

    User {
        uuid id PK
        uuid org_id FK
        string email
        string role
        jsonb preferences
    }

    Client {
        uuid id PK
        uuid org_id FK
        string name
        string entity_type
        jsonb metadata
    }

    Matter {
        uuid id PK
        uuid client_id FK
        string type
        string status
        date deadline
    }

    Document {
        uuid id PK
        uuid matter_id FK
        string name
        string type
        string storage_path
        jsonb metadata
    }
```

---

## View in Draw.io

To view these diagrams in draw.io:

1. Go to [draw.io](https://app.diagrams.net/)
2. Create a new diagram
3. Use the "Arrange" > "Insert" > "Advanced" > "Mermaid" option
4. Paste the mermaid code blocks

Alternatively, use the draw.io XML file: [PLATFORM_DIAGRAMS.drawio](PLATFORM_DIAGRAMS.drawio)

---

## Automation Opportunity Annotations

### Legend

| Symbol | Meaning | Impact |
|--------|---------|--------|
| 🔥 | Critical automation opportunity | 80%+ time savings |
| ⚡ | High-value automation | 60-80% time savings |
| 🎯 | Targeted automation | 40-60% time savings |
| 💡 | Enhancement opportunity | 20-40% time savings |

### Key Automation Points

| Flow | Step | Opportunity | Impact |
|------|------|-------------|--------|
| Tax Research | Query Processing | 🔥 AI-powered query expansion | 80% faster |
| Tax Research | Multi-source Search | 🔥 Parallel automated search | 90% faster |
| Tax Research | Memo Generation | ⚡ AI draft generation | 70% faster |
| Document Review | Ingestion | 🔥 Auto-processing pipeline | 85% faster |
| Document Review | Analysis | 🔥 AI clause extraction | 75% faster |
| Compliance | Monitoring | 🔥 24/7 automated monitoring | 95% coverage |
| Compliance | Impact Analysis | ⚡ AI entity mapping | 80% faster |
| Client Portal | Document Collection | ⚡ Smart requests + reminders | 60% faster |
| Client Portal | Validation | 🎯 Auto-validation | 50% faster |
