import { ZodError } from 'zod'
import { AppError } from '../utils/errors.js'

export function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message },
    })
  }

  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        fields: err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      },
    })
  }

  // PostgreSQL unique violation
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: { code: 'DUPLICATE', message: 'A record with this value already exists' },
    })
  }

  console.error('Unhandled error:', err)
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  })
}
