// Every deliberate HTTP failure in the API is an HttpError; the terminal error
// middleware in app.ts turns it into the contract's {"error": "<message>"} body.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
