# Architecture Diagrams (Mermaid)

**Version:** 1.0
**Date:** 2025-12-18

Copy these diagrams into any Mermaid renderer (GitHub, Notion, Mermaid Live Editor, etc.)

---

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph Users["👤 Users"]
        Browser[Browser]
        Mobile[Mobile App]
        Slack[Slack/Teams]
    end

    subgraph NextJS["⚛️ Next.js Application"]
        UI[React UI]
        API[API Routes]
        RAG[RAG Engine]
        Auth_MW[Auth Middleware]
    end

    subgraph N8N["🔄 n8n Workflows"]
        Ingest[Document Ingestion]
        Schedule[Scheduled Jobs]
        Agent[AI Agent Tools]
        Notify[Notifications]
    end

    subgraph Supabase["🟢 Supabase Platform"]
        SB_Auth[Auth/GoTrue]
        SB_DB[(PostgreSQL + pgvector)]
        SB_Storage[Storage/S3]
        SB_RT[Realtime]
    end

    subgraph External["🌐 External APIs"]
        Claude[Claude API]
        OpenAI[OpenAI Embeddings]
    end

    %% User connections
    Browser --> UI
    Mobile --> API
    Slack --> N8N

    %% Next.js internal
    UI --> API
    API --> Auth_MW
    Auth_MW --> SB_Auth
    API --> RAG
    RAG --> SB_DB
    RAG --> Claude
    RAG --> OpenAI

    %% n8n connections
    API -->|Webhook| Ingest
    Ingest --> SB_Storage
    Ingest --> SB_DB
    Ingest --> OpenAI
    Schedule --> SB_DB
    Agent --> Claude
    Notify --> Slack

    %% Realtime
    SB_DB --> SB_RT
    SB_RT -->|WebSocket| UI

    %% Styling
    classDef user fill:#e1f5fe,stroke:#01579b
    classDef nextjs fill:#f3e5f5,stroke:#4a148c
    classDef n8n fill:#fff3e0,stroke:#e65100
    classDef supabase fill:#e8f5e9,stroke:#1b5e20
    classDef external fill:#fce4ec,stroke:#880e4f

    class Browser,Mobile,Slack user
    class UI,API,RAG,Auth_MW nextjs
    class Ingest,Schedule,Agent,Notify n8n
    class SB_Auth,SB_DB,SB_Storage,SB_RT supabase
    class Claude,OpenAI external
```

---

## 2. Document Upload & Processing Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as 👤 User
    participant N as ⚛️ Next.js
    participant S as 🟢 Supabase Storage
    participant D as 🟢 Supabase DB
    participant W as 🔄 n8n Workflow
    participant E as 🌐 OpenAI

    U->>N: Upload Document (PDF)
    activate N
    N->>S: Store File
    S-->>N: Storage Path
    N->>D: INSERT document (status: pending)
    D-->>N: Document ID
    N->>W: POST /webhook/ingest
    Note over N,W: Fire & Forget (async)
    N-->>U: 202 Accepted
    deactivate N

    activate W
    Note over W: Background Processing
    W->>D: UPDATE status = 'processing'
    W->>S: Download File
    S-->>W: File Binary
    W->>W: Parse PDF → Text
    W->>W: Chunk Text (1000 chars)

    loop For each chunk
        W->>E: Generate Embedding
        E-->>W: Vector [1536]
    end

    W->>D: BATCH INSERT chunks + vectors
    W->>D: UPDATE status = 'completed'
    deactivate W

    D-->>U: 🔔 Realtime: Document Ready!
```

---

## 3. RAG Query Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as 👤 User
    participant N as ⚛️ Next.js /api/chat
    participant D as 🟢 Supabase DB
    participant E as 🌐 OpenAI
    participant C as 🌐 Claude API

    U->>N: "What does clause 5.2 say?"
    activate N

    N->>N: Auth Check (JWT)
    N->>N: Query Expansion

    N->>E: Generate Embedding
    E-->>N: Vector [1536]

    N->>D: hybrid_search_documents()
    activate D
    Note over D: 1. HNSW Vector Search<br/>2. Trigram Text Search<br/>3. RRF Fusion
    D-->>N: Top 10 Chunks
    deactivate D

    N->>N: Build Context Prompt

    N->>C: Stream Request
    activate C

    loop Streaming Response
        C-->>N: Token
        N-->>U: SSE Token
    end
    deactivate C

    N->>D: Save Message
    N-->>U: [DONE]
    deactivate N
```

---

## 4. Authentication Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as 👤 User
    participant B as 🌐 Browser
    participant N as ⚛️ Next.js
    participant A as 🟢 Supabase Auth
    participant D as 🟢 Supabase DB

    U->>B: Click "Sign In with Google"
    B->>A: OAuth Request
    A->>A: Redirect to Google
    Note over A: Google OAuth Flow
    A-->>B: JWT + Refresh Token
    B->>B: Store in Cookie

    U->>B: Make API Request
    B->>N: Request + Cookie
    N->>A: Verify JWT
    A-->>N: User Context (auth.uid())

    N->>D: Query with RLS
    Note over D: WHERE user_id = auth.uid()<br/>Applied automatically
    D-->>N: Filtered Data
    N-->>B: Response
    B-->>U: Display Data
```

---

## 5. Database Schema (ER Diagram)

```mermaid
erDiagram
    AUTH_USERS ||--o{ PROFILES : has
    AUTH_USERS ||--o{ DOCUMENTS : owns
    AUTH_USERS ||--o{ CHAT_SESSIONS : owns
    DOCUMENTS ||--o{ DOCUMENT_CHUNKS : contains
    CHAT_SESSIONS ||--o{ MESSAGES : contains

    AUTH_USERS {
        uuid id PK
        string email
        timestamp created_at
    }

    PROFILES {
        uuid id PK,FK
        string email
        string full_name
        string avatar_url
        timestamp created_at
        timestamp updated_at
    }

    DOCUMENTS {
        uuid id PK
        uuid user_id FK
        string file_name
        string original_name
        int file_size
        string storage_path
        string status
        timestamp uploaded_at
        timestamp processed_at
    }

    DOCUMENT_CHUNKS {
        uuid id PK
        uuid document_id FK
        text content
        vector embedding
        int page_number
        int chunk_index
        jsonb metadata
        timestamp created_at
    }

    CHAT_SESSIONS {
        uuid id PK
        uuid user_id FK
        string title
        string model
        timestamp created_at
        timestamp updated_at
    }

    MESSAGES {
        uuid id PK
        uuid chat_session_id FK
        string role
        text content
        jsonb metadata
        timestamp created_at
    }
```

---

## 6. n8n Workflow Architecture

```mermaid
graph LR
    subgraph Triggers["🎯 Triggers"]
        WH[Webhook]
        CR[Cron Schedule]
        SB[Supabase Trigger]
    end

    subgraph Workflows["🔄 Workflows"]
        subgraph DocIngest["Document Ingestion"]
            V1[Validate]
            DL[Download]
            PR[Parse]
            CH[Chunk]
            EM[Embed]
            ST[Store]
        end

        subgraph Maintenance["Maintenance Jobs"]
            CL[Cleanup]
            RE[Re-embed]
            AN[Analytics]
        end

        subgraph AI["AI Agent Tools"]
            AZ[Analyze]
            CM[Compare]
            CO[Compliance]
        end
    end

    subgraph Destinations["📤 Destinations"]
        DB[(Supabase DB)]
        FS[Supabase Storage]
        EM_OUT[Email]
        SL[Slack]
    end

    WH --> V1
    V1 --> DL
    DL --> PR
    PR --> CH
    CH --> EM
    EM --> ST
    ST --> DB

    CR --> CL
    CR --> RE
    CR --> AN
    CL --> DB
    RE --> DB
    AN --> DB

    SB --> AZ
    AZ --> DB
    CM --> DB
    CO --> EM_OUT
    CO --> SL
```

---

## 7. Component Interaction Overview

```mermaid
graph TB
    subgraph Client["Client Layer"]
        Browser["🌐 Browser (React)"]
    end

    subgraph App["Application Layer"]
        NextJS["⚛️ Next.js"]
    end

    subgraph Orchestration["Orchestration Layer"]
        N8N["🔄 n8n"]
    end

    subgraph Data["Data Layer"]
        Supabase["🟢 Supabase"]
    end

    subgraph External["External Services"]
        LLM["🤖 LLM APIs"]
    end

    Browser <-->|"HTTP/WebSocket"| NextJS
    NextJS <-->|"REST/RLS"| Supabase
    NextJS -->|"Webhook"| N8N
    NextJS <-->|"Streaming"| LLM
    N8N <-->|"REST/SQL"| Supabase
    N8N <-->|"API"| LLM
    Supabase -->|"Realtime"| Browser

    style Client fill:#e3f2fd
    style App fill:#f3e5f5
    style Orchestration fill:#fff3e0
    style Data fill:#e8f5e9
    style External fill:#fce4ec
```

---

## 8. Hybrid Search Flow

```mermaid
graph TB
    Q[User Query] --> QE[Query Expansion]
    QE --> EMB[Generate Embedding]

    subgraph Search["Parallel Search"]
        direction LR
        EMB --> VS[Vector Search<br/>HNSW Index]
        QE --> KS[Keyword Search<br/>pg_trgm]
    end

    VS --> VR[Vector Results<br/>Top 20]
    KS --> KR[Keyword Results<br/>Top 20]

    VR --> RRF[RRF Fusion<br/>k=60]
    KR --> RRF

    RRF --> TOP[Top 10 Chunks]
    TOP --> CTX[Build Context]
    CTX --> LLM[LLM Response]
```

---

## 9. Deployment Architecture

```mermaid
graph TB
    subgraph Internet["🌐 Internet"]
        Users[Users]
    end

    subgraph Vercel["☁️ Vercel"]
        NextJS[Next.js App<br/>Edge + Serverless]
    end

    subgraph N8N_Host["☁️ n8n Host"]
        N8N[n8n Server<br/>Self-hosted or Cloud]
    end

    subgraph Supabase_Cloud["☁️ Supabase Cloud"]
        SB_Edge[Edge Functions]
        SB_Auth[Auth Service]
        SB_API[PostgREST API]
        SB_RT[Realtime Service]
        SB_DB[(PostgreSQL)]
        SB_Storage[Object Storage]
    end

    subgraph APIs["🌐 External APIs"]
        Anthropic[Anthropic API]
        OpenAI[OpenAI API]
    end

    Users --> NextJS
    NextJS --> SB_Auth
    NextJS --> SB_API
    NextJS --> Anthropic
    NextJS --> OpenAI
    NextJS -.->|Webhook| N8N

    N8N --> SB_API
    N8N --> SB_Storage
    N8N --> OpenAI

    SB_API --> SB_DB
    SB_RT --> SB_DB
    SB_Auth --> SB_DB
```

---

## 10. Data Flow Summary

```mermaid
flowchart LR
    subgraph Input["📥 Input"]
        DOC[Document Upload]
        MSG[Chat Message]
    end

    subgraph Process["⚙️ Process"]
        N8N_P[n8n: Parse & Embed]
        NJS_P[Next.js: Query & Stream]
    end

    subgraph Store["💾 Store"]
        VEC[(Vectors)]
        TXT[(Text/Metadata)]
        FILES[(Files)]
    end

    subgraph Output["📤 Output"]
        RESP[AI Response]
        NOTIFY[Notifications]
    end

    DOC --> N8N_P
    N8N_P --> VEC
    N8N_P --> TXT
    N8N_P --> FILES
    N8N_P --> NOTIFY

    MSG --> NJS_P
    VEC --> NJS_P
    TXT --> NJS_P
    NJS_P --> RESP
```

---

## How to Use These Diagrams

### GitHub
GitHub renders Mermaid diagrams automatically in markdown files.

### Notion
Notion supports Mermaid in code blocks with language set to `mermaid`.

### Mermaid Live Editor
Visit https://mermaid.live and paste any diagram code.

### VS Code
Install the "Mermaid Preview" extension to view diagrams inline.

### Export Options
- PNG/SVG: Use Mermaid Live Editor export
- PDF: Render in browser, print to PDF
