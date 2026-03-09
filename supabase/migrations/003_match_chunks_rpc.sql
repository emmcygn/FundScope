-- Create the vector similarity search function
-- Used by the dense search component of hybrid search
create or replace function match_chunks(
  query_embedding text,
  match_count int default 10,
  filter_fund_id uuid default null,
  filter_document_ids uuid[] default null
)
returns table (
  id uuid,
  document_id uuid,
  text text,
  context_summary text,
  page_number int,
  section_number text,
  metadata jsonb,
  distance float
)
language plpgsql
as $$
begin
  return query
  select
    c.id,
    c.document_id,
    c.text,
    c.context_summary,
    c.page_number,
    c.section_number,
    c.metadata,
    c.embedding <=> query_embedding::vector as distance
  from chunks c
  join documents d on d.id = c.document_id
  where
    (filter_fund_id is null or d.fund_id = filter_fund_id)
    and (filter_document_ids is null or c.document_id = any(filter_document_ids))
    and c.embedding is not null
  order by c.embedding <=> query_embedding::vector
  limit match_count;
end;
$$;
