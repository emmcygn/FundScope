-- Enable Row Level Security on all tables
alter table public.funds enable row level security;
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.extracted_terms enable row level security;
alter table public.obligations enable row level security;
alter table public.risk_flags enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- Funds: users can only see/modify their own funds
create policy "Users can view own funds" on public.funds
  for select using (auth.uid() = user_id);
create policy "Users can insert own funds" on public.funds
  for insert with check (auth.uid() = user_id);
create policy "Users can update own funds" on public.funds
  for update using (auth.uid() = user_id);
create policy "Users can delete own funds" on public.funds
  for delete using (auth.uid() = user_id);

-- Documents: users can only see/modify docs in their funds
create policy "Users can view own documents" on public.documents
  for select using (auth.uid() = user_id);
create policy "Users can insert own documents" on public.documents
  for insert with check (auth.uid() = user_id);
create policy "Users can update own documents" on public.documents
  for update using (auth.uid() = user_id);
create policy "Users can delete own documents" on public.documents
  for delete using (auth.uid() = user_id);

-- Chunks: accessible if user owns the parent document
create policy "Users can view chunks of own documents" on public.chunks
  for select using (
    exists (
      select 1 from public.documents d
      where d.id = chunks.document_id and d.user_id = auth.uid()
    )
  );
create policy "Service role can manage chunks" on public.chunks
  for all using (auth.role() = 'service_role');

-- Extracted terms: accessible if user owns the parent fund
create policy "Users can view own extracted terms" on public.extracted_terms
  for select using (
    exists (
      select 1 from public.funds f
      where f.id = extracted_terms.fund_id and f.user_id = auth.uid()
    )
  );
create policy "Service role can manage extracted terms" on public.extracted_terms
  for all using (auth.role() = 'service_role');

-- Obligations: accessible if user owns the parent fund
create policy "Users can view own obligations" on public.obligations
  for select using (
    exists (
      select 1 from public.funds f
      where f.id = obligations.fund_id and f.user_id = auth.uid()
    )
  );
create policy "Users can update own obligations" on public.obligations
  for update using (
    exists (
      select 1 from public.funds f
      where f.id = obligations.fund_id and f.user_id = auth.uid()
    )
  );
create policy "Service role can manage obligations" on public.obligations
  for all using (auth.role() = 'service_role');

-- Risk flags: accessible if user owns the parent fund
create policy "Users can view own risk flags" on public.risk_flags
  for select using (
    exists (
      select 1 from public.funds f
      where f.id = risk_flags.fund_id and f.user_id = auth.uid()
    )
  );
create policy "Service role can manage risk flags" on public.risk_flags
  for all using (auth.role() = 'service_role');

-- Chat sessions: users can only see their own
create policy "Users can view own chat sessions" on public.chat_sessions
  for select using (auth.uid() = user_id);
create policy "Users can insert own chat sessions" on public.chat_sessions
  for insert with check (auth.uid() = user_id);
create policy "Users can delete own chat sessions" on public.chat_sessions
  for delete using (auth.uid() = user_id);

-- Chat messages: accessible if user owns the parent session
create policy "Users can view own chat messages" on public.chat_messages
  for select using (
    exists (
      select 1 from public.chat_sessions cs
      where cs.id = chat_messages.session_id and cs.user_id = auth.uid()
    )
  );
create policy "Service role can manage chat messages" on public.chat_messages
  for all using (auth.role() = 'service_role');

-- Create storage bucket for PDFs
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false);

-- Storage policies: users can upload/read their own files
create policy "Users can upload documents" on storage.objects
  for insert with check (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users can read own documents" on storage.objects
  for select using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Users can delete own documents" on storage.objects
  for delete using (bucket_id = 'documents' and auth.uid()::text = (storage.foldername(name))[1]);
