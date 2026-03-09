import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import type { SearchResult } from '@/lib/rag/search'

const chunkGradeSchema = z.object({
  relevant: z.boolean().describe('Whether this chunk is relevant to answering the query'),
})

export interface GradingResult {
  relevant: SearchResult[]
  irrelevant: SearchResult[]
}

/**
 * Grades each retrieved chunk for relevance to the user query.
 * Uses GPT-4o-mini for speed — binary yes/no grading is a lightweight task.
 *
 * Runs all grading calls in parallel for performance.
 */
export async function gradeChunks(
  query: string,
  chunks: SearchResult[]
): Promise<GradingResult> {
  if (chunks.length === 0) {
    return { relevant: [], irrelevant: [] }
  }

  // Grade all chunks in parallel
  const grades = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const { object } = await generateObject({
          model: openai('gpt-4o-mini'),
          schema: chunkGradeSchema,
          maxOutputTokens: 50,
          temperature: 0,
          experimental_telemetry: { isEnabled: true, functionId: 'grade-chunk' },
          prompt: `You are a relevance grader for a legal document retrieval system.

Given a user query and a document chunk, determine if the chunk contains information relevant to answering the query. Be inclusive — if the chunk is even partially relevant, mark it as relevant.

User query: "${query}"

Document chunk:
"""
${chunk.text}
"""

Is this chunk relevant to answering the query?`,
        })

        return { chunk, relevant: object.relevant }
      } catch (error) {
        // If grading fails for a chunk, include it (err on the side of inclusion)
        console.warn('Chunk grading failed, including by default:', error)
        return { chunk, relevant: true }
      }
    })
  )

  const relevant: SearchResult[] = []
  const irrelevant: SearchResult[] = []

  for (const grade of grades) {
    if (grade.relevant) {
      relevant.push(grade.chunk)
    } else {
      irrelevant.push(grade.chunk)
    }
  }

  return { relevant, irrelevant }
}
