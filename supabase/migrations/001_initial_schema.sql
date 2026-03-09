-- Enable required extensions
create extension if not exists vector with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- Funds table: top-level entity representing a PE fund
create table public.funds (
  id uuid default extensions.uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  manager text,
  vintage_year integer,
  fund_size_millions numeric,
  currency text default 'USD',
  status text default 'active' check (status in ('active', 'closed', 'liquidating')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Documents table: PDFs uploaded per fund
create table public.documents (
  id uuid default extensions.uuid_generate_v4() primary key,
  fund_id uuid references public.funds(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  file_path text not null,
  file_size_bytes bigint,
  page_count integer,
  doc_type text not null check (doc_type in (
    'lpa', 'side_letter', 'term_sheet', 'sub_agreement',
    'ppm', 'nda', 'other'
  )),
  processing_status text default 'pending' check (processing_status in (
    'pending', 'processing', 'chunking', 'embedding', 'extracting', 'ready', 'error'
  )),
  processing_error text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Chunks table: text segments with embeddings for RAG
create table public.chunks (
  id uuid default extensions.uuid_generate_v4() primary key,
  document_id uuid references public.documents(id) on delete cascade not null,
  chunk_index integer not null,
  text text not null,
  context_summary text,
  embedding vector(1024),
  section_number text,
  clause_id text,
  page_number integer,
  char_start integer,
  char_end integer,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null
);

-- Create index for vector similarity search
create index on public.chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Create index for full-text search (BM25-like)
alter table public.chunks add column fts tsvector
  generated always as (to_tsvector('english', text)) stored;
create index on public.chunks using gin(fts);

-- Extracted terms: structured PE fund terms pulled from documents
create table public.extracted_terms (
  id uuid default extensions.uuid_generate_v4() primary key,
  document_id uuid references public.documents(id) on delete cascade not null,
  fund_id uuid references public.funds(id) on delete cascade not null,
  term_type text not null check (term_type in (
    'management_fee', 'carried_interest', 'preferred_return', 'hurdle_rate',
    'investment_period', 'fund_term', 'gp_commitment', 'key_person',
    'clawback', 'mfn_rights', 'no_fault_removal', 'excuse_exclusion',
    'distribution_waterfall', 'reporting_obligation', 'fund_size_cap',
    'recycling_provision', 'co_investment_rights', 'advisory_committee',
    'other'
  )),
  term_value jsonb not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  source_clause text,
  source_page integer,
  source_text text,
  is_market_standard boolean,
  deviation_notes text,
  created_at timestamptz default now() not null
);

-- Obligations: time-bound requirements from fund docs
create table public.obligations (
  id uuid default extensions.uuid_generate_v4() primary key,
  fund_id uuid references public.funds(id) on delete cascade not null,
  document_id uuid references public.documents(id) on delete cascade not null,
  description text not null,
  responsible_party text check (responsible_party in (
    'gp', 'lp', 'administrator', 'auditor', 'legal_counsel', 'other'
  )),
  due_date date,
  due_description text,
  recurrence text check (recurrence in (
    'one_time', 'quarterly', 'semi_annually', 'annually', 'per_event', 'ongoing'
  )),
  trigger_event text,
  category text check (category in (
    'reporting', 'capital_call', 'distribution', 'consent',
    'mfn_election', 'key_person', 'annual_meeting', 'tax',
    'regulatory', 'notification', 'other'
  )),
  priority text default 'medium' check (priority in ('critical', 'high', 'medium', 'low')),
  status text default 'pending' check (status in ('pending', 'completed', 'overdue', 'waived')),
  source_clause text,
  source_page integer,
  source_text text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Risk flags: AI-identified issues in documents
create table public.risk_flags (
  id uuid default extensions.uuid_generate_v4() primary key,
  document_id uuid references public.documents(id) on delete cascade not null,
  fund_id uuid references public.funds(id) on delete cascade not null,
  chunk_id uuid references public.chunks(id) on delete set null,
  category text not null check (category in (
    'lp_unfriendly', 'unusual_fee', 'broad_gp_discretion', 'weak_governance',
    'missing_clause', 'non_standard_term', 'regulatory_risk', 'conflict_of_interest',
    'ambiguous_language', 'other'
  )),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  title text not null,
  description text not null,
  recommendation text,
  confidence_score numeric not null check (confidence_score >= 0 and confidence_score <= 1),
  source_clause text,
  source_page integer,
  source_text text,
  bounding_rect jsonb,
  created_at timestamptz default now() not null
);

-- Chat sessions: conversation history
create table public.chat_sessions (
  id uuid default extensions.uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  fund_id uuid references public.funds(id) on delete set null,
  title text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- Chat messages: individual messages in sessions
create table public.chat_messages (
  id uuid default extensions.uuid_generate_v4() primary key,
  session_id uuid references public.chat_sessions(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  citations jsonb default '[]'::jsonb,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now() not null
);

-- Updated_at trigger function
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Apply updated_at triggers
create trigger update_funds_updated_at before update on public.funds
  for each row execute function public.update_updated_at_column();
create trigger update_documents_updated_at before update on public.documents
  for each row execute function public.update_updated_at_column();
create trigger update_obligations_updated_at before update on public.obligations
  for each row execute function public.update_updated_at_column();
create trigger update_chat_sessions_updated_at before update on public.chat_sessions
  for each row execute function public.update_updated_at_column();
