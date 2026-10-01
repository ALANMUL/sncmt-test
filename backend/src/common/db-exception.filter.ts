import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';

/** Turns database errors into clear HTTP errors; hides unexpected internals. */
@Catch()
export class DbExceptionFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (err instanceof HttpException) {
      return res.status(err.getStatus()).json(err.getResponse());
    }
    // PostgreSQL error codes
    if (err?.code === '23505') {
      return res.status(409).json({ statusCode: 409, message: 'That value already exists.' });
    }
    if (err?.code === 'P0001' && err?.message) {
      // RAISE EXCEPTION from our triggers: safe, written for humans.
      return res.status(400).json({ statusCode: 400, message: err.message });
    }
    if (err?.code === '23503' || err?.code === '23514') {
      return res.status(400).json({ statusCode: 400, message: 'Invalid data.' });
    }
    console.error(err);
    return res.status(500).json({ statusCode: 500, message: 'Something went wrong on the server.' });
  }
}
