export function validate(schema, source = 'body') {
  return (req, res, next) => {
    try {
      req[source] = schema.parse(req[source])
      next()
    } catch (err) {
      next(err) // ZodError — caught by errorHandler
    }
  }
}
