# Memory Systems for AI Agents Research

## Overview

This document covers memory architectures for building intelligent AI agents that maintain context, learn from interactions, and provide personalized responses.

---

## Memory Types in Agentic AI

### 1. Short-Term Memory (Working Memory)

**Purpose:** Immediate context within a conversation session

**Characteristics:**
- Handles recent inputs for immediate decision-making
- Maintains context across multiple exchanges
- Enables coherent multi-turn conversations
- Transient - cleared after session ends

**Implementation:**
```python
class ShortTermMemory:
    def __init__(self, max_tokens=4000):
        self.messages = []
        self.max_tokens = max_tokens

    def add(self, role: str, content: str):
        self.messages.append({"role": role, "content": content})
        self._trim_to_limit()

    def _trim_to_limit(self):
        # Keep most recent messages within token limit
        while self._count_tokens() > self.max_tokens:
            self.messages.pop(0)

    def get_context(self) -> list:
        return self.messages
```

**Use Cases:**
- Multi-turn chat conversations
- Following up on previous questions
- Maintaining dialogue coherence

---

### 2. Episodic Memory

**Purpose:** Recall specific past experiences and interactions

**Characteristics:**
- Stores individual events with temporal context
- Enables case-based reasoning
- Learns from past outcomes
- Time-indexed for historical queries

**Implementation:**
```python
from datetime import datetime
from typing import List, Dict
import json

class EpisodicMemory:
    def __init__(self, vector_store):
        self.vector_store = vector_store
        self.episodes = []

    def store_episode(self, event: Dict):
        episode = {
            "id": generate_id(),
            "timestamp": datetime.now().isoformat(),
            "event_type": event.get("type"),
            "content": event.get("content"),
            "context": event.get("context"),
            "outcome": event.get("outcome"),
            "user_feedback": event.get("feedback"),
            "embedding": self._embed(event.get("content"))
        }
        self.episodes.append(episode)
        self.vector_store.upsert(episode)

    def recall_similar(self, query: str, k: int = 5) -> List[Dict]:
        """Recall similar past episodes"""
        query_embedding = self._embed(query)
        return self.vector_store.search(query_embedding, top_k=k)

    def recall_by_time(self, start: datetime, end: datetime) -> List[Dict]:
        """Recall episodes within time range"""
        return [e for e in self.episodes
                if start <= datetime.fromisoformat(e["timestamp"]) <= end]
```

**Use Cases:**
- "What did we discuss about contract X last week?"
- Learning from successful/failed interactions
- Personalizing based on user history

---

### 3. Semantic Memory

**Purpose:** Store structured factual knowledge

**Characteristics:**
- Generalized information (facts, definitions, rules)
- Independent of specific events
- Grounds responses in verifiable information
- Integrates external knowledge sources

**Implementation:**
```python
from typing import Dict, List, Optional

class SemanticMemory:
    def __init__(self, knowledge_base, vector_store):
        self.kb = knowledge_base  # Facts, definitions, rules
        self.vector_store = vector_store

    def store_fact(self, fact: Dict):
        """Store a factual piece of knowledge"""
        entry = {
            "id": generate_id(),
            "category": fact.get("category"),  # e.g., "legal_term"
            "content": fact.get("content"),
            "source": fact.get("source"),
            "confidence": fact.get("confidence", 1.0),
            "embedding": self._embed(fact.get("content"))
        }
        self.kb.insert(entry)
        self.vector_store.upsert(entry)

    def query_knowledge(self, query: str, category: Optional[str] = None) -> List[Dict]:
        """Query semantic knowledge base"""
        results = self.vector_store.search(
            self._embed(query),
            filter={"category": category} if category else None,
            top_k=10
        )
        return results

    def update_fact(self, fact_id: str, updates: Dict):
        """Update existing knowledge"""
        self.kb.update(fact_id, updates)
        self.vector_store.update(fact_id, updates)
```

**Use Cases:**
- Legal term definitions
- Regulatory requirements
- Document templates
- Company policies

---

### 4. Temporal Memory

**Purpose:** Track changes and events over time

**Characteristics:**
- Time-indexed information
- Tracks evolution of facts
- Enables trend analysis
- Supports time-based queries

**Implementation:**
```python
from datetime import datetime
from typing import List, Dict

class TemporalMemory:
    def __init__(self, db):
        self.db = db

    def store_event(self, event: Dict):
        """Store time-indexed event"""
        record = {
            "id": generate_id(),
            "timestamp": datetime.now(),
            "event_type": event.get("type"),
            "entity_id": event.get("entity_id"),  # What changed
            "before_state": event.get("before"),
            "after_state": event.get("after"),
            "metadata": event.get("metadata")
        }
        self.db.insert("temporal_events", record)

    def query_timeline(self, entity_id: str,
                       start: datetime = None,
                       end: datetime = None) -> List[Dict]:
        """Get timeline of changes for an entity"""
        query = {"entity_id": entity_id}
        if start:
            query["timestamp__gte"] = start
        if end:
            query["timestamp__lte"] = end
        return self.db.query("temporal_events", query)

    def get_state_at(self, entity_id: str, point_in_time: datetime) -> Dict:
        """Get entity state at specific point in time"""
        events = self.query_timeline(entity_id, end=point_in_time)
        return events[-1]["after_state"] if events else None
```

**Use Cases:**
- Contract revision history
- Regulation changes over time
- User preference evolution
- Deadline tracking

---

### 5. Procedural Memory

**Purpose:** Store learned procedures and skills

**Characteristics:**
- How-to knowledge
- Automated routines
- Skill acquisition
- Tool usage patterns

**Implementation:**
```python
from typing import Callable, Dict, List

class ProceduralMemory:
    def __init__(self):
        self.procedures = {}
        self.usage_stats = {}

    def register_procedure(self, name: str,
                          steps: List[Dict],
                          triggers: List[str]):
        """Register a learned procedure"""
        self.procedures[name] = {
            "steps": steps,
            "triggers": triggers,
            "success_count": 0,
            "fail_count": 0
        }

    def match_procedure(self, context: str) -> Optional[str]:
        """Find matching procedure for context"""
        for name, proc in self.procedures.items():
            for trigger in proc["triggers"]:
                if trigger.lower() in context.lower():
                    return name
        return None

    def execute_procedure(self, name: str, context: Dict) -> Dict:
        """Execute a stored procedure"""
        proc = self.procedures.get(name)
        if not proc:
            return {"error": "Procedure not found"}

        results = []
        for step in proc["steps"]:
            result = self._execute_step(step, context)
            results.append(result)
            if result.get("error"):
                proc["fail_count"] += 1
                return {"error": result["error"], "partial_results": results}

        proc["success_count"] += 1
        return {"success": True, "results": results}

    def learn_from_feedback(self, name: str, feedback: Dict):
        """Update procedure based on feedback"""
        # Reinforce or modify procedure based on outcome
        pass
```

**Use Cases:**
- Document analysis workflows
- Standard legal research procedures
- Compliance checking routines

---

## Advanced Memory Frameworks

### MIRIX Multi-Agent Memory System

**Architecture:**
```
┌─────────────────────────────────────────────────────────┐
│                    MIRIX Framework                       │
│                                                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐            │
│  │   Core    │ │ Episodic  │ │ Semantic  │            │
│  │  Memory   │ │  Memory   │ │  Memory   │            │
│  └───────────┘ └───────────┘ └───────────┘            │
│                                                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐            │
│  │Procedural │ │ Resource  │ │ Knowledge │            │
│  │  Memory   │ │  Memory   │ │   Vault   │            │
│  └───────────┘ └───────────┘ └───────────┘            │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │         Multi-Agent Coordination Layer           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Performance:**
- 35% higher accuracy than RAG baseline on ScreenshotVQA
- 99.9% storage reduction
- 85.4% accuracy on LOCOMO (long-form conversation)

### Memoria Framework

**Core Modules:**
1. Structured conversation logging
2. Dynamic user modeling
3. Real-time session summarization
4. Context-aware retrieval

---

## Implementation Strategy for Legal AI

### Phase 1: Basic Memory (Immediate)

```python
class LegalAIMemory:
    def __init__(self, supabase_client, vector_store):
        self.supabase = supabase_client
        self.vectors = vector_store

        # Initialize memory types
        self.short_term = ShortTermMemory(max_tokens=8000)
        self.semantic = SemanticMemory(self.supabase, self.vectors)

    def process_turn(self, user_id: str, query: str, response: str):
        # Update short-term
        self.short_term.add("user", query)
        self.short_term.add("assistant", response)

        # Store to long-term (async)
        self._store_interaction(user_id, query, response)

    def get_context(self, user_id: str, query: str) -> Dict:
        return {
            "conversation": self.short_term.get_context(),
            "relevant_knowledge": self.semantic.query_knowledge(query),
        }
```

### Phase 2: Enhanced Memory (Short-term)

```python
class EnhancedLegalAIMemory(LegalAIMemory):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.episodic = EpisodicMemory(self.vectors)
        self.temporal = TemporalMemory(self.supabase)

    def get_context(self, user_id: str, query: str) -> Dict:
        base_context = super().get_context(user_id, query)

        return {
            **base_context,
            "past_similar": self.episodic.recall_similar(query, k=3),
            "user_history": self.temporal.query_timeline(user_id),
        }
```

### Phase 3: Full Memory System (Long-term)

```python
class FullLegalAIMemory:
    def __init__(self, config: Dict):
        # All memory types
        self.short_term = ShortTermMemory(config["stm_tokens"])
        self.episodic = EpisodicMemory(config["vector_store"])
        self.semantic = SemanticMemory(config["kb"], config["vector_store"])
        self.temporal = TemporalMemory(config["db"])
        self.procedural = ProceduralMemory()

        # Memory coordination
        self.coordinator = MemoryCoordinator(self)

    def process_interaction(self, context: Dict) -> Dict:
        """Full memory processing pipeline"""
        user_id = context["user_id"]
        query = context["query"]

        # 1. Update short-term
        self.short_term.add("user", query)

        # 2. Retrieve relevant memories
        memories = self.coordinator.retrieve_all(query, user_id)

        # 3. Generate response with memories
        response = self._generate_response(query, memories)

        # 4. Update all memory systems
        self.short_term.add("assistant", response)
        self.episodic.store_episode({
            "type": "qa_interaction",
            "content": f"Q: {query}\nA: {response}",
            "context": context,
            "user_id": user_id
        })

        # 5. Learn any procedures from interaction
        self._extract_procedures(query, response)

        return {"response": response, "memories_used": memories}
```

---

## Database Schema for Memory

### Supabase Tables

```sql
-- Short-term memory (session-based)
CREATE TABLE conversation_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    summary TEXT,
    metadata JSONB
);

CREATE TABLE session_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES conversation_sessions,
    role TEXT NOT NULL,  -- 'user' or 'assistant'
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Episodic memory
CREATE TABLE episodic_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users,
    event_type TEXT NOT NULL,
    content TEXT NOT NULL,
    context JSONB,
    outcome JSONB,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Semantic memory (knowledge base)
CREATE TABLE semantic_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT,
    confidence FLOAT DEFAULT 1.0,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Temporal memory
CREATE TABLE temporal_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    before_state JSONB,
    after_state JSONB,
    metadata JSONB,
    occurred_at TIMESTAMPTZ DEFAULT NOW()
);

-- User preferences (learned over time)
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users UNIQUE,
    communication_style JSONB,
    topics_of_interest TEXT[],
    response_preferences JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient retrieval
CREATE INDEX idx_episodic_user ON episodic_memories(user_id);
CREATE INDEX idx_episodic_embedding ON episodic_memories
    USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_semantic_category ON semantic_knowledge(category);
CREATE INDEX idx_semantic_embedding ON semantic_knowledge
    USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_temporal_entity ON temporal_events(entity_type, entity_id);
```

---

## Memory Retrieval Strategies

### 1. Recency-Weighted Retrieval
```python
def retrieve_with_recency(query_embedding, memories, recency_weight=0.3):
    now = datetime.now()
    scored = []

    for memory in memories:
        # Semantic similarity
        semantic_score = cosine_similarity(query_embedding, memory["embedding"])

        # Recency score (exponential decay)
        age_hours = (now - memory["created_at"]).total_seconds() / 3600
        recency_score = math.exp(-age_hours / 168)  # 1 week half-life

        # Combined score
        final_score = (1 - recency_weight) * semantic_score + recency_weight * recency_score
        scored.append((memory, final_score))

    return sorted(scored, key=lambda x: x[1], reverse=True)
```

### 2. User-Personalized Retrieval
```python
def retrieve_personalized(user_id, query, memories):
    # Get user preferences
    prefs = get_user_preferences(user_id)

    # Boost memories matching user interests
    boosted = []
    for memory in memories:
        boost = 1.0
        for topic in prefs.get("topics_of_interest", []):
            if topic.lower() in memory["content"].lower():
                boost *= 1.5
        boosted.append((memory, memory["score"] * boost))

    return sorted(boosted, key=lambda x: x[1], reverse=True)
```

---

## Sources

- [AI Agent Memory - IBM](https://www.ibm.com/think/topics/ai-agent-memory)
- [Memoria Framework - arXiv](https://arxiv.org/html/2512.12686)
- [Building Memory-Powered AI - MarkTechPost](https://www.marktechpost.com/2025/11/15/how-to-build-memory-powered-agentic-ai-that-learns-continuously-through-episodic-experiences-and-semantic-patterns-for-long-term-autonomy/)
- [MIRIX Multi-Agent Memory - arXiv](https://arxiv.org/html/2507.07957v1)
- [Memory in Agentic Workflows - Hugging Face](https://huggingface.co/blog/Kseniase/memory)
- [AI Agent Memory with Redis](https://redis.io/blog/build-smarter-ai-agents-manage-short-term-and-long-term-memory-with-redis/)
- [Memory Types in Agentic AI - Medium](https://medium.com/@gokcerbelgusen/memory-types-in-agentic-ai-a-breakdown-523c980921ec)
