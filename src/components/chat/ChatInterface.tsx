'use client'

import { useChat } from '@ai-sdk/react'
import { TextStreamChatTransport } from 'ai'
import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Send, Loader2, Bot, User } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import {
  type Citation,
  parseCitationsFromText,
  processTextChildren,
  SourcesList,
} from './CitationLink'

interface ChatInterfaceProps {
  fundId: string | null
  /** Called when the user clicks a source badge or a row in the Sources panel */
  onCitationClick?: (citation: Citation) => void
}

/**
 * Extracts the text content from a UIMessage's parts array.
 * AI SDK v5 uses message.parts instead of message.content.
 */
function getMessageText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('')
}

export function ChatInterface({ fundId, onCitationClick }: ChatInterfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [inputValue, setInputValue] = useState('')

  // Memoize transport — recreated only when fundId changes
  const transport = useMemo(
    () => new TextStreamChatTransport({ api: '/api/chat', body: { fundId } }),
    [fundId]
  )

  const { messages, sendMessage, status, error } = useChat({ transport })

  const isLoading = status === 'streaming' || status === 'submitted'

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSubmit = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || isLoading) return
    setInputValue('')
    await sendMessage({ text: trimmed })
  }, [inputValue, isLoading, sendMessage])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
            <Bot className="h-12 w-12 mb-4 opacity-50" />
            <h3 className="heading-serif text-lg mb-2">Ask about your fund documents</h3>
            <p className="text-sm max-w-md">
              Upload fund documents (LPAs, side letters, term sheets) and ask questions about terms,
              obligations, and risks.
            </p>
          </div>
        )}

        <div className="space-y-4">
          {messages.map((message) => {
            const rawText = getMessageText(message.parts)

            return (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {message.role === 'assistant' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <Card
                  className={`max-w-[80%] p-3 ${
                    message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  {message.role === 'user' ? (
                    <div className="whitespace-pre-wrap text-sm">{rawText}</div>
                  ) : (
                    <AssistantMessage text={rawText} onCitationClick={onCitationClick} />
                  )}
                </Card>
                {message.role === 'user' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                    <User className="h-4 w-4 text-primary-foreground" />
                  </div>
                )}
              </div>
            )
          })}

          {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
            <div className="flex gap-3 justify-start">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <Card className="p-3 bg-muted">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </Card>
            </div>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="px-4 py-2 text-sm text-destructive bg-destructive/10 border-t">
          Error: {error.message}
        </div>
      )}

      {/* Input area */}
      <div className="p-4 border-t">
        <div className="flex gap-2">
          <Textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={fundId ? 'Ask about your fund documents...' : 'Select a fund first...'}
            disabled={!fundId || isLoading}
            className="min-h-[44px] max-h-[120px] resize-none focus-visible:ring-primary"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSubmit()
              }
            }}
          />
          <Button
            type="button"
            size="icon"
            disabled={!inputValue.trim() || isLoading || !fundId}
            onClick={handleSubmit}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Renders an assistant message. Parses the [CITES:base64] marker from the
 * message text to extract citations, then renders:
 *   1. The clean text with inline numbered badges replacing [Source N] patterns
 *   2. A collapsible "N sources" footer listing all citations
 */
function AssistantMessage({
  text,
  onCitationClick,
}: {
  text: string
  onCitationClick?: (citation: Citation) => void
}) {
  // Extract citations and strip the marker from displayed text.
  // `useMemo` so this only re-parses when the text actually changes (i.e. during streaming).
  const { cleanText, citations } = useMemo(() => parseCitationsFromText(text), [text])

  const components = useMemo(
    () => ({
      p: ({ children }: { children?: React.ReactNode }) => (
        <p>{processTextChildren(children, citations, onCitationClick)}</p>
      ),
      li: ({ children }: { children?: React.ReactNode }) => (
        <li>{processTextChildren(children, citations, onCitationClick)}</li>
      ),
    }),
    [citations, onCitationClick]
  )

  return (
    <div>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown components={components}>{cleanText}</ReactMarkdown>
      </div>
      <SourcesList citations={citations} onCitationClick={onCitationClick} />
    </div>
  )
}
