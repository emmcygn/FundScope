export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class DocumentProcessingError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DOCUMENT_PROCESSING_ERROR', 500, details)
    this.name = 'DocumentProcessingError'
  }
}

export class RAGError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RAG_ERROR', 500, details)
    this.name = 'RAGError'
  }
}

export class ExtractionError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EXTRACTION_ERROR', 500, details)
    this.name = 'ExtractionError'
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
