const required = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
]

const missing = required.filter(key => !process.env[key])

if (missing.length > 0) {
  console.error('Missing environment variables:', missing.join(', '))
  process.exit(1)
} else {
  console.log('All required environment variables are set')
}
