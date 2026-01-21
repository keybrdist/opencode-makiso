# PRD: makiso - event queuing and delayed-execution

## Executive Summary
makiso - event queuing and delayed-execution is a local-first pub/sub event system that enables LLM agents to coordinate work through structured events. It is designed for OpenCode integration via a CLI and plugin, supports webhook ingestion, and stores all events in a searchable SQLite database with FTS5 indexing.

## Goals
- Enable agent-to-agent task handoff with reliable event history
- Provide a fast, searchable event store for @mentions and tool invocations
- Keep setup minimal: single npm package + SQLite file
- Support external event sources (webhooks, humans, system events)
- Fit OpenCode’s skill and plugin model with stateless CLI calls

## Non-Goals
- Replace enterprise orchestration frameworks (CrewAI, LangGraph)
- Require external infrastructure (Redis, Kafka, etc.)
- Provide real-time streaming across machines in v1

## Target Users
- OpenCode users coordinating multiple agents
- Developers building autonomous loops between agent tools
- Systems receiving webhook events and translating them into LLM tasks

## Success Metrics
- Setup time < 5 minutes
- Query latency < 50ms for indexed lookups
- Reliable handoff with no double-processing of events

## Product Requirements

### 1) Event Model
Each event has:
- `id` (ULID, time-ordered)
- `topic`
- `body` (text)
- `metadata` (JSON)
- `correlation_id` (links replies)
- `parent_id` (reply chain)
- `status` (pending|processing|completed|failed)
- `source` (agent:webhook:human)
- timestamps (`created_at`, `processed_at`)

### 2) Storage
- SQLite database stored at `~/.config/opencode/makiso/events.db`
- FTS5 virtual table for full-text search over event body
- Secondary tables for @mentions and tool call indexing

### 3) CLI (oc-events)
Core commands:
- `push <topic> --body "..." --meta '{...}'`
- `pull <topic> --claim --agent "@name"`
- `query --mention @name` and `query --tool-call bash`
- `reply <id> --status success --body "..."`
- `topics list|create|set-prompt`
- `search "full text"`

### 4) OpenCode Plugin
- Hooks on `session.idle`
- Polls every 60 seconds (configurable)
- Uses CLI `pull --claim` to get next event
- Injects event into the session as a user/system message

### 5) Topic-Based Prompts
- `topics` table holds system prompts per topic
- When pulling an event, CLI returns prompt + body + metadata

### 6) Webhook Server
- Lightweight HTTP server (Express or Fastify)
- Route mapping to topics:
  - `/bitbucket` -> `bitbucket-webhook`
  - `/bugsnag` -> `error-report`
  - `/payment` -> `payment-webhook`
- Validates shared secret headers when configured

## Functional Requirements

### Event Claiming
- Atomic claim to prevent double-processing
- `pull --claim` updates status to `processing` in a transaction

### Indexing
- Auto-extract `@mentions` from event body
- Auto-extract tool calls (e.g., `bash`, `read`, `edit`) from metadata or body patterns

### Reply Flow
- `reply` creates a new event linked by `correlation_id`
- Original event updated to `completed` or `failed`

### Retention
- CLI command to clean old events
- Default: keep completed events 30 days

## Architecture Overview
- CLI: main interface for publish/consume/query
- Plugin: background polling in OpenCode sessions
- SQLite: event store with FTS indexing
- Webhook server: optional external ingestion

## Prior Art and Differentiation
- A2A Protocol and LangChain Agent Protocol are heavy, server-oriented, and not local-first
- SQLite queue tools exist but do not integrate with LLM workflows
- This product is CLI-first, local-first, and OpenCode-native

## Phased Plan

### Phase 1 (MVP)
- SQLite schema + migrations
- CLI: push, pull, query, reply
- Basic mention extraction
- README and docs

### Phase 2
- Topics and system prompts
- OpenCode plugin auto-poll
- Webhook server skeleton

### Phase 3
- Tool-call indexing
- Event retention / cleanup
- Optional TUI dashboard

## Open Questions
- Agent identity mechanism (`OC_AGENT_ID` env vs config file)
- Topic access control (agent allowlists)
- Event TTL for unprocessed events
